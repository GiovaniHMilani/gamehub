import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Notice } from '@shared/domain/types'
import type { GameHubApi } from '@shared/ipc/api'
import { EVENTS, IPC } from '@shared/ipc/channels'
import type { InstanceEvent } from '@shared/ipc/instance-events'
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
    setAllowedOrigins: (input) => call(IPC.gamesSetAllowedOrigins, input),
    remove: (gameId) => call(IPC.gamesRemove, { gameId }),
    update: (input) => call(IPC.gamesUpdate, input),
  },
  instances: {
    list: () => call(IPC.instancesList),
    snapshot: () => call(IPC.instancesSnapshot),
    get: (instanceId) => call(IPC.instancesGet, { instanceId }),
    create: (input) => call(IPC.instancesCreate, input),
    start: (instanceId) => call(IPC.instancesStart, { instanceId }),
    stop: (instanceId) => call(IPC.instancesStop, { instanceId }),
    restart: (instanceId) => call(IPC.instancesRestart, { instanceId }),
    focus: (instanceId) => call(IPC.instancesFocus, { instanceId }),
    remove: (instanceId) => call(IPC.instancesRemove, { instanceId }),
    onChanged: (listener) => {
      // The wrapper hides the raw IpcRendererEvent; the same reference is removed on unsubscribe.
      const wrapper = (_event: IpcRendererEvent, event: InstanceEvent): void => listener(event)
      ipcRenderer.on(EVENTS.instancesEvent, wrapper)
      return () => {
        ipcRenderer.removeListener(EVENTS.instancesEvent, wrapper)
      }
    },
  },
  notices: {
    list: () => call(IPC.noticesList),
    resolve: (input) => call(IPC.noticesResolve, input),
    onChanged: (listener) => {
      const wrapper = (_event: IpcRendererEvent, notices: readonly Notice[]): void => listener(notices)
      ipcRenderer.on(EVENTS.noticesChanged, wrapper)
      return () => {
        ipcRenderer.removeListener(EVENTS.noticesChanged, wrapper)
      }
    },
  },
  stage: {
    // One-way: no result to wait for, and nothing for the page to learn from a rejected layout.
    setLayout: (slots) => ipcRenderer.send(IPC.stageSetLayout, { slots }),
  },
}

contextBridge.exposeInMainWorld('gamehub', api)
