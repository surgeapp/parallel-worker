import { EventEmitter } from 'events'
import cluster from 'cluster'
import os from 'os'
import last from 'lodash.last'
// eslint-disable-next-line import/extensions
import { name as packageName } from '../package.json'
import { initLogger, rawLogger, Logger } from './utils/logger'
import {
  WorkerEvent,
  FetchNextPayloadFn,
  LoggingOptions,
  Message,
  MessageType,
  Options,
  Payload,
  PayloadHandlerFn,
  Redis,
  ID,
  LastProcessedIdData,
} from './types'
import { Lock } from './lock/types'
import getLockStrategy from './lock'

export class ParallelWorker extends EventEmitter {
  // redis engine to store last processed id
  private readonly redis: Redis
  private readonly keys: {
    lastProcessedId: string
    lock: string
    payload: string
    impairedPayloadsList: string
  }

  // user handler functions
  private handlePayload!: PayloadHandlerFn
  private fetchNextFn!: FetchNextPayloadFn
  private readonly shouldReclaimPayloadOnFail: boolean

  private readonly loggingOptions: LoggingOptions
  private readonly masterLogger: Logger

  private readonly lock: Lock

  private readonly workersCount: number
  // Set max number of worker restarts so in case there is some serious problem
  // it won't keep restarting all the workers endlessly but rather stop the entire script
  private readonly maxAllowedWorkersRestartsCount: number
  private workersRestartedCount: number
  private readonly shouldRestartWorkerOnExit: boolean

