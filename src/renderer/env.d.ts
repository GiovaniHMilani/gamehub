/// <reference types="vite/client" />

import type { GameHubApi } from '@shared/ipc/api'

declare global {
  interface Window {
    readonly gamehub: GameHubApi
  }
}

export {}
