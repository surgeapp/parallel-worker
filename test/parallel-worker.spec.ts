import { ParallelWorker } from '../src'
import redis from './helpers/redis'
import db from './helpers/db'

describe('ParallelWorker', () => {
  let parallelWorker: ParallelWorker
  // eslint-disable-next-line require-await
  beforeEach(async () => {
    parallelWorker = new ParallelWorker({
      redis,
    })
  })

  it('should throw an error when .setHandler() is not called', () => {
    expect(() => parallelWorker.start()).toThrowErrorMatchingSnapshot()
  })

  it('should throw an error when .setLoadNextRange() is not called', () => {
    // eslint-disable-next-line require-await
    parallelWorker.setHandler(async () => void 0)
    expect(() => parallelWorker.start()).toThrowErrorMatchingSnapshot()
  })

  it('should update each item exactly once', async () => {
    // Check ./worker.ts for context
    const items = await db('users').select('updated')
    items.forEach((item: any) => {
      expect(Number(item.updated)).toBe(1)
    })
  })

  // TODO: add other tests
})
