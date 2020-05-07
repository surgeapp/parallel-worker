/* eslint-disable @typescript-eslint/no-explicit-any */
import { Level } from 'pino'

export interface StorageEngine {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<any>
}

export interface LoggingOptions {
  enabled?: boolean
  level?: Level
}

export interface Options {
  storage: StorageEngine
  workers?: number
  restartWorkerOnExit?: boolean
  maxAllowedWorkerRestartsCount?: number
  logging?: LoggingOptions
  // Should comply to AsyncLockOptions
  lockOptions?: { [key: string]: any }
  storageKeyPrefix?: string
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
