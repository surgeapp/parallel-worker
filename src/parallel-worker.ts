import { EventEmitter } from 'events'
import * as cluster from 'cluster'
import * as os from 'os'
import * as AsyncLock from 'async-lock'
// eslint-disable-next-line import/extensions
import { name, version } from '../package.json'
import { initLogger, Logger } from './utils/logger'
import {
  Event,
  LoadNextRangeFn,
  LoggingOptions,
  Message,
  MessageType,
  Options,
  Payload,
  PayloadHandlerFn,
  StorageEngine,
} from './types'

export class ParallelWorker extends EventEmitter {
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

  // Set max number of worker restarts so in case there is some serious problem
  // it won't keep restarting all the workers endlessly but rather stop the entire script
  private readonly maxAllowedWorkersRestartsCount: number
  private workersRestartedCount: number
  private readonly shouldRestartWorkerOnExit: boolean

  constructor(opts: Options) {
    super()
    this.storage = opts.storage

    this.storageKey = opts.storageKey ?? `${name}@${version}:lastId`

    // how many worker processes to launch, number of CPU cores by default
    this.workersCount = opts.workers ?? os.cpus().length

    // Allow each worker instance to be restarted max 5 times (in an ideal world),
    // even though it's not quite correct as some workers
    // could be stopped more times and some less so it's serves
    // just as an orientational constant for calculating max allowed restarts count
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
      } else {
        payload.noMoreData = true
      }
    })

    // if something bad happens and lastId doesn't get updated, throw an error
    if (payload.lastId === -1) {
      throw new Error('Failed to get next range')
    }

    return payload
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
      this.emit(Event.workerExited, { worker, code, signal })

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
        this.emit(Event.beforeStop)
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
      if (message.type === MessageType.setNextId) {
        if (message.payload!.noMoreData) {
          log.debug(message, 'No more data. Stopping')
          process.exit(0)
        }
        log.debug(message, 'Received ID range. Starting processing')

        // run user's handler
        await this.handlePayload!(message.payload!)

        // ask for next ids range to process
        log.debug('Range processing completed. Requesting new ID range')
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
          const payload = await this.getNextRange()
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
