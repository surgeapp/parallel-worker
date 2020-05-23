export type LockType = 'local' | 'distributed'

export interface Lock {
  lockAndExecute: (fn: () => Promise<void>) => Promise<void>
}
