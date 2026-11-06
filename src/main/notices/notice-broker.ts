import { randomUUID } from 'node:crypto'
import { parseGameUrl } from '@shared/domain/game-url'
import { parseOriginPattern } from '@shared/domain/origin-pattern'
import type { Notice, NoticeDecision } from '@shared/domain/types'
import { DomainError } from '../errors'
import type { Logger } from '../logging/logger'
import type { BlockedRequest } from '../navigation/blocked'
import { allowedOriginsFor } from '../navigation/policy'
import type { Repositories } from '../persistence/repositories'

export const MAX_PENDING_NOTICES = 5
export const DISMISS_SUPPRESSION_MS = 60_000
const MAX_ALLOWED_ORIGINS = 20 // same cap the IPC schema enforces

interface Pending {
  readonly notice: Notice
  readonly key: string
  /** Latest refused navigation per instance; kept in memory only. */
  readonly retries: Map<string, () => void>
}

export interface NoticeBrokerDeps {
  repos: Repositories
  /** Pushes the game's new allowlist to its live views. */
  applyOrigins(gameId: string): void
  /** Sends the full pending list to the shell. */
  publish(notices: readonly Notice[]): void
  log: Logger
  now?: () => number
}

/**
 * Turns "policy blocked this" into a decision the user can take in one click
 * (ADR-0016), without ever letting the page choose what is shown or allowed.
 *
 *  - only origins that CAN be allowed generate a notice (https, or http on loopback);
 *  - one notice per (game, origin); at most MAX_PENDING_NOTICES at once;
 *  - a dismissed origin is not asked about again for DISMISS_SUPPRESSION_MS;
 *  - "allow" adds exactly that origin to the game (all its accounts), applies it live,
 *    then re-issues the refused navigations.
 */
export class NoticeBroker {
  private readonly pending = new Map<string, Pending>() // notice id -> pending
  private readonly dismissedAt = new Map<string, number>() // key -> ms
  private readonly now: () => number

  constructor(private readonly deps: NoticeBrokerDeps) {
    this.now = deps.now ?? Date.now
  }

  list(): Notice[] {
    return [...this.pending.values()].map((entry) => entry.notice)
  }

  request(request: BlockedRequest): void {
    const { log } = this.deps
    // Same rules as the policy itself: https (http on loopback only), no credentials, a host.
    const parsed = parseGameUrl(request.url)
    if (!parsed.ok) return
    const origin = parsed.url.origin
    // Not allowable as an origin pattern: do not offer what we would refuse anyway.
    if (parseOriginPattern(origin) === null) return

    const record = this.deps.repos.instances.getRecord(request.instanceId)
    if (record === undefined) return
    const { game, account } = record
    if (allowedOriginsFor(game.startUrl, game.allowedOrigins).includes(origin)) return // already allowed: nothing to ask

    const key = `${game.id}|${origin}`
    const dismissed = this.dismissedAt.get(key)
    if (dismissed !== undefined && this.now() - dismissed < DISMISS_SUPPRESSION_MS) {
      log.info('notice.suppressed', { gameId: game.id, origin })
      return
    }

    const existing = [...this.pending.values()].find((entry) => entry.key === key)
    if (existing !== undefined) {
      if (request.retry !== undefined) existing.retries.set(request.instanceId, request.retry) // newest destination wins
      return
    }
    if (this.pending.size >= MAX_PENDING_NOTICES) {
      log.warn('notice.dropped', { gameId: game.id, origin, reason: 'too_many_pending' })
      return
    }

    const notice: Notice = {
      id: randomUUID(),
      instanceId: request.instanceId,
      instanceLabel: account.label,
      gameId: game.id,
      gameName: game.name,
      origin,
      kind: request.kind,
    }
    const retries = new Map<string, () => void>()
    if (request.retry !== undefined) retries.set(request.instanceId, request.retry)
    this.pending.set(notice.id, { notice, key, retries })
    log.info('notice.requested', { gameId: game.id, instanceId: request.instanceId, origin, kind: request.kind })
    this.publish()
  }

  /** @throws DomainError NOT_FOUND for an id that is not pending (stale, already resolved or forged). */
  resolve(noticeId: string, decision: NoticeDecision): void {
    const entry = this.pending.get(noticeId)
    if (entry === undefined) throw new DomainError('NOT_FOUND', 'Notice not found')
    const { notice } = entry

    if (decision === 'dismiss') {
      this.pending.delete(noticeId)
      this.dismissedAt.set(entry.key, this.now())
      this.deps.log.info('notice.dismissed', { gameId: notice.gameId, origin: notice.origin })
      this.publish()
      return
    }

    const game = this.deps.repos.games.get(notice.gameId)
    if (game === undefined) {
      this.pending.delete(noticeId)
      this.publish()
      throw new DomainError('NOT_FOUND', 'Game not found')
    }
    if (!game.allowedOrigins.includes(notice.origin)) {
      if (game.allowedOrigins.length >= MAX_ALLOWED_ORIGINS) {
        throw new DomainError('INVALID_STATE', 'Too many allowed origins for this game')
      }
      this.deps.repos.games.setAllowedOrigins(game.id, [...game.allowedOrigins, notice.origin], this.now())
    }
    this.pending.delete(noticeId)
    this.deps.log.info('notice.allowed', { gameId: game.id, origin: notice.origin })
    this.deps.applyOrigins(game.id) // live views must know before we retry
    for (const [instanceId, retry] of entry.retries) {
      try {
        retry()
      } catch (error) {
        this.deps.log.warn('notice.retry_failed', { instanceId, error })
      }
    }
    this.publish()
  }

  /** The game's allowlist changed by another route (manual edit): drop notices it already satisfies. */
  reconcile(gameId: string): void {
    const game = this.deps.repos.games.get(gameId)
    if (game === undefined) return
    let changed = false
    for (const [id, entry] of this.pending) {
      if (entry.notice.gameId === gameId && allowedOriginsFor(game.startUrl, game.allowedOrigins).includes(entry.notice.origin)) {
        this.pending.delete(id)
        changed = true
      }
    }
    if (changed) this.publish()
  }

  /** The game was removed: nothing about it can be allowed or retried any more. */
  clearForGame(gameId: string): void {
    let changed = false
    for (const [id, entry] of this.pending) {
      if (entry.notice.gameId === gameId) {
        this.pending.delete(id)
        changed = true
      }
    }
    for (const key of this.dismissedAt.keys()) if (key.startsWith(`${gameId}|`)) this.dismissedAt.delete(key)
    if (changed) this.publish()
  }

  /** The instance stopped, crashed or was removed: its refused navigations cannot be redone any more. */
  clearForInstance(instanceId: string): void {
    let changed = false
    for (const [id, entry] of this.pending) {
      entry.retries.delete(instanceId)
      if (entry.notice.instanceId === instanceId && entry.retries.size === 0) {
        this.pending.delete(id)
        changed = true
      }
    }
    if (changed) this.publish()
  }

  private publish(): void {
    this.deps.publish(this.list())
  }
}
