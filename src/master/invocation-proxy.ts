/*
 * This source file contains the code for proxying calls in the master thread to calls in the workers
 * by `.postMessage()`-ing.
 *
 * Keep in mind that this code can make or break the program's performance! Need to optimize more…
 */
import { multicast, Observable } from 'observable-fns'

import { deserialize, serialize } from '../common'
import { ObservablePromise } from '../observable-promise'
import { ModuleMethods, ModuleProxy, ProxyableFunction, Worker as TWorker } from '../types/master'
import {
  MasterJobCancelMessage,
  MasterJobRunMessage,
  MasterMessageType,
  WorkerJobErrorMessage,
  WorkerJobResultMessage,
  WorkerJobStartMessage,
  WorkerMessageType
} from '../types/messages'

let nextJobUID = 1

type WorkerType = SharedWorker | TWorker

type EventListenerType = 'message' | 'unhandledrejection'

const sharedWorkerExists = typeof SharedWorker !== 'undefined'

const addEventListener = (worker: WorkerType, listener: EventListener, type: EventListenerType = 'message') => {
  if (sharedWorkerExists && worker instanceof SharedWorker) {
    type === 'message' ? (worker.port.onmessage = listener) : (worker.onerror = listener)
  } else {
    worker.addEventListener(type, listener)
  }
}

const isJobErrorMessage = (data: any): data is WorkerJobErrorMessage => data && data.type === WorkerMessageType.error
const isJobResultMessage = (data: any): data is WorkerJobResultMessage => data && data.type === WorkerMessageType.result
const isJobStartMessage = (data: any): data is WorkerJobStartMessage => data && data.type === WorkerMessageType.running

function createObservableForJob<ResultType>(worker: WorkerType, jobUID: number): Observable<ResultType> {
  return new Observable((observer) => {
    const porter = (sharedWorkerExists && worker instanceof SharedWorker ? worker.port : worker) as
      | TWorker
      | MessagePort
    let asyncType: 'observable' | 'promise' | undefined

    const messageHandler = ((event: MessageEvent) => {
      if (!event.data || event.data.uid !== jobUID) return

      if (isJobStartMessage(event.data)) {
        asyncType = event.data.resultType
      } else if (isJobResultMessage(event.data)) {
        if (asyncType === 'promise') {
          if (typeof event.data.payload !== 'undefined') {
            observer.next(deserialize(event.data.payload))
          }
          observer.complete()
          porter.removeEventListener('message', messageHandler)
        } else {
          if (event.data.payload) {
            observer.next(deserialize(event.data.payload))
          }
          if (event.data.complete) {
            observer.complete()
            porter.removeEventListener('message', messageHandler)
          }
        }
      } else if (isJobErrorMessage(event.data)) {
        const error = deserialize(event.data.error as any)
        if (asyncType === 'promise' || !asyncType) {
          observer.error(error)
        } else {
          observer.error(error)
        }
        porter.removeEventListener('message', messageHandler)
      }
    }) as EventListener

    addEventListener(worker, messageHandler, 'message')

    if (sharedWorkerExists && worker instanceof SharedWorker) {
      worker.port.start()
    }

    return () => {
      if (asyncType === 'observable' || !asyncType) {
        const cancelMessage: MasterJobCancelMessage = {
          type: MasterMessageType.cancel,
          uid: jobUID
        }
        porter.postMessage(cancelMessage, [])
      }
      porter.removeEventListener('message', messageHandler)
    }
  })
}

function prepareArguments(rawArgs: any[]): { args: any[] } {
  if (rawArgs.length === 0) {
    // Exit early if possible
    return {
      args: []
    }
  }

  const args: any[] = []

  for (const arg of rawArgs) {
    args.push(serialize(arg))
  }

  return {
    args
  }
}

export function createProxyFunction<Args extends any[], ReturnType>(worker: WorkerType, method?: string) {
  return ((...rawArgs: Args) => {
    const uid = nextJobUID++
    const { args } = prepareArguments(rawArgs)
    const runMessage: MasterJobRunMessage = {
      type: MasterMessageType.run,
      uid,
      method,
      args
    }
    const porter = (sharedWorkerExists && worker instanceof SharedWorker ? worker.port : worker) as
      | TWorker
      | MessagePort

    try {
      porter.postMessage(runMessage)
    } catch (error) {
      return ObservablePromise.from(Promise.reject(error))
    }

    return ObservablePromise.from(multicast(createObservableForJob<ReturnType>(worker, uid)))
  }) as any as ProxyableFunction<Args, ReturnType>
}

export function sendTerminationMessageToSharedWorker(worker: WorkerType) {
  if (sharedWorkerExists && worker instanceof SharedWorker) {
    console.log('[MASTER] Terminating Shared Worker')
    const terminateMessage = {
      type: MasterMessageType.terminate
    }
    try {
      worker.port.postMessage(terminateMessage)
    } catch (error) {
      console.log('[MASTER] Could not terminate worker with error', { error })
    }
  }
}

export function createProxyModule<Methods extends ModuleMethods>(
  worker: WorkerType,
  methodNames: string[]
): ModuleProxy<Methods> {
  const proxy: any = {}

  for (const methodName of methodNames) {
    proxy[methodName] = createProxyFunction(worker, methodName)
  }

  return proxy
}
