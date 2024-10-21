/// <reference no-default-lib="true"/>
/// <reference lib="webworker" />

interface WorkerGlobalScope {
  addEventListener(eventName: string, listener: (event: Event) => void): void
  postMessage(message: any): void
  removeEventListener(eventName: string, listener: (event: Event) => void): void
}
