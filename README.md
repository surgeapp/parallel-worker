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
import { ParallelWorker, ParallelWorkerEvent } from '@surgeapp/parallel-worker'

const worker = new ParallelWorker({
  // redis instance or anything that complies to StorageEngine interface (see docs)
  storage: redis,
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

worker.on(ParallelWorkerEvent.beforeStop, async () => {
  // e.g. usable for closing all connections to exit gracefully
})

worker.start()
```

**Important note**: In order to make the script work properly please make sure that data you fetch is sorted

## Documentation
### Configuration options
```js
const options = {
  storage: {
    get: (key: string): Promise<any> => { ... },
    set: (key: string, value: any): Promise<any> => { ... },
  },
  workers: 4,
  restartWorkerOnExit: true,
  maxAllowedWorkerRestartsCount: 5,
  logging: {
      enabled: true,
      level: 'debug',
  },
  lockOptions: { ... },
  storageKey: 'last-processed-id',
}
```
| Option | Required |  Default value | Description |
|-|:-:|:-|-|
| `storage.set` |  yes | - | Used for marking progress. Storing last processed id |
| `storage.get` |  yes | - | Used for marking progress. Retrieving last processed id |
| `workers` |  no | `os.cpus().length` | Number of workers to run in parallel |
| `restartWorkerOnExit` |  no | `true` | Specify if it should start a new worker when the old one exits |
| `maxAllowedWorkerRestartsCount` |  no | `workers * 5` | Specify max allowed count of worker restarts to prevent infinite restarting when some error occurrs  |
| `logging.enabled` |  no | `true` | Specify if logs should be enabled |
| `logging.level` |  no | `info` | Specify minimal log level to show (See [all levels](https://github.com/pinojs/pino/blob/master/docs/api.md#level-string))|
| `lockOptions` |  no | `{}` | Please refer to *async-lock* [docs](https://github.com/rogierschouten/async-lock#options) |
| `storageKey` |  no | `parallel-worker-lastId` | Specify custom key for storing last processed ID in storage |

*Note*: Storage option can be easily satisfied by providing Redis instance (see the example above)

### Events
This package implements EventEmitter so you can listen for the following events.
| Event name | Callback payload | Description |
|-|-|-|
| `ParallelWorkerEvent.workerExited` | `{ worker, code, signal }` | Emitted when worker process exited |
| `ParallelWorkerEvent.beforeStop` | - | Emitted after all workers stopped, right before exiting master process. This is the right place to stop all your connections to database, or other cleanup tasks |

### Handler functions
In order to run script correctly you have to specify the following functions.
#### setFetchNext(async ({ lastId }) => Promise\<Payload>)
This function defines the way of fetching the next payload from a database. Make sure **no ID will be returned more than once** (don't forget to use **ordering** in your query) , otherwise those items will be processed multiple times. This function must **return an array of ids**.
```js
worker.setFetchNext(async (lastId: ID | null): Promise<Payload> => {
  // In this example we fetch first 5 items that have value "updated = 0"
  // lastId points to the last processed id (or null if the first operation) in the previous operation so we can continue from this value onward
  const result = await db('users')
    .where('updated', '=', 0)
    .andWhere('id', '>', lastId ?? 0)
    .orderBy('id')
    .limit(5)

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
from this point onward. The library also uses `noMoreData` for internal logic which you can use in your handler callback as well if you find it useful.
```js
interface Payload {
  lastId: ID | null
  noMoreData?: boolean
  [key: string]: any
}
```

## TODOs
- [ ] 🧪 add more tests
- [ ] 🌎🔒 add option to save lock externally - required in distributed systems, now it only works locally (https://github.com/mike-marcacci/node-redlock)

## License
See the [LICENSE](LICENSE) file for information.

Made with ❤️ at [STRV](https://strv.com)
