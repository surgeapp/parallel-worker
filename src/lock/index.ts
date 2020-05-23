import { Lock, LockType } from './types'
import LocalLock, { LocalLockOptions } from './local'
import RedisLock, { RedisLockOptions } from './redis'

const getLockStrategy = (lockType: LockType, lockKey: string, lockOptions?: LocalLockOptions | RedisLockOptions): Lock => {
  switch (lockType) {
    case 'local':
      return new LocalLock(lockKey, lockOptions as LocalLockOptions)
    case 'distributed':
      return new RedisLock(lockKey, lockOptions as RedisLockOptions)
    default:
      throw new Error(`Unimplemented lock strategy "${lockType}"`)
  }
}

export default getLockStrategy
