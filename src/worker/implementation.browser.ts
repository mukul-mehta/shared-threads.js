/// <reference lib="dom" />
import { AbstractedWorkerAPI } from '../types/worker'

interface WorkerGlobalScope {
  addEventListener(eventName: string, listener: (event: Event) => void): void
  postMessage(message: any, e?: MessagePort): void
  removeEventListener(eventName: string, listener: (event: Event) => void): void
}

declare const self: WorkerGlobalScope

const isWorkerRuntime: AbstractedWorkerAPI['isWorkerRuntime'] = function isWorkerRuntime() {
  const isWindowContext = typeof self !== 'undefined' && typeof Window !== 'undefined' && self instanceof Window
  return typeof self !== 'undefined' && !isWindowContext ? true : false
}

const postMessageToMaster: AbstractedWorkerAPI['postMessageToMaster'] = function postMessageToMaster(
  data,
  port?: MessagePort
) {
  if (!port) self.postMessage(data)
  else port.postMessage(data)
}

const subscribeToMasterMessages: AbstractedWorkerAPI['subscribeToMasterMessages'] = function subscribeToMasterMessages(
  onMessage,
  port?: MessagePort
) {
  const messageHandler = (messageEvent: MessageEvent) => {
    onMessage(messageEvent.data)
  }

  if (port) {
    console.log('[SHARED WORKER] Subscribing to master messages')
    port.addEventListener('message', messageHandler as EventListener)
    port.start()
  } else {
    console.log('[WEB WORKER] Subscribing to master messages')
    self.addEventListener('message', messageHandler as EventListener)
  }

  const unsubscribe = () => {
    if (port) {
      port.removeEventListener('message', messageHandler as EventListener)
    } else {
      self.removeEventListener('message', messageHandler as EventListener)
    }
  }

  return unsubscribe
}

const terminate = (e?: MessagePort) => {
  if (e) {
    e.close()
  }
}

export default {
  isWorkerRuntime,
  postMessageToMaster,
  subscribeToMasterMessages,
  terminate
}
