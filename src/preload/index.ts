import { contextBridge } from 'electron'
import type { GameHubApi } from '@shared/ipc/api'

// Phase 0: the bridge exists but exposes no capabilities yet. Each capability
// is added explicitly with a channel defined in src/shared/ipc (ADR-0005).
const api: GameHubApi = Object.freeze({})

contextBridge.exposeInMainWorld('gamehub', api)
