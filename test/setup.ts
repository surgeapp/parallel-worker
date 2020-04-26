import redis from './helpers/redis'
import db from './helpers/db'

afterAll(async () => {
  await Promise.all([
    redis.quit(),
    db.destroy(),
  ])
})
