import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { InstanceSummary } from '@shared/domain/types'
import type { GameHubApi } from '@shared/ipc/api'
import { EVENTS, IPC } from '@shared/ipc/channels'
import type { Result } from '@shared/ipc/result'

/**
 * Minimal capability bridge (ADR-0005). Channels are fixed constants; the
 * renderer can neither pick a channel nor reach ipcRenderer, Node or Electron.
 */
const call = <T>(channel: string, payload?: unknown): Promise<Result<T>> => ipcRenderer.invoke(channel, payload)

const api: GameHubApi = {
  games: {
    create: (input) => call(IPC.gamesCreate, input),
    list: () => call(IPC.gamesList),
  },
  instances: {
    list: () => call(IPC.instancesList),
    get: (instanceId) => call(IPC.instancesGet, { instanceId }),
    create: (input) => call(IPC.instancesCreate, input),
    start: (instanceId) => call(IPC.instancesStart, { instanceId }),
    stop: (instanceId) => call(IPC.instancesStop, { instanceId }),
    restart: (instanceId) => call(IPC.instancesRestart, { instanceId }),
    remove: (instanceId) => call(IPC.instancesRemove, { instanceId }),
    onChanged: (listener) => {
      // The wrapper hides the raw IpcRendererEvent; the same reference is removed on unsubscribe.
      const wrapper = (_event: IpcRendererEvent, summary: InstanceSummary): void => listener(summary)
      ipcRenderer.on(EVENTS.instancesChanged, wrapper)
      return () => {
        ipcRenderer.removeListener(EVENTS.instancesChanged, wrapper)
      }
    },
  },
}

contextBridge.exposeInMainWorld('gamehub', api)
