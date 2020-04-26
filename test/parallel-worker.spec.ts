import redis from './helpers/redis'
import { ParallelWorker } from '../src'

describe('ParallelWorker', () => {
  let parallelWorker: ParallelWorker
  beforeEach(async () => {
    parallelWorker = new ParallelWorker({
      storage: redis,
      workers: 4,
    })
  })

  it('should throw an error when .setHandler() is not called', () => {
    expect(() => parallelWorker.start()).toThrowErrorMatchingSnapshot()
  })

  it('should throw an error when .setLoadNextRange() is not called', () => {
    parallelWorker.setHandler(async () => 0)
    expect(() => parallelWorker.start()).toThrowErrorMatchingSnapshot()
  })

  // TODO: add other tests
})
