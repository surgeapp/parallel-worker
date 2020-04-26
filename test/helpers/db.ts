import * as initKnex from 'knex'

const knex = initKnex({
  client: 'pg',
  connection: {
    host: 'localhost',
    user: 'test',
    password: 'test',
    database: 'parallel-worker-test',
  },
})

export const prepareData = async (items = 50): Promise<void> => {
  await knex('users').delete()
  const rows = []
  for (let i = 0; i < items; i += 1) {
    rows.push({
      name: `user-${i}`,
    })
  }
  await knex.batchInsert('users', rows, items / 2)
}

export default knex
