import { Worker as WorkerType } from '../types/master'
import { getWorkerImplementation, isWorkerRuntime } from './implementation'

export { FunctionThread, ModuleThread } from '../types/master'
export { spawn } from './spawn'
export { isWorkerRuntime }
export { Thread } from './thread'

export type Worker = WorkerType

/** Worker implementation. Only web worker for now */
export const Worker = getWorkerImplementation().default
export const SharedWorker = getWorkerImplementation().shared
