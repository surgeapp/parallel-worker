import Redlock from 'redlock'
import { Redis } from '../types'
import { Lock } from './types'

// Options from async-lock package
export interface RedisLockOptions {
  redisInstances: Redis[]
  // the maximum amount of time you want the resource locked in milliseconds,
  // keeping in mind that you can extend the lock up until
  // the point when it expires
  lockTtl: number
  // the expected clock drift (in ms); for more details
  // see http://redis.io/topics/distlock
  driftFactor: number
  // the max number of times Redlock will attempt
  // to lock a resource before erroring
  retryCount: number
  // the time in ms between attempts (in ms)
  retryDelay: number
  // the max time in ms randomly added to retries
  // to improve performance under high contention
  // see https://www.awsarchitectureblog.com/2015/03/backoff.html
  retryJitter: number
}

export default class RedisLock implements Lock {
  private readonly lockKey: string
  private readonly redlock: Redlock
  private readonly lockTtl: number

  constructor(lockKey: string, options: RedisLockOptions) {
    this.lockKey = lockKey
    this.redlock = new Redlock(options.redisInstances, {
      driftFactor: options.driftFactor,
      retryCount: options.retryCount,
      retryDelay: options.retryDelay,
      retryJitter: options.retryJitter,
    })
    this.lockTtl = options.lockTtl
  }

  async lockAndExecute(fn: () => Promise<void>): Promise<void> {
    const lock = await this.redlock.lock(this.lockKey, this.lockTtl)
    await fn()
    await lock.unlock()
  }
}
