/* eslint-disable @typescript-eslint/no-explicit-any */
import { Level } from 'pino'

export interface Redis {
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

export interface Options {
  redis: Redis
  workers?: number
  restartWorkerOnExit?: boolean
  maxAllowedWorkerRestartsCount?: number
  logging?: LoggingOptions
  // Should comply to AsyncLockOptions
  lockOptions?: { [key: string]: any }
  redisKeyPrefix?: string
  reclaimReservedPayloadOnFail?: boolean
}

export interface Message {
  type: MessageType
  payload?: Payload
}

export enum MessageType {
  getNextId = 'GetNextId',
  setNextId = 'SetNextId',
}

export type ID = string | number

export interface LastProcessedIdData {
  lastProcessedId: ID|null
  noMoreData?: boolean
}

export interface Payload {
  lastId: ID | null
  noMoreData?: boolean
  // eslint-disable-next-line @typescript-eslint/member-ordering
  [key: string]: any
}

export type FetchNextPayloadFn = (lastId: ID | null) => Promise<Payload|null|void>

export type PayloadHandlerFn = (payload: Payload) => Promise<void>

export enum ParallelWorkerEvent {
  workerExited = 'WorkerExited',
  beforeStop = 'BeforeStop',
}
