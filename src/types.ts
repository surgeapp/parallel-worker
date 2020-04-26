import { LevelWithSilent } from 'pino'

export interface StorageEngine {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>

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
  stopWorking = 'StopWorking',
  pleaseTellOthersToStopWorking = 'PlsStopNoMoreDataHere',
}

export type ID = string | number

export interface Payload {
  idsRange: ID[]
  lastId: ID | null
}

export type LoadNextRangeFn = (lastId: ID | null) => Promise<ID[]>

export type PayloadHandlerFn = (payload: Payload) => Promise<number>
