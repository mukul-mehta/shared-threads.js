import { Observable } from 'observable-fns'

import { deserialize } from '../common'
import { createPromiseWithResolver } from '../promise'
import { $errors, $events, $terminate, $worker } from '../symbols'
import {
  ArbitraryWorkerInterface,
  ExposedToThreadType,
  PrivateThreadProps,
  Worker as TWorker,
  WorkerEvent,
  WorkerEventType,
  WorkerInternalErrorEvent,
  WorkerMessageEvent,
  WorkerTerminationEvent
} from '../types/master'
import { WorkerInitMessage, WorkerUncaughtErrorMessage } from '../types/messages'
import { WorkerFunction, WorkerModule } from '../types/worker'
import { createProxyFunction, createProxyModule, sendTerminationMessageToSharedWorker } from './invocation-proxy'

type WorkerType = SharedWorker | TWorker

type EventListenerType = 'message' | 'unhandledrejection'

const sharedWorkerExists = typeof SharedWorker !== 'undefined'

const addEventListener = (worker: WorkerType, listener: EventListener, type: EventListenerType = 'message') => {
  if (sharedWorkerExists && worker instanceof SharedWorker) {
    worker.port.addEventListener(type, listener)
    worker.port.start()
  } else {
    worker.addEventListener(type, listener)
  }
}

const isInitMessage = (data: any): data is WorkerInitMessage => data && data.type === ('init' as const)
const isUncaughtErrorMessage = (data: any): data is WorkerUncaughtErrorMessage =>
  data && data.type === ('uncaughtError' as const)

const initMessageTimeout = 10000

async function withTimeout<T>(promise: Promise<T>, timeoutInMs: number, errorMessage: string): Promise<T> {
  let timeoutHandle: any

  const timeout = new Promise<never>((resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(Error(errorMessage)), timeoutInMs)
  })
  const result = await Promise.race([promise, timeout])

  clearTimeout(timeoutHandle)
  return result
}

function receiveInitMessage(worker: WorkerType): Promise<WorkerInitMessage> {
  const porter = sharedWorkerExists && worker instanceof SharedWorker ? worker.port : worker
  return new Promise((resolve, reject) => {
    const messageHandler = ((event: MessageEvent) => {
      console.log('[MASTER] Message from worker before finishing initialization', { data: event.data })
      if (isInitMessage(event.data)) {
        porter.removeEventListener('message', messageHandler)
        resolve(event.data)
      } else if (isUncaughtErrorMessage(event.data)) {
        porter.removeEventListener('message', messageHandler)
        reject(deserialize(event.data.error))
      }
    }) as EventListener
    addEventListener(worker, messageHandler, 'message')
  })
}

function createEventObservable(worker: WorkerType, workerTermination: Promise<any>): Observable<WorkerEvent> {
  const porter = sharedWorkerExists && worker instanceof SharedWorker ? worker.port : worker
  return new Observable<WorkerEvent>((observer) => {
    const messageHandler = ((messageEvent: MessageEvent) => {
      const workerEvent: WorkerMessageEvent<any> = {
        type: WorkerEventType.message,
        data: messageEvent.data
      }
      observer.next(workerEvent)
    }) as EventListener
    const rejectionHandler = ((errorEvent: PromiseRejectionEvent) => {
      console.log('[MASTER] Unhandled Promise Rejection in worker', { error: errorEvent })
      const workerEvent: WorkerInternalErrorEvent = {
        type: WorkerEventType.internalError,
        error: Error(errorEvent.reason)
      }
      observer.next(workerEvent)
    }) as EventListener

    addEventListener(worker, messageHandler, 'message')
    addEventListener(worker, rejectionHandler, 'unhandledrejection')

    if (sharedWorkerExists && worker instanceof SharedWorker) {
      worker.port.start()
    }

    workerTermination.then(() => {
      const terminationEvent: WorkerTerminationEvent = {
        type: WorkerEventType.termination
      }
      porter.removeEventListener('message', messageHandler)
      porter.removeEventListener('unhandledrejection', rejectionHandler)
      observer.next(terminationEvent)
      observer.complete()
    })
  })
}

function createTerminator(worker: TWorker): { termination: Promise<void>; terminate: () => Promise<void> } {
  const [termination, resolver] = createPromiseWithResolver<void>()
  const terminate = async () => {
    console.log('[MASTER] Terminating Web Worker')
    worker.terminate()
    resolver()
  }
  return { terminate, termination }
}

function createSharedWorkerTerminator(worker: SharedWorker): {
  termination: Promise<void>
  terminate: () => Promise<void>
} {
  const [termination, resolver] = createPromiseWithResolver<void>()

  const terminate = async () => {
    sendTerminationMessageToSharedWorker(worker)
    worker.port.close()
    resolver()
  }
  return { terminate, termination }
}

function setPrivateThreadProps<T extends object>(
  raw: T,
  worker: WorkerType,
  workerEvents: Observable<WorkerEvent>,
  terminate: () => Promise<void>
): T & PrivateThreadProps {
  const workerErrors = workerEvents
    .filter((event) => event.type === WorkerEventType.internalError)
    .map((errorEvent) => (errorEvent as WorkerInternalErrorEvent).error)

  const result = Object.assign(raw, {
    [$errors]: workerErrors,
    [$events]: workerEvents,
    [$terminate]: terminate,
    [$worker]: worker
  })
  return result
}

/**
 * Spawn a new thread. Takes a fresh worker instance, wraps it in a thin
 * abstraction layer to provide the transparent API and verifies that
 * the worker has initialized successfully.
 *
 * @param worker Instance of `Worker`. Only a web worker for now.
 * @param [options]
 * @param [options.timeout] Init message timeout. Default: 10000 or set by environment variable.
 */
export async function spawn<Exposed extends WorkerFunction | WorkerModule<any> = ArbitraryWorkerInterface>(
  worker: WorkerType,
  options?: { timeout?: number }
): Promise<ExposedToThreadType<Exposed>> {
  console.log('[MASTER] Initializing New Thread')

  if (sharedWorkerExists && worker instanceof SharedWorker) worker.port.start()

  const timeout = options && options.timeout ? options.timeout : initMessageTimeout
  const initMessage = await withTimeout(
    receiveInitMessage(worker),
    timeout,
    `Timeout: Did not receive an init message from worker after ${timeout}ms. Make sure the worker calls expose().`
  )
  const exposed = initMessage.exposed

  const { termination, terminate } =
    sharedWorkerExists && worker instanceof SharedWorker
      ? createSharedWorkerTerminator(worker)
      : createTerminator(worker as TWorker)
  const events = createEventObservable(worker, termination)

  if (exposed.type === 'function') {
    const proxy = createProxyFunction(worker)
    return setPrivateThreadProps(proxy, worker, events, terminate) as ExposedToThreadType<Exposed>
  } else if (exposed.type === 'module') {
    const proxy = createProxyModule(worker, exposed.methods)
    return setPrivateThreadProps(proxy, worker, events, terminate) as ExposedToThreadType<Exposed>
  } else {
    const type = (exposed as WorkerInitMessage['exposed']).type
    throw Error(`Worker init message states unexpected type of expose(): ${type}`)
  }
}
