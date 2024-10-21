import isSomeObservable from 'is-observable'
import { Observable, Subscription } from 'observable-fns'

import { deserialize, serialize } from '../common'
import {
  MasterJobCancelMessage,
  MasterJobRunMessage,
  MasterMessageType,
  MasterTerminateMessage,
  SerializedError,
  WorkerInitMessage,
  WorkerJobErrorMessage,
  WorkerJobResultMessage,
  WorkerJobStartMessage,
  WorkerMessageType,
  WorkerUncaughtErrorMessage
} from '../types/messages'
import { WorkerFunction, WorkerModule } from '../types/worker'
import Implementation from './implementation'

/** Returns `true` if this code is currently running in a worker. */
export const isWorkerRuntime = Implementation.isWorkerRuntime
let exposeCalled = false

const activeSubscriptions = new Map<number, Subscription<any>>()

const isMasterJobCancelMessage = (thing: any): thing is MasterJobCancelMessage =>
  thing && thing.type === MasterMessageType.cancel
const isMasterJobRunMessage = (thing: any): thing is MasterJobRunMessage =>
  thing && thing.type === MasterMessageType.run
const isMasterTerminateMessage = (thing: any): thing is MasterTerminateMessage =>
  thing && thing.type === MasterMessageType.terminate

/**
 * There are issues with `is-observable` not recognizing zen-observable's instances.
 * We are using `observable-fns`, but it's based on zen-observable, too.
 */
const isObservable = (thing: any): thing is Observable<any> => isSomeObservable(thing) || isZenObservable(thing)

function isZenObservable(thing: any): thing is Observable<any> {
  return thing && typeof thing === 'object' && typeof thing.subscribe === 'function'
}

function postFunctionInitMessage(e?: MessagePort) {
  const initMessage: WorkerInitMessage = {
    type: WorkerMessageType.init,
    exposed: {
      type: 'function'
    }
  }
  Implementation.postMessageToMaster(initMessage, e)
}

function postModuleInitMessage(methodNames: string[], e?: MessagePort) {
  const initMessage: WorkerInitMessage = {
    type: WorkerMessageType.init,
    exposed: {
      type: 'module',
      methods: methodNames
    }
  }
  Implementation.postMessageToMaster(initMessage, e)
}

function postJobErrorMessage(uid: number, rawError: Error, e?: MessagePort) {
  const errorMessage: WorkerJobErrorMessage = {
    type: WorkerMessageType.error,
    uid,
    error: serialize(rawError) as any as SerializedError
  }
  Implementation.postMessageToMaster(errorMessage, e)
}

function postJobResultMessage(uid: number, completed: boolean, resultValue?: any, e?: MessagePort) {
  const resultMessage: WorkerJobResultMessage = {
    type: WorkerMessageType.result,
    uid,
    complete: completed ? true : undefined,
    payload: resultValue
  }
  Implementation.postMessageToMaster(resultMessage, e)
}

function postJobStartMessage(uid: number, resultType: WorkerJobStartMessage['resultType'], e?: MessagePort) {
  const startMessage: WorkerJobStartMessage = {
    type: WorkerMessageType.running,
    uid,
    resultType
  }
  Implementation.postMessageToMaster(startMessage, e)
}

function postUncaughtErrorMessage(error: Error, e?: MessagePort) {
  try {
    const errorMessage: WorkerUncaughtErrorMessage = {
      type: WorkerMessageType.uncaughtError,
      error: serialize(error) as any as SerializedError
    }
    Implementation.postMessageToMaster(errorMessage, e)
  } catch (subError) {
    console.error(
      'Not reporting uncaught error back to master thread as it ' +
        'occured while reporting an uncaught error already.' +
        '\nLatest error:',
      subError,
      '\nOriginal error:',
      error
    )
  }
}

