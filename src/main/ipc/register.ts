import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { Game, GameSummary, InstanceSummary } from '@shared/domain/types'
import { IPC } from '@shared/ipc/channels'
import type { ErrorCode, Result } from '@shared/ipc/result'
import { createGameSchema, createInstanceSchema, instanceRefSchema } from '@shared/ipc/schemas'
import { DomainError } from '../errors'
import type { InstanceManager } from '../instances/instance-manager'
import type { Logger } from '../logging/logger'
import type { Repositories } from '../persistence/repositories'
import type { ManagedSession } from '../browser-sessions/session-manager'

export interface IpcDeps<S extends ManagedSession> {
  getShellWindow(): BrowserWindow | null
  manager: InstanceManager<S>
  repos: Repositories
  log: Logger
  now?: () => number
}

const toGameSummary = (game: Game): GameSummary => ({ id: game.id, name: game.name, startUrl: game.startUrl })

/**
 * Registers the complete, fixed set of IPC handlers (ADR-0005).
 *
 * Every handler runs the same pipeline: sender guard -> zod parse -> service
 * -> Result. There is no generic channel; adding a capability means adding a
 * channel constant, a schema and a line here.
 */
export function registerIpc<S extends ManagedSession>(deps: IpcDeps<S>): () => void {
  const { manager, repos, log } = deps
  const now = deps.now ?? Date.now

  /** Only the shell's main frame may call us; game views have no bridge at all. */
  const isShellSender = (event: IpcMainInvokeEvent): boolean => {
    const shell = deps.getShellWindow()
    return shell !== null && !shell.isDestroyed() && event.senderFrame !== null && event.senderFrame === shell.webContents.mainFrame
  }

  const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } })

  /** Common pipeline: sender guard -> (parse) -> service -> Result. */
  function guarded<R>(channel: string, run: (raw: unknown) => R | Promise<R>): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<Result<R>> => {
      if (!isShellSender(event)) {
        log.error('ipc.rejected_sender', { channel })
        return fail('INVALID_ARGUMENT', 'Unauthorized sender')
      }
      try {
        return { ok: true, data: await run(raw) }
      } catch (error) {
        if (error instanceof DomainError) return fail(error.code, error.message)
        log.error('ipc.handler_failed', { channel, error })
        return fail('INTERNAL', 'Internal error')
      }
    })
  }

  function handle<T extends z.ZodType, R>(channel: string, schema: T, run: (input: z.output<T>) => R | Promise<R>): void {
    guarded(channel, (raw) => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        // Field paths only: values may be sensitive.
        log.warn('ipc.invalid_argument', { channel, fields: parsed.error.issues.map((i) => i.path.join('.')) })
        throw new DomainError('INVALID_ARGUMENT', 'Invalid arguments')
      }
      return run(parsed.data)
    })
  }

  function handleNoInput<R>(channel: string, run: () => R | Promise<R>): void {
    guarded(channel, () => run())
  }

  handleNoInput(IPC.gamesList, () => repos.games.list().map(toGameSummary))
  handle(IPC.gamesCreate, createGameSchema, (input) =>
    toGameSummary(repos.games.create({ id: crypto.randomUUID(), name: input.name, startUrl: input.startUrl }, now())),
  )
  handleNoInput(IPC.instancesList, (): InstanceSummary[] => manager.list())
  handle(IPC.instancesGet, instanceRefSchema, (input) => manager.get(input.instanceId))
  handle(IPC.instancesCreate, createInstanceSchema, (input) => manager.createInstance(input))
  handle(IPC.instancesStart, instanceRefSchema, (input) => manager.start(input.instanceId))
  handle(IPC.instancesStop, instanceRefSchema, (input) => manager.stop(input.instanceId))
  handle(IPC.instancesRestart, instanceRefSchema, (input) => manager.restart(input.instanceId))
  handle(IPC.instancesRemove, instanceRefSchema, async (input) => {
    await manager.remove(input.instanceId)
    return null
  })

  return () => {
    for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel)
  }
}
