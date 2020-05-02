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
import { ParallelWorker, Event, ID } from '@surgeapp/parallel-worker'

const parallelWorker = new ParallelWorker({
  // redis instance or anything that complies to StorageEngine interface (see docs)
  storage: redis,
})

parallelWorker.setLoadNextRange(async (lastId: ID | null): ID[] => {
  // business logic for fetching next range of IDs that should be processed
})

parallelWorker.setHandler(async ({ idsRange }: { idsRange: ID[]}) => {
  // process range of IDs
})

parallelWorker.on(ParallelWorkerEvent.beforeStop, async () =>
  // e.g. usable for closing all connections to exit gracefully
})

parallelWorker.start()
```

**Important note**: In order to make the script work properly please make sure that data you fetch is sorted

## Documentation
### Configuration options
```js
{
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
| `ParallelWorkerEvent.workerExited` | `{ worker: cluster.Worker, code: number, signal: string\|null }` | Emitted when worker process exited |
| `ParallelWorkerEvent.beforeStop` | - | Emitted after all workers are stopped, right before exiting master process. This is the right place to stop all your connections to database, or other cleanup tasks |

### Handler functions
In order to run script correctly you have to specify the following functions.
#### setLoadNextRange(async ({ lastId }) => Promise<ID[]>)
This function defines the way of fetching the next range of ids from database. Make sure that **no ID will be returned more than once** (don't forget to use **ordering** in your query) , otherwise those items will be processed multiple times. This function must **return an array of ids**.
```js
parallelWorker.setLoadNextRange(async (lastId: ID | null): ID[] => {
  // In this example we fetch first 5 items that have value "updated = 0"
  // lastId points to the last processed id (or null if the first operation) in the previous operation so we can continue from this value onwards
  const result = await db('users')
    .where('updated', '=', 0)
    .andWhere('id', '>', lastId ?? 0)
    .orderBy('id')
    .limit(5)
  const idsRange = result.map((row: any) => row.id)

  // return range of IDs
  return idsRange
})
```

#### setHandler(async ({ idsRange, lastId }) => Promise<void>)
This function contains your business logic for processing assigned range of data from database. You always operate on `idsRange` variable which gives you a secure access to the reserved data portion in database
```js
parallelWorker.setHandler(async ({ idsRange }: { idsRange: ID[]}) => {
  // For example, let's increment all items in given range by 1
  await db('users')
    .whereIn('id', idsRange)
    .increment('updated', 1)
})
```

## TODOs
- [ ] 🧪 add more tests
- [ ] 🌎🔒 add option to save lock externally - required in distributed systems, now it only works locally (https://github.com/mike-marcacci/node-redlock)

## License
See the [LICENSE](LICENSE) file for information.

Made with ❤️ at [STRV](https://strv.com)
