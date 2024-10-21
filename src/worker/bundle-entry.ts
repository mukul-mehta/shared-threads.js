import { expose } from './index'

export * from './index'

if (typeof self !== 'undefined') {
  ;(self as any).expose = expose
}
