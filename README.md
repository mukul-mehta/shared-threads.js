<h1>This library was created for usage in a specific project. I will be updating it and releasing. This is only an archive of the original version</h1>
<h1 align="center">shared-threads.js</h1>

<br />

We love threads, so much so that we forked the [`threads`](https://github.com/andywer/threads.js) library to add support for `SharedWorker` . Our usecase for `SharedWorker` is that we want to have only one worker running across all tabs (An `iframe` counts as a tab too, and since we insert our IFrame into every page, we might as well say we run on all of your tabs :) ).

This library provides support for both `SharedWorker` and standard `Worker` and there is little difference in usage.

## Caution

This library was created for a specific usecase and might not provide all features of the parent `threads` library. To reduce the complexity of code, I removed a bunch of code from the original repo. The main parts removed were:

1. Implementation on `node.js`. Currently this library is meant to run exclusively on the web and does not support NodeJS workers
2. `Transferrables` when sending data using `postMessage`. All data is passed at once, and there is no support for `Transferrable` objects (used for example to stream an `ArrayBuffer` to a worker or vice versa)
3. Custom serializer and serialization options. All data is serialized/deserialized using the default `JSONSerializable` class which essentiially calls `JSON.stringify` and `JSON.parse` so be careful when passing objects that can't be transformed with the Structured Clone algorithm

For detailed documentation, refer to [threads.js documentation](https://threads.js.org/). The API is essentially the same and most things should work exactly as mentioned in the docs

## Getting Started

To use this library, you must:

1. Create a new worker, and expose some functions, which will be called from the master thread. As a basic example:

```typescript
// worker.ts
import { expose, exposeShared } from 'shared-threads/worker'

import sha256 from 'js-sha256'
import { nanoid } from 'nanoid'

const functions = {
  hashPassword(password: string, salt: string) {
    return sha256(password + salt)
  },

  randomString(length = 5) {
    return `RANDOM_${nanoid(length)}`
  }
}

// Here lies the difference when using a `SharedWorker` vs a standard `WebWorker`

// If you want to use a `SharedWorker`
exposeShared(functions)

// To use a standard `Worker`
expose(functions)

// This is needed only to make the master/worker calls typesafe
export type WorkerInterface = typeof functions
```

2. Use this new worker inside of your master process. In this example, it is used inside of a React component

```typescript
// master.ts
import { useEffect, useState } from 'react'

import { spawn, Thread, Worker, SharedWorker } from '@workduck-io/mex-threads.js'

import { type WorkerInterface } from './worker'

const App: React.FC<any> = () => {
  const [messageReply, setMessageReply] = useState<string>()

  useEffect(() => {
    async function runWorker() {
      const url = new URL('./worker.ts', import.meta.url)

      let worker
      // If using a SharedWorker
      worker = await spawn<WorkerInterface>(new SharedWorker(url, { type: 'module' }))

      // In case of a standard WebWorker
      worker = await spawn<WorkerInterface>(new Worker(url, { type: 'module' }))

      const hashedPassword = await worker.hashPassword('RANDOM_PASSWORD', 'NAMAK_HARAAM')
      const randomString = await worker.randomString()
      setMessageReply(JSON.stringify({ hashedPassword, randomString }))
    }
    runWorker()
  }, [])

  return (
    <div className="App">
      <h1>Vite + React + Worker Example</h1>
      <p>Worker Says: {messageReply}</p>
    </div>
  )
}

export default App
```

### expose()

Use `expose()` to make a function or an object containing methods callable from the master thread and the thread needs to be an instance of a standard `WebWorker`

In case of exposing an object, `spawn()` will asynchronously return an object exposing all the object's functions. If you `expose()` a function, `spawn` will also return a callable function, not an object.

### exposeShared()

Use `exposeShared()` to make a function or an object containing methods callable from the master thread and the thread needs to be an instance of a `SharedWorker`

In case of exposing an object, `spawn()` will asynchronously return an object exposing all the object's functions. If you `exposeShared()` a function, `spawn` will also return a callable function, not an object.

Internally, `exposeShared` calls `expose` with some additional setup:

1. Communication over `SharedWorker` happens over `MessagePort` and we need to pass a port to which the worker can `postMessage` and listen using `onMessage`. This port is initialized when the worker's `onconnect` listener is invoked
2. One way of dealing with this would be to have the `onconnect` listener in the worker code, and the `onconnect` would look like this:

```ts
onconnect = (e) => {
  const port = e.ports[0]
  expose(functions, port)
}
```

3. Instead, we call this inside of the `exposeShared` call, and pass the correct port to the actual `expose` method. This means the only difference in the code between a `SharedWorker` and `WebWorker` is whether `expose` or `exposeShared` is called.

### spawn()

Spawns a new instance of either `SharedWorker` or `Worker` (not the ones provided by the browser, but the extended ones exposed by the library).

This instance can be used to proxy the call to the same method inside of the worker. For example, calling `worker.randomString()` in the above example calls the exposed `randomString` method inside the worker and returns the value to the master process.

If the worker's function returns a promise or an observable then you can just use the return value as such in the master code. If the function returns a primitive value, expect the master function to return a promise resolving to that value.

## License

MIT
