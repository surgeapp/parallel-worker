import AsyncLock from 'async-lock'
import { Lock } from './types'

// Options from async-lock package
// See https://github.com/rogierschouten/async-lock#options
export interface LocalLockOptions {
  lockTtl?: number
  maxPending?: number
}

export default class LocalLock implements Lock {
  private readonly lock: AsyncLock
  private readonly lockKey: string

  constructor(lockKey: string, options?: LocalLockOptions) {
    this.lockKey = lockKey
    this.lock = new AsyncLock({
      timeout: options?.lockTtl,
      maxPending: options?.maxPending,
    })
  }

  async lockAndExecute(fn: () => Promise<void>): Promise<void> {
    await this.lock.acquire(this.lockKey, fn)
  }
}
