/* eslint-disable @typescript-eslint/no-explicit-any, import/no-unused-modules */
import { LevelWithSilent } from 'pino'

export interface StorageEngine {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<any>
}

export interface LoggingOptions {
  enabled?: boolean
  level?: LevelWithSilent
}

export interface Options {
  storage: StorageEngine
  workers?: number
  restartWorkerOnExit?: boolean
  maxAllowedWorkerRestartsCount?: number
  logging?: LoggingOptions
  // Should comply to AsyncLockOptions
  lockOptions?: { [key: string]: any }
  storageKey?: string
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

export interface Payload {
  idsRange: ID[]
  lastId: ID | null
  noMoreData?: boolean
}

export type LoadNextRangeFn = (lastId: ID | null) => Promise<ID[]>

export type PayloadHandlerFn = (payload: Payload) => Promise<any>

export enum Event {
  WorkerExited = 'WorkerExited',
  BeforeStop = 'BeforeStop',
}
