import type { CreateGameInput, GameSummary, InstanceSummary, Notice, UpdateGameInput } from '@shared/domain/types'
import type { GameHubApi } from '@shared/ipc/api'
import type { Result } from '@shared/ipc/result'
import type { InstanceAction } from '../model/instance-actions'
import { describeFailure, type Operation } from '../model/messages'
import { useDomainStore } from './domain-store'
import { refreshGames } from './sync'
import { useUiStore } from './ui-store'

/**
 * Everything the user can ask for. Each action calls the typed IPC API, which validates in Main,
 * and turns a failure into a short message. The renderer decides nothing about the outcome:
 * state changes come back as events.
 */
type Api = Pick<GameHubApi, 'games' | 'instances' | 'notices'>

const ui = () => useUiStore.getState()

function toastFailure(operation: Operation, code: Parameters<typeof describeFailure>[1]): void {
  ui().pushToast('error', describeFailure(operation, code))
}

const OPERATION: Readonly<Record<'start' | 'stop' | 'restart', Operation>> = { start: 'start', stop: 'stop', restart: 'restart' }

/**
 * Start, stop, restart, open (navigate) and remove (asks for confirmation first).
 * Resolves to whether the request was carried out: a duplicate click or a refusal is `false`.
 */
export async function performInstanceAction(api: Api, instanceId: string, action: InstanceAction): Promise<boolean> {
  if (action === 'open') {
    ui().openInstance(instanceId)
    return true
  }
  if (action === 'remove') {
    ui().openDialog({ kind: 'confirmRemove', instanceId })
    return true
  }
  // The same action twice is ignored; a different one (Cancel while starting) must stay possible.
  if (ui().pending[instanceId] === action) return false
  ui().setPending(instanceId, action)
  try {
    const result: Result<InstanceSummary> = await api.instances[action](instanceId)
    if (!result.ok) toastFailure(OPERATION[action], result.error.code)
    return result.ok
  } catch {
    toastFailure(OPERATION[action], 'INTERNAL')
    return false
  } finally {
    ui().setPending(instanceId, null)
  }
}

/**
 * The game's main verb, and the button says which one it is:
 *  - something is running: "Open". It only takes the user to those accounts (the grid when there are
 *    several) and starts NOTHING. Starting the others is a choice made account by account.
 *  - nothing is running: "Play". It starts every stopped account, then takes the user to Play.
 * It never starts an account in error or crashed (that is Retry, a deliberate choice), and a failed
 * start has already told the user why.
 */
export async function playGame(api: Api, gameId: string): Promise<void> {
  const ids = useDomainStore.getState().accountIdsByGame[gameId] ?? []
  const statusOf = (id: string) => useDomainStore.getState().instancesById[id]?.status
  const running = ids.filter((id) => statusOf(id) === 'running')
  const toStart = running.length > 0 ? [] : ids.filter((id) => statusOf(id) === 'stopped')
  const started = await Promise.all(toStart.map(async (id) => ((await performInstanceAction(api, id, 'start')) ? id : null)))
  const ready = [...running, ...started.filter((id): id is string => id !== null)]
  const first = ready[0]
  if (first === undefined) return
  ui().openInstance(first)
  if (ready.length > 1) ui().setPlayMode('grid')
}

/** After the user confirmed in the dialog. */
export async function confirmRemoveInstance(api: Api, instanceId: string): Promise<boolean> {
  const instance = useDomainStore.getState().instancesById[instanceId]
  const label = instance?.label ?? 'The account'
  try {
    const result = await api.instances.remove(instanceId)
    if (!result.ok) {
      // It may already be gone (removed elsewhere): that is the outcome the user wanted.
      if (result.error.code === 'NOT_FOUND') return true
      toastFailure('remove', result.error.code)
      return false
    }
    ui().pushToast('success', `${label} was removed.`)
    return true
  } catch {
    toastFailure('remove', 'INTERNAL')
    return false
  }
}

/**
 * Removes a game and all of its accounts (Main stops them and wipes their data one by one).
 * Returns null when it is done, or the sentence to show in the dialog. The game list is refreshed
 * either way: after a failure some accounts may already be gone, and the screen must say so.
 */
export async function confirmRemoveGame(api: Api, gameId: string): Promise<string | null> {
  const name = useDomainStore.getState().gameById[gameId]?.name ?? 'The game'
  let result: Result<null>
  try {
    result = await api.games.remove(gameId)
  } catch {
    return describeFailure('remove', 'INTERNAL')
  }
  await refreshGames(api)
  if (result.ok) {
    ui().pushToast('success', `${name} was removed.`)
    return null
  }
  if (result.error.code === 'NOT_FOUND') return null // removed elsewhere: what the user wanted
  return describeFailure('remove', result.error.code)
}

/** Saves a game's name, address and description. The result goes back to the form, which shows any failure itself. */
export async function updateGame(api: Api, input: UpdateGameInput): Promise<Result<GameSummary>> {
  const result = await api.games.update(input)
  if (result.ok) {
    await refreshGames(api)
    ui().pushToast('success', `Saved changes to ${result.data.name}.`)
  }
  return result
}

export async function createGame(api: Api, input: CreateGameInput): Promise<Result<GameSummary>> {
  const result = await api.games.create(input)
  if (result.ok) {
    await refreshGames(api)
    ui().pushToast('success', `${result.data.name} was added to your library.`)
  }
  return result
}

export async function createAccount(
  api: Api,
  input: { gameId: string; label: string },
  options: { startAfter: boolean },
): Promise<Result<InstanceSummary>> {
  const result = await api.instances.create(input)
  if (!result.ok) return result
  const game = useDomainStore.getState().gameById[input.gameId]
  ui().pushToast('success', `${result.data.label} was added${game === undefined ? '' : ` to ${game.name}`}.`)
  if (options.startAfter) void performInstanceAction(api, result.data.id, 'start')
  return result
}

export async function setGameOrigins(api: Api, gameId: string, allowedOrigins: readonly string[]): Promise<Result<GameSummary>> {
  const result = await api.games.setAllowedOrigins({ gameId, allowedOrigins })
  if (result.ok) await refreshGames(api)
  return result
}

/** The user answered a blocked-request notice (ADR-0016). Wording is part of the contract tests rely on. */
export async function resolveNotice(api: Api, notice: Notice, decision: 'allow' | 'dismiss'): Promise<void> {
  try {
    const result = await api.notices.resolve({ noticeId: notice.id, decision })
    if (!result.ok) {
      toastFailure('save', result.error.code)
      return
    }
  } catch {
    toastFailure('save', 'INTERNAL')
    return
  }
  if (decision !== 'allow') return
  ui().pushToast(
    'success',
    notice.kind === 'popup'
      ? `Allowed ${notice.origin}. Click the sign-in button again.`
      : `Allowed ${notice.origin} for ${notice.gameName} and retried.`,
  )
  await refreshGames(api)
}

/** Moves keyboard focus into the game after the Play screen has placed its view. */
export async function focusInstance(api: Api, instanceId: string): Promise<void> {
  try {
    await api.instances.focus(instanceId)
  } catch {
    // Focus is a nicety; if it fails the user can still click the game.
  }
}
