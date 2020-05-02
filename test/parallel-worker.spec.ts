import { ParallelWorker } from '../src'
import redis from './helpers/redis'

describe('ParallelWorker', () => {
  let parallelWorker: ParallelWorker
  // eslint-disable-next-line require-await
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
    // eslint-disable-next-line require-await
    parallelWorker.setHandler(async () => 0)
    expect(() => parallelWorker.start()).toThrowErrorMatchingSnapshot()
  })

  // TODO: add other tests
})
