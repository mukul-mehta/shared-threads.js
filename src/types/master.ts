/// <reference lib="dom" />
// Cannot use `compilerOptions.esModuleInterop` and default import syntax
// See <https://github.com/microsoft/TypeScript/issues/28009>
import { Observable } from 'observable-fns'

import { ObservablePromise } from '../observable-promise'
import { $errors, $events, $terminate, $worker } from '../symbols'
import { WorkerFunction, WorkerModule } from './worker'

interface ObservableLikeSubscription {
  unsubscribe(): any
}
interface ObservableLike<T> {
  subscribe(
    onNext: (value: T) => any,
    onError?: (error: any) => any,
    onComplete?: () => any
  ): ObservableLikeSubscription
  subscribe(listeners: { next?(value: T): any; error?(error: any): any; complete?(): any }): ObservableLikeSubscription
}

export type StripAsync<Type> = Type extends Promise<infer PromiseBaseType>
  ? PromiseBaseType
  : Type extends ObservableLike<infer ObservableBaseType>
  ? ObservableBaseType
  : Type

export type ModuleMethods = { [methodName: string]: (...args: any) => any }

export type ProxyableArgs<Args extends any[]> = Args extends [arg0: infer Arg0, ...rest: infer RestArgs]
  ? [Arg0, ...RestArgs]
  : Args

export type ProxyableFunction<Args extends any[], ReturnType> = Args extends []
  ? () => ObservablePromise<StripAsync<ReturnType>>
  : (...args: ProxyableArgs<Args>) => ObservablePromise<StripAsync<ReturnType>>

export type ModuleProxy<Methods extends ModuleMethods> = {
  [method in keyof Methods]: ProxyableFunction<Parameters<Methods[method]>, ReturnType<Methods[method]>>
}

export interface PrivateThreadProps {
  [$errors]: Observable<Error>
  [$events]: Observable<WorkerEvent>
  [$terminate]: () => Promise<void>
  [$worker]: SharedWorker | Worker
}

export type FunctionThread<Args extends any[] = any[], ReturnType = any> = ProxyableFunction<Args, ReturnType> &
  PrivateThreadProps
export type ModuleThread<Methods extends ModuleMethods = any> = ModuleProxy<Methods> & PrivateThreadProps

// We have those extra interfaces to keep the general non-specific `Thread` type
// as an interface, so it's displayed concisely in any TypeScript compiler output.
interface AnyFunctionThread extends PrivateThreadProps {
  (...args: any[]): ObservablePromise<any>
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface AnyModuleThread extends PrivateThreadProps {
  // Not specifying an index signature here as that would make `ModuleThread` incompatible
}

/** Worker thread. Either a `FunctionThread` or a `ModuleThread`. */
export type Thread = AnyFunctionThread | AnyModuleThread

/** Worker instance. Only a web worker for now*/
export interface Worker extends EventTarget {
  postMessage(value: any): void
  terminate(callback?: (error?: Error, exitCode?: number) => void): void
}
export interface ThreadsWorkerOptions extends WorkerOptions {
  /** Prefix for the path passed to the Worker constructor. Web worker only. */
  _baseURL?: string

  /** Whether to apply CORS protection workaround. Defaults to true. */
  CORSWorkaround?: boolean
}

/** Worker implementation. Only web worker for now. */
export declare class WorkerImplementation extends EventTarget implements Worker {
  constructor(path: string | URL, options?: ThreadsWorkerOptions)
  public postMessage(value: any): void
  public terminate(): void
}

/** Class to spawn workers from source string. */

export interface ImplementationExport {
  shared: typeof SharedWorker | typeof WorkerImplementation
  default: typeof WorkerImplementation
}

/** Event as emitted by worker thread. Subscribe to using `Thread.events(thread)`. */
export enum WorkerEventType {
  internalError = 'internalError',
  message = 'message',
  termination = 'termination'
}

export interface WorkerInternalErrorEvent {
  type: WorkerEventType.internalError
  error: Error
}

export interface WorkerMessageEvent<Data> {
  type: WorkerEventType.message
  data: Data
}

export interface WorkerTerminationEvent {
  type: WorkerEventType.termination
}

export type ArbitraryWorkerInterface = WorkerFunction &
  WorkerModule<string> & { somekeythatisneverusedinproductioncode123: 'magicmarker123' }
export type ArbitraryThreadType = FunctionThread<any, any> & ModuleThread<any>

export type ExposedToThreadType<Exposed extends WorkerFunction | WorkerModule<any>> =
  Exposed extends ArbitraryWorkerInterface
    ? ArbitraryThreadType
    : Exposed extends WorkerFunction
    ? FunctionThread<Parameters<Exposed>, StripAsync<ReturnType<Exposed>>>
    : Exposed extends WorkerModule<any>
    ? ModuleThread<Exposed>
    : never

export type WorkerEvent = WorkerInternalErrorEvent | WorkerMessageEvent<any> | WorkerTerminationEvent
