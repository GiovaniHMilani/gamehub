import type { GameHubApi } from '@shared/ipc/api'

/** The one place that reads the preload bridge. Components pass it down to the store actions. */
export const api = (): GameHubApi => window.gamehub
