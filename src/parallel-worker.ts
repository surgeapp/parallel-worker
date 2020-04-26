import * as cluster from 'cluster'
import * as os from 'os'
import * as AsyncLock from 'async-lock'
// eslint-disable-next-line import/extensions
import { name, version } from '../package.json'
import { LoadNextRangeFn, Message, MessageType, Options, Payload, PayloadHandlerFn, StorageEngine } from './types'

export class ParallelWorker {
import { initLogger, Logger } from './utils/logger'
  // storage engine to store last processed id
  private readonly storage: StorageEngine

  // user handler functions
  private handlePayload?: PayloadHandlerFn
  private loadNextRange?: LoadNextRangeFn

  private readonly loggingOptions: LoggingOptions
  private readonly masterLogger: Logger

  private readonly workersCount: number
  private readonly lock: AsyncLock
  private readonly storageKey: string
  private shouldStopProcessing: boolean

  // Set max number of worker restarts so in case there is some serious problem
  // it won't keep restarting all the workers endlessly but rather stop the entire script
  private readonly maxAllowedWorkersRestartsCount: number
  private workersRestartedCount: number

  constructor(opts: Options) {
    this.storage = opts.storage

    this.storageKey = opts.storageKey ?? `${name}@${version}:lastId`

    // how many worker processes to launch, number of CPU cores by default
    this.workersCount = opts.workers ?? os.cpus().length

    this.shouldStopProcessing = false

    // Allow each worker instance to be restarted max 5 times (in an ideal world),
    // even though it's not quite correct as some workers
    // could be stopped more times and some less so it's serves
    // just as an orientational constant for calculating max allowed restarts count
    this.maxAllowedWorkersRestartsCount = opts.maxAllowedWorkerRestartsCount ?? this.workersCount * 5
    this.workersRestartedCount = 0

    this.lock = new AsyncLock(opts.lockOptions)

    // init logger
    this.loggingOptions = {
      enabled: true,
      level: 'info',
      ...(opts.logging ?? {}),
    }
    this.masterLogger = initLogger(this.loggingOptions)
  }

  setLoadNextRange(handlerFn: LoadNextRangeFn): void {
    this.loadNextRange = handlerFn
  }

  setHandler(handlerFn: PayloadHandlerFn): void {
    this.handlePayload = handlerFn
  }

  start(): void {
    if (!this.handlePayload) {
      throw new Error('Handling range behavior is not defined. Please call ".setHandler()"')
    }
    if (!this.loadNextRange) {
      throw new Error('Loading next range behavior is not defined. Please call ".setLoadNextRange()"')
    }
    if (cluster.isMaster) {
      this.initMaster()
    } else {
      this.runWorker(process.pid)
    }
  }

  private async getNextRange(): Promise<Payload> {
    const payload: Payload = {
      lastId: -1,
      idsRange: [],
    }

    await this.lock.acquire(`${name}@${version}_lock`, async () => {
      // check if there is some id already in storage (worker is in progress)
      payload.lastId = await this.storage.get(this.storageKey) || null

      // load next ids range
      payload.idsRange = await this.loadNextRange!(payload.lastId)

      if (payload.idsRange.length) {
        this.masterLogger.debug(payload, 'Fetched new range')
        // save last id in range for next iteration
        const newLastId = payload.idsRange[payload.idsRange.length - 1]
        await this.storage.set(this.storageKey, newLastId)
      }
    })

    // if something bad happens and lastId doesn't get updated, throw an error
    if (payload.lastId === -1) {
      throw new Error('Failed to get next range')
    }

    return payload
  }

  private initMaster(): void {
    this.masterLogger.info({ count: this.workersCount }, 'Starting workers')

    cluster.on('exit', (worker: cluster.Worker, code: number, signal: string) => {
      this.masterLogger.error({ workerID: worker.process.pid, code, signal }, 'Worker exited')

      // If some worker exits and the processing is not done yet
      // and the total count of worker restarts hasn't been reached, restart worker
      if (!this.shouldStopProcessing) {
        if (this.workersRestartedCount < this.maxAllowedWorkersRestartsCount) {
          this.masterLogger.info('Starting new worker')
          this.workersRestartedCount += 1
          this.spawnWorker()
        } else {
          this.masterLogger.error({
            maxAllowedWorkersRestartsCount: this.maxAllowedWorkersRestartsCount,
          }, 'Max allowed restarts limit reached')
        }
      }
    })

    for (let i = 0; i < this.workersCount; i += 1) {
      this.spawnWorker()
    }
  }

  private runWorker(workerId: number): void {
    // create child logger instance so every log contains workerId
    const log = initLogger(this.loggingOptions).child({ process: `worker(${workerId})` })
    log.info('Worker has started')

    // send initial request to master to get first batch of IDs to process
    log.debug('Requesting initial ID range')
    process.send!({ type: MessageType.getNextId })

    // TODO: handle worker exit & signals

    const errorHandler = (err: Error): void => {
      log.error({ name: err.name, message: err.message, stack: err.stack }, 'Uncaught error occurred. Stopping worker')
      process.exit(1)
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    process.on('unhandledRejection', errorHandler)
    process.on('uncaughtException', errorHandler)

    // Listen for events from master
    process.on('message', async (message: Message) => {
      // Some other worker figured out there is no more data and informed master
      // This is the response from master for other workers
      if (message.type === MessageType.stopWorking) {
        log.info('Received "Message.stopWorking" flag. Stopping worker')
        process.exit(0)
      } else if (message.type === MessageType.setNextId) {
        log.debug(message, 'Received ID range. Starting processing')

        const processedItemsCount = await this.handlePayload!(message.payload!)
        if (!Number.isInteger(processedItemsCount)) {
          throw new Error('setHandler must return decimal value')
        }

        // if there is no more data to process, notify master process and exit
        if (processedItemsCount === 0) {
          log.warn('No more data. Sending "Message.pleaseTellOthersToStopWorking" request')
          process.send!({ type: MessageType.pleaseTellOthersToStopWorking })
          process.exit(0)
        } else {
          // otherwise ask for next ids range to process
          log.debug('Range processing completed. Requesting new ID range')
          process.send!({ type: MessageType.getNextId })
        }
      }
    })
  }

  private spawnWorker(): void {
    const worker = cluster.fork()

    // Listen for events from worker
    worker.on('message', async ({ type }: Message) => {
      // on the next message from worker we at first check if the script should terminate
      // and send the Stop request if so
      // We don't want to terminate the worker immediately when "PlsStopNoMoreDataHere" is received
      // so it can finish its job and terminate when ready
      if (this.shouldStopProcessing) {
        worker.send({ type: MessageType.stopWorking })
        return
      }
      switch (type) {
        case MessageType.getNextId: {
          const payload = await this.getNextRange()
          worker.send({
            type: MessageType.setNextId,
            payload,
          })
          break
        }
        case MessageType.pleaseTellOthersToStopWorking: {
          this.shouldStopProcessing = true
          break
        }
        default:
      }
    })
  }
}