async function runFunction(jobUID: number, fn: WorkerFunction, args: any[], e?: MessagePort) {
  let syncResult: any

  try {
    syncResult = fn(...args)
  } catch (error: any) {
    return postJobErrorMessage(jobUID, error, e)
  }

  const resultType = isObservable(syncResult) ? 'observable' : 'promise'
  postJobStartMessage(jobUID, resultType, e)

  if (isObservable(syncResult)) {
    const subscription = syncResult.subscribe(
      (value) => postJobResultMessage(jobUID, false, serialize(value), e),
      (error) => {
        postJobErrorMessage(jobUID, serialize(error) as any, e)
        activeSubscriptions.delete(jobUID)
      },
      () => {
        postJobResultMessage(jobUID, true, e)
        activeSubscriptions.delete(jobUID)
      }
    )
    activeSubscriptions.set(jobUID, subscription)
  } else {
    try {
      const result = await syncResult
      postJobResultMessage(jobUID, true, serialize(result), e)
    } catch (error) {
      postJobErrorMessage(jobUID, serialize(error) as any, e)
    }
  }
}

/**
 * Expose a function or a module (an object whose values are functions)
 * to the main thread. Must be called exactly once in every worker thread
 * to signal its API to the main thread.
 *
 * @param exposed Function or object whose values are functions
 */
export function expose(exposed: WorkerFunction | WorkerModule<any>, e?: MessagePort) {
  if (!Implementation.isWorkerRuntime()) {
    throw Error('expose() called in the master thread.')
  }

  if (exposeCalled && !e) {
    throw Error(
      'expose() called more than once. This is not possible. Pass an object to expose() if you want to expose multiple functions.'
    )
  }

  exposeCalled = true

  if (typeof exposed === 'function') {
    Implementation.subscribeToMasterMessages((messageData) => {
      if (isMasterJobRunMessage(messageData) && !messageData.method) {
        runFunction(messageData.uid, exposed, messageData.args.map(deserialize), e)
      } else if (isMasterJobCancelMessage(messageData)) {
        const jobUID = messageData.uid
        const subscription = activeSubscriptions.get(jobUID)

        if (subscription) {
          subscription.unsubscribe()
          activeSubscriptions.delete(jobUID)
        }
      } else if (isMasterTerminateMessage(messageData)) {
        Implementation.terminate(e)
      }
    }, e)
    postFunctionInitMessage(e)
  } else if (typeof exposed === 'object' && exposed) {
    Implementation.subscribeToMasterMessages((messageData) => {
      if (isMasterJobRunMessage(messageData) && messageData.method) {
        runFunction(messageData.uid, exposed[messageData.method], messageData.args.map(deserialize), e)
      } else if (isMasterJobCancelMessage(messageData)) {
        const jobUID = messageData.uid
        const subscription = activeSubscriptions.get(jobUID)

        if (subscription) {
          subscription.unsubscribe()
          activeSubscriptions.delete(jobUID)
        }
      } else if (isMasterTerminateMessage(messageData)) {
        Implementation.terminate(e)
      }
    }, e)

    const methodNames = Object.keys(exposed).filter((key) => typeof exposed[key] === 'function')
    postModuleInitMessage(methodNames, e)
  } else {
    throw Error(`Invalid argument passed to expose(). Expected a function or an object, got: ${exposed}`)
  }
}

interface SharedWorkerGlobalScope {
  onconnect: (event: MessageEvent) => void
}

export function exposeShared(exposed: WorkerFunction | WorkerModule<any>) {
  const _self: SharedWorkerGlobalScope = self as any

  _self.onconnect = function (e: MessageEvent) {
    const port = Object.freeze(e.ports[0])
    console.log('On connect port called: ', port)
    expose(exposed, port)
  }
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && Implementation.isWorkerRuntime()) {
  self.addEventListener('error', (event) => {
    // Post with some delay, so the master had some time to subscribe to messages
    setTimeout(() => postUncaughtErrorMessage(event.error || event), 250)
  })
  self.addEventListener('unhandledrejection', (event) => {
    const error = (event as any).reason
    if (error && typeof (error as any).message === 'string') {
      // Post with some delay, so the master had some time to subscribe to messages
      setTimeout(() => postUncaughtErrorMessage(error), 250)
    }
  })
}

if (typeof process !== 'undefined' && typeof process.on === 'function' && Implementation.isWorkerRuntime()) {
  process.on('uncaughtException', (error) => {
    // Post with some delay, so the master had some time to subscribe to messages
    setTimeout(() => postUncaughtErrorMessage(error), 250)
  })
  process.on('unhandledRejection', (error) => {
    if (error && typeof (error as any).message === 'string') {
      // Post with some delay, so the master had some time to subscribe to messages
      setTimeout(() => postUncaughtErrorMessage(error as any), 250)
    }
  })
}
