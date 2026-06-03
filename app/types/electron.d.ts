import type { TgBridge } from '~~/shared/ipc'

declare global {
  interface Window {
    /** Preload bridge — see electron/preload.ts and shared/ipc.ts. */
    tg: TgBridge
  }
}

export {}
