import { create } from 'zustand'
import type { GameSummary, InstanceSummary } from '@shared/domain/types'
import type { SyncView } from '@shared/ipc/event-sync'
import { assignHues } from '../model/game-identity'

/**
 * A READ-MODEL of what Main owns (ADR-0004, ADR-0015). Nothing here is authoritative:
 * the lifecycle lives in Main, the browser state in the Electron session, the metadata in
 * SQLite. The store only holds the last consistent copy it was given.
 *
 * Indexes are rebuilt on every sync, but arrays and records KEEP THEIR IDENTITY when their
 * content did not change. That is what lets a row subscribe to `instancesById[id]` and
 * re-render only when its own instance changed.
 */
export type LoadStatus = 'loading' | 'ready' | 'error'

export interface DomainState {
  readonly status: LoadStatus
  readonly games: readonly GameSummary[]
  readonly gameById: Readonly<Record<string, GameSummary>>
  /** A distinct colour per game, by creation order (see game-identity). */
  readonly hueByGameId: Readonly<Record<string, number>>
  readonly instancesById: Readonly<Record<string, InstanceSummary>>
  /** Account ids per game, ordered by label. Games without accounts map to an empty list. */
  readonly accountIdsByGame: Readonly<Record<string, readonly string[]>>
  /** Running instances, ordered by game name then account label (the order the UI shows them). */
  readonly runningIds: readonly string[]
  readonly seq: number | null
  readonly resyncs: number
  readonly gamesLoaded: boolean

  applySync(view: SyncView): void
  setGames(games: readonly GameSummary[]): void
  /** The first snapshot or the games list could not be loaded. Ignored once data is on screen. */
  failLoading(): void
  reset(): void
}

export const NO_IDS: readonly string[] = Object.freeze([])
const NO_GAMES: readonly GameSummary[] = Object.freeze([])

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i])
}

function reuse<T>(previous: readonly T[] | undefined, next: readonly T[]): readonly T[] {
  if (next.length === 0) return NO_IDS as readonly T[]
  return previous !== undefined && sameArray(previous, next) ? previous : next
}

function sameRecord<T>(a: Readonly<Record<string, T>>, b: Readonly<Record<string, T>>): boolean {
  const keys = Object.keys(b)
  return Object.keys(a).length === keys.length && keys.every((key) => a[key] === b[key])
}

const byLabel = (a: InstanceSummary, b: InstanceSummary): number => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
const byName = (a: GameSummary, b: GameSummary): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

interface Indexes {
  gameById: Record<string, GameSummary>
  hueByGameId: Record<string, number>
  instancesById: Record<string, InstanceSummary>
  accountIdsByGame: Record<string, readonly string[]>
  runningIds: readonly string[]
}

export function buildIndexes(
  games: readonly GameSummary[],
  instances: readonly InstanceSummary[],
  previous: Pick<DomainState, 'gameById' | 'hueByGameId' | 'instancesById' | 'accountIdsByGame' | 'runningIds'>,
): Indexes {
  const gameById: Record<string, GameSummary> = {}
  for (const game of games) gameById[game.id] = game

  const instancesById: Record<string, InstanceSummary> = {}
  const accountsByGame = new Map<string, InstanceSummary[]>()
  for (const instance of instances) {
    instancesById[instance.id] = instance
    const list = accountsByGame.get(instance.gameId)
    if (list === undefined) accountsByGame.set(instance.gameId, [instance])
    else list.push(instance)
  }

  const accountIdsByGame: Record<string, readonly string[]> = {}
  for (const game of games) accountIdsByGame[game.id] = NO_IDS
  for (const [gameId, list] of accountsByGame) {
    accountIdsByGame[gameId] = reuse(
      previous.accountIdsByGame[gameId],
      list.toSorted(byLabel).map((instance) => instance.id),
    )
  }

  // Display order: games by name, then accounts by label; instances of unknown games last.
  const orderedGameIds = [...games.toSorted(byName).map((game) => game.id), ...[...accountsByGame.keys()].filter((id) => gameById[id] === undefined)]
  const running: string[] = []
  for (const gameId of orderedGameIds) {
    for (const id of accountIdsByGame[gameId] ?? NO_IDS) {
      if (instancesById[id]?.status === 'running') running.push(id)
    }
  }

  const hueByGameId = assignHues(games)

  return {
    hueByGameId: sameRecord(previous.hueByGameId, hueByGameId) ? (previous.hueByGameId as Record<string, number>) : hueByGameId,
    gameById: sameRecord(previous.gameById, gameById) ? (previous.gameById as Record<string, GameSummary>) : gameById,
    instancesById: sameRecord(previous.instancesById, instancesById) ? (previous.instancesById as Record<string, InstanceSummary>) : instancesById,
    accountIdsByGame: sameRecord(previous.accountIdsByGame, accountIdsByGame)
      ? (previous.accountIdsByGame as Record<string, readonly string[]>)
      : accountIdsByGame,
    runningIds: reuse(previous.runningIds, running),
  }
}

/**
 * `ready` needs BOTH the snapshot and the games. Until then a partial arrival must not hide a
 * failure: if one half failed we stay on the error screen, whose "Try again" resets to loading.
 */
function keepError(status: LoadStatus): LoadStatus {
  return status === 'error' ? 'error' : 'loading'
}

const INITIAL = {
  status: 'loading' as LoadStatus,
  games: NO_GAMES,
  gameById: {} as Readonly<Record<string, GameSummary>>,
  hueByGameId: {} as Readonly<Record<string, number>>,
  instancesById: {} as Readonly<Record<string, InstanceSummary>>,
  accountIdsByGame: {} as Readonly<Record<string, readonly string[]>>,
  runningIds: NO_IDS,
  seq: null as number | null,
  resyncs: 0,
  gamesLoaded: false,
}

export const useDomainStore = create<DomainState>()((set, get) => ({
  ...INITIAL,

  applySync(view) {
    const state = get()
    const indexes = buildIndexes(state.games, view.instances, state)
    set({
      ...indexes,
      seq: view.seq,
      resyncs: view.resyncs,
      status: state.gamesLoaded ? 'ready' : keepError(state.status),
    })
  },

  setGames(games) {
    const state = get()
    const instances = Object.values(state.instancesById)
    const indexes = buildIndexes(games, instances, state)
    set({
      ...indexes,
      games,
      gamesLoaded: true,
      status: state.seq !== null ? 'ready' : keepError(state.status),
    })
  },

  failLoading() {
    const state = get()
    // Once the library is on screen a failed refresh must not replace it with an error page.
    if (state.status === 'ready') return
    set({ status: 'error' })
  },

  reset() {
    set({ ...INITIAL })
  },
}))
