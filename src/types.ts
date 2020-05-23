/* eslint-disable @typescript-eslint/no-explicit-any */

import { Level } from 'pino'
import { CompatibleRedisClient } from 'redlock'
import { LockType } from './lock/types'
import { LocalLockOptions } from './lock/local'
import { RedisLockOptions } from './lock/redis'

export interface Redis extends CompatibleRedisClient {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<any>
  del: (key: string) => Promise<any>
  rpush: (key: string, value: any) => Promise<any>
  lpop: (key: string) => Promise<any>
}

export interface LoggingOptions {
  enabled?: boolean
  level?: Level
}

export type LockOptions = LocalLockOptions | RedisLockOptions

export interface Options {
  redis: Redis
  workers?: number
  restartWorkerOnExit?: boolean
  maxAllowedWorkerRestartsCount?: number
  logging?: LoggingOptions
  lock?: {
    type: LockType
    options?: LockOptions
  }
  redisKeyPrefix?: string
  reclaimReservedPayloadOnFail?: boolean
}

export interface Message {
  type: MessageType
  payload?: Payload
}

export enum MessageType {
  getNextPayload = 'getNextPayload',
  setNextPayload = 'setNextPayload',
}

export type ID = string | number

export interface LastProcessedIdData {
  lastProcessedId: ID | null
  noMoreData?: boolean
}

export interface Payload {
  lastId: ID | null
  noMoreData?: boolean
  // eslint-disable-next-line @typescript-eslint/member-ordering
  [key: string]: any
}

export type FetchNextPayloadFn = (lastId: ID | null) => Promise<Payload | null | void>

export type PayloadHandlerFn = (payload: Payload) => Promise<void>

export enum WorkerEvent {
  workerExited = 'WorkerExited',
  beforeStop = 'BeforeStop',
}
