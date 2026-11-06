import { gameHost } from '../model/game-identity'
import { needsAttention } from '../model/instance-actions'
import type { DomainState } from './domain-store'
import type { LibraryFilter } from './ui-store'

/**
 * Pure derivations over the domain store. Components select the SMALLEST thing they need
 * (an instance, a list of ids, a few counts) so an unrelated change does not re-render them.
 */
type Domain = Pick<DomainState, 'games' | 'instancesById' | 'accountIdsByGame' | 'gameById'>

const fold = (text: string): string => text.toLocaleLowerCase()

function accountMatchesFilter(state: Domain, id: string, filter: LibraryFilter): boolean {
  const instance = state.instancesById[id]
  if (instance === undefined) return false
  if (filter === 'running') return instance.status === 'running'
  if (filter === 'problems') return needsAttention(instance.status)
  return true
}

function gameMatchesQuery(state: Domain, gameId: string, query: string): boolean {
  const game = state.gameById[gameId]
  if (game === undefined) return false
  return [game.name, gameHost(game.startUrl), game.description].some((field) => fold(field).includes(query))
}

/**
 * Accounts of a game to show: they must match the filter, and the search must match either
 * the game itself (then all of its accounts are fine) or the account's own label.
 */
export function visibleAccountIds(state: Domain, gameId: string, query: string, filter: LibraryFilter): readonly string[] {
  const q = fold(query.trim())
  const ids = state.accountIdsByGame[gameId] ?? []
  const gameHit = q === '' || gameMatchesQuery(state, gameId, q)
  return ids.filter((id) => {
    if (!accountMatchesFilter(state, id, filter)) return false
    if (gameHit) return true
    return fold(state.instancesById[id]?.label ?? '').includes(q)
  })
}

/** Games to show, by name. With no filter and no search, every game, even one without accounts. */
export function visibleGameIds(state: Domain, query: string, filter: LibraryFilter): readonly string[] {
  const q = fold(query.trim())
  const ordered = state.games.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return ordered
    .filter((game) => {
      if (filter === 'all' && q === '') return true
      if (visibleAccountIds(state, game.id, query, filter).length > 0) return true
      return filter === 'all' && gameMatchesQuery(state, game.id, q) // a game matched by name, even with no accounts
    })
    .map((game) => game.id)
}

export interface GameCounts {
  readonly total: number
  readonly running: number
  readonly busy: number
  readonly problems: number
}

export function gameCounts(state: Pick<DomainState, 'instancesById' | 'accountIdsByGame'>, gameId: string): GameCounts {
  let running = 0
  let busy = 0
  let problems = 0
  const ids = state.accountIdsByGame[gameId] ?? []
  for (const id of ids) {
    const status = state.instancesById[id]?.status
    if (status === 'running') running++
    else if (status === 'starting' || status === 'stopping') busy++
    else if (status === 'error' || status === 'crashed') problems++
  }
  return { total: ids.length, running, busy, problems }
}

/** The instance the Play screen shows: the requested one if it is still running, else the first running one. */
export function effectiveFocusedId(runningIds: readonly string[], requested: string | null): string | null {
  if (requested !== null && runningIds.includes(requested)) return requested
  return runningIds[0] ?? null
}

/** "3 accounts, 2 running": plain words, no separators. */
export function describeCounts(counts: GameCounts): string {
  if (counts.total === 0) return 'No accounts yet'
  const accounts = `${counts.total} ${counts.total === 1 ? 'account' : 'accounts'}`
  const parts: string[] = []
  if (counts.running > 0) parts.push(`${counts.running} running`)
  if (counts.busy > 0) parts.push(`${counts.busy} changing`)
  if (counts.problems > 0) parts.push(`${counts.problems} with a problem`)
  return parts.length === 0 ? accounts : `${accounts}, ${parts.join(', ')}`
}