  constructor(opts: Options) {
    super()

    this.redis = opts.redis
    const redisKeyPrefix = opts.redisKeyPrefix ?? packageName
    this.keys = {
      lastProcessedId: `${redisKeyPrefix}:lastProcessedId`,
      lock: `${redisKeyPrefix}:lock`,
      payload: `${redisKeyPrefix}:workerPayload`,
      impairedPayloadsList: `${redisKeyPrefix}:impairedPayloads`,
    }

    // how many worker processes to launch, number of CPU cores by default
    this.workersCount = opts.workers ?? os.cpus().length

    // Allow each worker instance to be restarted max 5 times (in an ideal world),
    // even though it's not quite correct as some workers
    // could be stopped more times and some less so it's serves
    // just as a constant for calculating max allowed restarts count
    this.maxAllowedWorkersRestartsCount = opts.maxAllowedWorkerRestartsCount ?? this.workersCount * 5
    this.workersRestartedCount = 0
    this.shouldRestartWorkerOnExit = opts.restartWorkerOnExit ?? true
    // Specify if the master should assign payload to another worker
    // if the original worker processing the payload failed
    this.shouldReclaimPayloadOnFail = opts.reclaimReservedPayloadOnFail ?? false

    this.lock = getLockStrategy(opts.lock?.type ?? 'local', this.keys.lock, opts.lock?.options)

    // init logger
    this.loggingOptions = {
      enabled: true,
      level: 'info',
      ...opts.logging ?? {},
    }
    this.masterLogger = initLogger(this.loggingOptions).child({ process: `master(${process.pid})` })
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

  private async fetchNext(workerId: number): Promise<Payload> {
    let payload: Payload = {
      lastId: -1,
    }

    await this.lock.lockAndExecute(async () => {
      let fetchedPayload

      // check if there is some unprocessed payload from failed workers and process this before fetching next range from
      // customer's defined function. Only if allowed.
      const impairedPayload = this.shouldReclaimPayloadOnFail ? await this.fetchImpairedPayloadIfExists() : null
      if (impairedPayload?.payload) {
        fetchedPayload = impairedPayload.payload
      }

      // check if there is some id already in redis (worker is in progress)
      const lastProcessedIdData = await this.getLastProcessedId()

      if (lastProcessedIdData.noMoreData) {
        payload.noMoreData = true
        await this.deleteWorkerPayload(workerId)
        return
      }

      if (!fetchedPayload) {
        fetchedPayload = await this.fetchNextFn(lastProcessedIdData.lastProcessedId)
      }

      if (!fetchedPayload) {
        this.masterLogger.debug({ fetchedPayload }, 'Fetched empty payload')
        payload.noMoreData = true
        await this.deleteWorkerPayload(workerId)
      } else {
        if (impairedPayload) {
          this.masterLogger.debug({
            originalWorker: impairedPayload.workerId,
            newWorker: workerId,
            payload: impairedPayload.payload,
          }, 'Picked impaired payload')
        } else {
          this.masterLogger.debug({ fetchedPayload }, 'Fetched next payload')
        }
        await Promise.all([
          this.setLastProcessedId(fetchedPayload.lastId),
          this.saveWorkerPayload(fetchedPayload, workerId),
        ])
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

  private async saveWorkerPayload(payload: Payload, workerId: number): Promise<void> {
    await this.redis.set(`${this.keys.payload}:${workerId}`, JSON.stringify(payload))
  }

  private async deleteWorkerPayload(workerId: number): Promise<void> {
    await this.redis.del(`${this.keys.payload}:${workerId}`)
  }

  private async markImpairedWorker(workerId: number): Promise<void> {
    await this.redis.rpush(this.keys.impairedPayloadsList, `${this.keys.payload}:${workerId}`)
  }

  private async fetchImpairedPayloadIfExists(): Promise<{ payload: Payload, workerId: string } | null> {
    const impairedPayloadKey = await this.redis.lpop(this.keys.impairedPayloadsList)
    const payload = await this.redis.get(impairedPayloadKey)
    if (!payload) {
      return null
    }
    await this.redis.del(impairedPayloadKey)
    const workerId = last(impairedPayloadKey.split(':')) as string
    return {
      workerId,
      payload: JSON.parse(payload),
    }
  }

  private async getLastProcessedId(): Promise<LastProcessedIdData> {
    const lastProcessedIdData = await this.redis.get(this.keys.lastProcessedId)
    if (lastProcessedIdData) {
      return JSON.parse(lastProcessedIdData) as LastProcessedIdData
    }
    return {
      lastProcessedId: null,
      noMoreData: false,
    }
  }

  private async setLastProcessedId(lastProcessedId?: ID | null): Promise<void> {
    const data = {
      lastProcessedId,
      // used in case there was provided payload without lastId but with custom payload as a last iteration
      noMoreData: typeof lastProcessedId === 'undefined' || lastProcessedId === null,
    }
    await this.redis.set(this.keys.lastProcessedId, JSON.stringify(data))
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
      shouldReclaimPayloadOnFail: this.shouldReclaimPayloadOnFail,
    }, 'Starting workers')

    // Handle worker exits
    cluster.on('exit', async (worker: cluster.Worker, code: number, signal: string) => {
      this.logWorkerExitEvent(worker, code, signal)
      this.emit(WorkerEvent.workerExited, { worker, code, signal })

      // If the worker exited with error and the total count of worker restarts hasn't been reached, restart worker
      if (this.shouldRestartWorker(code)) {
        await this.markImpairedWorker(worker.process.pid)
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
        this.emit(WorkerEvent.beforeStop)
      }
    })

    // Handle master interruptions
    const exitHandler = async (signal: NodeJS.Signals): Promise<never> => {
      this.masterLogger.info({ signal }, 'Stop signal caught')
      const workerIds = Object.values(cluster.workers).map((worker: cluster.Worker | undefined) => worker!.process.pid)

      // save worker payloads in progress if enabled
      if (this.shouldReclaimPayloadOnFail) {
        await Promise.all(workerIds.map((workerId: number) => this.markImpairedWorker(workerId)))
        this.masterLogger.debug({ workerIds }, 'Worker payloads saved')
      }

      // stop workers
      workerIds.forEach(workerId => cluster.workers[workerId]?.kill())
      this.masterLogger.debug({ workerIds }, 'Workers killed')

      // stop master
      process.exit()
    }
    process.on('SIGTERM', exitHandler)
    process.on('SIGINT', exitHandler)

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
    process.send!({ type: MessageType.getNextPayload })

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
      if (message.type === MessageType.setNextPayload) {
        if (message.payload!.noMoreData) {
          log.debug(message, 'No more data. Stopping')
          process.exit(0)
        }
        log.debug(message, 'Received payload. Starting processing')

        // run user's handler
        await this.handlePayload(message.payload!)

        // ask for next payload to process
        log.debug('Payload processing completed. Requesting next payload')
        process.send!({ type: MessageType.getNextPayload })
      }
    })
  }

  private spawnWorker(): void {
    const worker = cluster.fork()

    // Listen for events from worker
    worker.on('message', async ({ type }: Message) => {
      switch (type) {
        case MessageType.getNextPayload: {
          const payload = await this.fetchNext(worker.process.pid)
          worker.send({
            type: MessageType.setNextPayload,
            payload,
          })
          break
        }
        default:
      }
    })
  }
}
