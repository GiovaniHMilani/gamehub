import type { GameHubApi } from '../src/shared/ipc/api'

// Page-side global used inside Playwright `evaluate` callbacks (shell page only).
declare global {
  interface Window {
    readonly gamehub: GameHubApi
  }
}

export {}
