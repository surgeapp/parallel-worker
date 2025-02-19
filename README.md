# @surgeapp/parallel-worker
> A small utility for orchestrating  parallel access to database by multiple workers

## Motivation
Coming from a real world scenario this tiny library allows you to process lots of data much faster by introducing parallelism. It spawns multiple workers which access an assigned portion of data in database simultaneously, so you can process much more data at the same time without worrying about synchronization or duplicate processing.

![paralell-worker](https://user-images.githubusercontent.com/11503453/80365743-6171d000-8888-11ea-8761-310ba7ef0e7f.png)

## Installation
```console
npm install --save @surgeapp/parallel-worker
```

## Example usage
```js
import { ParallelWorker, WorkerEvent } from '@surgeapp/parallel-worker'

const worker = new ParallelWorker({
  redis: redisInstance,
})

worker.setFetchNext(async lastId => {
  // business logic for fetching next payload that should be processed
  return {
    lastId: newLastId,
    ...payload, // your custom optional payload data
  }
})

worker.setHandler(async ({ lastId, ...payload }) => {
  // process payload
})

worker.on(WorkerEvent.beforeStop, async () => {
  // e.g. usable for closing all connections to exit gracefully
})

worker.start()
```

**Important note**: In order to make the script work properly please make sure that data you fetch is sorted

## Documentation
### Configuration options
```js
const options = {
  redis: redisInstance,
  workers: 4,
  restartWorkerOnExit: true,
  maxAllowedWorkerRestartsCount: 5,
  logging: {
      enabled: true,
      level: 'debug',
  },
  lock: { ... },
  redisKeyPrefix: 'myPrefix',
}
```
| Option | Required |  Default value | Description |
|-|:-:|:-|-|
| `redis` |  yes | - | Redis instance |
| `workers` |  no | `os.cpus().length` | Number of workers to run in parallel |
| `restartWorkerOnExit` |  no | `true` | Specify if it should start a new worker when the old one exits |
| `maxAllowedWorkerRestartsCount` |  no | `workers * 5` | Specify a max allowed count of worker restarts to prevent infinite restarting when some error occurs  |
| `reclaimReservedPayloadOnFail` |  no | `false` | Specify if the payload should be assigned to another worker if the original worker processing the payload failed. <br> **Note:** This will result in some items being **processed more than once** |
| `logging.enabled` |  no | `true` | Specify if logs should be enabled |
| `logging.level` |  no | `info` | Specify minimal log level to show (See [all levels](https://github.com/pinojs/pino/blob/master/docs/api.md#level-string))|
| `lock` | no | `{ type: 'local' }` | See [lock options](#lock-options) |
| `redisKeyPrefix` |  no | `@surgeapp/parallel-worker` | Specify custom key prefix for storing values in Redis |

### Lock options
This package supports **local** *(default option)* and **distributed** *(using Redis)* locking.

#### Example of local locking options
This is default type, if you don't want to update settings, you don't need to provide `lock` option in the configuration.
```js
lock: {
  type: 'local',
  options: {
    lockTtl: 1000,
    maxPending: 100, // max pending tasks
  },
}
```

#### Example of distributed locking options
Please refer to the [original package](https://github.com/mike-marcacci/node-redlock#configuration) for parameters explanation.
```js
lock: {
  type: 'distributed',
  options: {
    redisInstances: [redis1, redis2, redis3],
    lockTtl: 1000,
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200,
    retryJitter: 200,
  },
}
```

### Events
This package implements EventEmitter so you can listen for the following events.
| Event name | Callback payload | Description |
|-|-|-|
| `WorkerEvent.workerExited` | `{ worker, code, signal }` | Emitted when worker process exited |
| `WorkerEvent.beforeStop` | - | Emitted after all workers stopped, right before exiting master process. This is the right place to stop all your connections to database, or other cleanup tasks |

### Handler functions
In order to run script correctly you have to specify the following functions.
#### setFetchNext(async lastId => Promise\<Payload|null|void>)
This function defines the way of fetching the next payload from a database. Make sure **no ID will be returned more than once** (don't forget to use **ordering** in your query) , otherwise those items will be processed multiple times. This function must **return an array of ids**.
To signal no more data just simply use empty return statement.
```js
worker.setFetchNext(async (lastId: ID | null): Promise<Payload|null|void> => {
  // In this example we fetch first 5 items that have value "updated = 0"
  // lastId points to the last processed id (or null if the first operation) in the previous operation so we can continue from this value onward
  const result = await db('users')
    .where('updated', '=', 0)
    .andWhere('id', '>', lastId ?? 0)
    .orderBy('id')
    .limit(5)

  // no more data
  if (result.length === 0) {
    return
  }

  return {
    // return last ID from fetched rows as a pointer for next iteration
    lastId: _.last(result).id, // This field is required!
    // you can also add any additional payload data that will be available in setHandler callback
    idsRange: result.map((row: any) => row.id)
  }
})
```

#### setHandler(async ({ lastId, ...payload }) => Promise\<Payload>)
This function contains your business logic for processing assigned range of data from a database.
You always operate on `payload.idsRange` variable which gives you secure access to the reserved data portion in the database.
```js
worker.setHandler(async ({ lastId, ...payload }: Payload) => {
  // For example, let's increment all items in given range by 1
  await db('users')
    .whereIn('id', payload.idsRange) // idsRange is available in payload variable since we returned this in setFetchNext callback
    .increment('updated', 1)
})
```

#### type Payload
`Payload` interface requires one required parameter **lastId** which specifies last processed id and allows you to start fetching next payload
from this point onward.
```js
interface Payload {
  lastId: ID | null
  [key: string]: any
}
```

## TODOs
- [ ] 🧪 add more tests
- [ ] ⚠️ handle lock errors (timeouts)

## License
See the [LICENSE](LICENSE) file for information.

Made with ❤️ at [STRV](https://strv.com)
