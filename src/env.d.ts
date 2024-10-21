/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_THREADS_DEBUG: boolean
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
