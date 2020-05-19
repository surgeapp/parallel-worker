import cluster from 'cluster'
import { ParallelWorker, ParallelWorkerEvent, ID, Payload } from '../src'
import db, { prepareData } from './helpers/db'
import redis from './helpers/redis'

// Since it's hard to test multiple processes with Jest
// this script runs worker outside test environment
// and then in test cases it only checks the result
// TODO: this is just a quick solution to make sure the expected result
//  is met but it would be nice to add more tests (unit tests?)
//  that check the individual parts of the flow

const parallelWorker = new ParallelWorker({
  workers: 4,
  redis,
  restartWorkerOnExit: false,
  logging: {
    level: 'error',
  },
})

parallelWorker.setFetchNext(async (lastId: ID | null) => {
  const result = await db('users')
    .where('updated', '=', 0)
    .andWhere('id', '>', lastId ?? 0)
    .orderBy('id')
    .limit(5)

  if (result.length === 0) {
    return null
  }

  return {
    lastId: result[result.length - 1].id,
    idsRange: result.map((row: any) => row.id),
  }
})

parallelWorker.setHandler(async ({ idsRange }: Payload) => {
  await db('users')
    .whereIn('id', idsRange)
    .increment('updated', 1)
})

parallelWorker.on(ParallelWorkerEvent.beforeStop, async () => {
  await db.destroy()
  await redis.quit()
})

void (async () => {
  if (cluster.isMaster) {
    await prepareData()
    await redis.flushdb()
  }
  parallelWorker.start()
})()
