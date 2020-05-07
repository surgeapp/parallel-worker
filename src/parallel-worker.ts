import { EventEmitter } from 'events'
import * as cluster from 'cluster'
import * as os from 'os'
import * as AsyncLock from 'async-lock'
// eslint-disable-next-line import/extensions
import { name as packageName } from '../package.json'
import { initLogger, rawLogger, Logger } from './utils/logger'
import {
  ParallelWorkerEvent,
  FetchNextPayloadFn,
  LoggingOptions,
  Message,
  MessageType,
  Options,
  Payload,
  PayloadHandlerFn,
  StorageEngine,
  ID,
  LastProcessedIdData,
} from './types'

export class ParallelWorker extends EventEmitter {
  // storage engine to store last processed id
  private readonly storage: StorageEngine
  private readonly storageKey: { lastProcessedId: string, lock: string }

  // user handler functions
  private handlePayload?: PayloadHandlerFn
  private fetchNextFn?: FetchNextPayloadFn

  private readonly loggingOptions: LoggingOptions
  private readonly masterLogger: Logger

  private readonly workersCount: number
  private readonly lock: AsyncLock

  // Set max number of worker restarts so in case there is some serious problem
  // it won't keep restarting all the workers endlessly but rather stop the entire script
  private readonly maxAllowedWorkersRestartsCount: number
  private workersRestartedCount: number
  private readonly shouldRestartWorkerOnExit: boolean

  constructor(opts: Options) {
    super()

    this.storage = opts.storage
    const storageKeyPrefix = opts.storageKeyPrefix ?? packageName
    this.storageKey = {
      lastProcessedId: `${storageKeyPrefix}:lastProcessedId`,
      lock: `${storageKeyPrefix}:lock`,
    }

    // how many worker processes to launch, number of CPU cores by default
    this.workersCount = opts.workers || os.cpus().length // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing

    // Allow each worker instance to be restarted max 5 times (in an ideal world),
    // even though it's not quite correct as some workers
    // could be stopped more times and some less so it's serves
    // just as a constant for calculating max allowed restarts count
    this.maxAllowedWorkersRestartsCount = opts.maxAllowedWorkerRestartsCount ?? this.workersCount * 5
    this.workersRestartedCount = 0
    this.shouldRestartWorkerOnExit = opts.restartWorkerOnExit ?? true

    this.lock = new AsyncLock(opts.lockOptions)

    // init logger
    this.loggingOptions = {
      enabled: true,
      level: 'info',
      ...opts.logging ?? {},
    }
    this.masterLogger = initLogger(this.loggingOptions)
  }

  setFetchNext(handlerFn: FetchNextPayloadFn): void {
    this.fetchNextFn = handlerFn
  }

  setHandler(handlerFn: PayloadHandlerFn): void {
    this.handlePayload = handlerFn
  }

  start(): void {
    if (!this.handlePayload) {
      throw new Error('Handling payload behavior is not defined. Please call ".setHandler()"')
    }
    if (!this.fetchNextFn) {
      throw new Error('Fetching next payload behavior is not defined. Please call ".setFetchNext()"')
    }
    if (cluster.isMaster) {
      this.initMaster()
    } else {
      this.runWorker(process.pid)
    }
  }

  private async fetchNext(): Promise<Payload> {
    let payload: Payload = {
      lastId: -1,
    }

    await this.lock.acquire(this.storageKey.lock, async () => {
      // check if there is some id already in storage (worker is in progress)
      const lastProcessedIdData = await this.getLastProcessedId()

      if (lastProcessedIdData.noMoreData) {
        payload.noMoreData = true
        return
      }

      // fetch next payload
      const fetchedPayload = await this.fetchNextFn!(lastProcessedIdData.lastProcessedId)

      if (!fetchedPayload) {
        this.masterLogger.debug({ fetchedPayload }, 'Fetched empty payload')
        payload.noMoreData = true
      } else {
        this.masterLogger.debug({ fetchedPayload }, 'Fetched next payload')
        await this.setLastProcessedId(fetchedPayload.lastId)
        payload = fetchedPayload
        payload.lastId = lastProcessedIdData.lastProcessedId
      }
    })

    // if something bad happens throw an error
    if (payload.lastId === -1 && !payload.noMoreData) {
      throw new Error('Failed to fetch next payload')
    }

    return payload
  }

  private async getLastProcessedId(): Promise<LastProcessedIdData> {
    const lastProcessedIdData = await this.storage.get(this.storageKey.lastProcessedId)
    if (lastProcessedIdData) {
      return JSON.parse(lastProcessedIdData) as LastProcessedIdData
    }
    return {
      lastProcessedId: null,
      noMoreData: false,
    }
  }

  private async setLastProcessedId(lastProcessedId?: ID|null): Promise<void> {
    const data = {
      lastProcessedId,
      // used in case there was provided payload without lastId but with custom payload as a last iteration
      noMoreData: typeof lastProcessedId === 'undefined' || lastProcessedId === null,
    }
    await this.storage.set(this.storageKey.lastProcessedId, JSON.stringify(data))
  }

  private shouldRestartWorker(code: number): boolean {
    // If the worker's return code is 0 then we won't restart it as it exited normally without an error
    return this.shouldRestartWorkerOnExit && code !== 0
  }

  private logWorkerExitEvent(worker: cluster.Worker, code: number, signal: string): void {
    const logData = {
      workerId: worker.process.pid,
      code,
      signal,
    }
    if (code !== 0) {
      this.masterLogger.error(logData, 'Worker exited with error')
    } else {
      this.masterLogger.info(logData, 'Worker stopped successfully')
    }
  }

  private initMaster(): void {
    this.masterLogger.info({
      count: this.workersCount,
      shouldRestartWorkerOnExit: this.shouldRestartWorkerOnExit,
    }, 'Starting workers')

    cluster.on('exit', (worker: cluster.Worker, code: number, signal: string) => {
      this.logWorkerExitEvent(worker, code, signal)
      this.emit(ParallelWorkerEvent.workerExited, { worker, code, signal })

      // If the worker exited with error and the total count of worker restarts hasn't been reached, restart worker
      if (this.shouldRestartWorker(code)) {
        if (this.workersRestartedCount < this.maxAllowedWorkersRestartsCount) {
          this.masterLogger.info('Starting new worker')
          this.workersRestartedCount += 1
          this.spawnWorker()
        } else {
          this.masterLogger.error({
            maxAllowedWorkersRestartsCount: this.maxAllowedWorkersRestartsCount,
          }, 'Max allowed restarts limit reached')
        }
      } else if (Object.keys(cluster.workers).length === 0) {
        this.masterLogger.info('Stopping...')
        this.emit(ParallelWorkerEvent.beforeStop)
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
    log.debug('Requesting initial payload')
    process.send!({ type: MessageType.getNextId })

    // TODO: handle worker exit & signals

    const errorHandler = rawLogger.final(log, (err: Error, finalLogger: Logger): void => {
      finalLogger.error({
        name: err.name,
        message: err.message,
        stack: err.stack,
      }, 'Uncaught error occurred. Stopping worker')
      process.exit(1)
    })

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    process.on('unhandledRejection', errorHandler)
    process.on('uncaughtException', errorHandler)

    // Listen for events from master
    process.on('message', async (message: Message) => {
      if (message.type === MessageType.setNextId) {
        if (message.payload!.noMoreData) {
          log.debug(message, 'No more data. Stopping')
          process.exit(0)
        }
        log.debug(message, 'Received payload. Starting processing')

        // run user's handler
        await this.handlePayload!(message.payload!)

        // ask for next payload to process
        log.debug('Payload processing completed. Requesting next payload')
        process.send!({ type: MessageType.getNextId })
      }
    })
  }

  private spawnWorker(): void {
    const worker = cluster.fork()

    // Listen for events from worker
    worker.on('message', async ({ type }: Message) => {
      switch (type) {
        case MessageType.getNextId: {
          const payload = await this.fetchNext()
          worker.send({
            type: MessageType.setNextId,
            payload,
          })
          break
        }
        default:
      }
    })
  }
}
