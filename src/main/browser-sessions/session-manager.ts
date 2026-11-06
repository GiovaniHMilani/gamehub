import { isPartitionId, partitionNameFor } from '@shared/domain/partition'
import type { SessionIdentity } from '@shared/domain/types'
import { DomainError } from '../errors'
import type { Logger } from '../logging/logger'

/**
 * The subset of Electron's `Session` this module relies on.
 * Electron.Session satisfies it structurally (all members exist in Electron 45).
 */
export interface ManagedSession {
  clearStorageData(): Promise<void>
  clearCache(): Promise<void>
  clearAuthCache(): Promise<void>
  flushStorageData(): void
  readonly cookies: { flushStore(): Promise<void> }
}

export interface SessionManagerDeps<S extends ManagedSession> {
  /** accountId -> partitionId from the repository; undefined if unknown. */
  resolvePartitionId(accountId: string): string | undefined
  /** `session.fromPartition`. Injected so tests need no Electron. */
  fromPartition(partitionName: string): S
  /** Applied exactly once per session object (permissions, downloads, ...). */
  configure(session: S): void
  log: Logger
}

/**
 * The only module that obtains Electron sessions for accounts (ADR-0002).
 *
 * Invariants:
 *  - one account -> one persistent partition `persist:gh-<partitionId>`;
 *  - a partition is owned by exactly one account (violations throw);
 *  - partition names come from stored ids, never from renderer input;
 *  - `defaultSession` is never used;
 *  - a failing session is never silently replaced by a new one.
 *
 * `session.fromPartition` is synchronous and idempotent, so there is no async
 * window in which two callers could create a duplicate session.
 */
export class SessionManager<S extends ManagedSession> {
  private readonly sessions = new Map<string, S>() // partitionId -> session
  private readonly ownerByPartition = new Map<string, string>() // partitionId -> accountId

  constructor(private readonly deps: SessionManagerDeps<S>) {}

  identityOf(accountId: string): SessionIdentity {
    const partitionId = this.deps.resolvePartitionId(accountId)
    if (partitionId === undefined) throw new DomainError('NOT_FOUND', 'Account not found')
    if (!isPartitionId(partitionId)) throw new DomainError('INTERNAL', 'Stored partition id is malformed')
    return { accountId, partitionId, partitionName: partitionNameFor(partitionId) }
  }

  /** Returns the account's persistent session, loading it on first use. */
  get(accountId: string): S {
    return this.load(this.identityOf(accountId))
  }

  /** Flushes cookies and DOM storage to disk. */
  async flush(accountId: string): Promise<void> {
    const session = this.sessions.get(this.identityOf(accountId).partitionId)
    if (session !== undefined) await this.flushSession(session)
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.flushSession(session)))
  }

  /**
   * Wipes all browser data of an identity and releases our reference.
   * Used by remove (ADR-0008: the directory itself is deleted on next boot).
   */
  async purge(identity: SessionIdentity): Promise<void> {
    const session = this.load(identity)
    await session.clearStorageData()
    await session.clearCache()
    await session.clearAuthCache()
    this.sessions.delete(identity.partitionId)
    this.ownerByPartition.delete(identity.partitionId)
    this.deps.log.info('session.destroyed', { accountId: identity.accountId, partition: identity.partitionName })
  }

  /** Number of sessions currently held (for leak checks). */
  get loadedCount(): number {
    return this.sessions.size
  }

  private load(identity: SessionIdentity): S {
    const owner = this.ownerByPartition.get(identity.partitionId)
    if (owner !== undefined && owner !== identity.accountId) {
      // Two accounts claiming one partition would break the core invariant.
      throw new DomainError('INTERNAL', 'Partition is already owned by another account')
    }
    const existing = this.sessions.get(identity.partitionId)
    if (existing !== undefined) return existing

    const session = this.deps.fromPartition(identity.partitionName)
    this.deps.configure(session)
    this.sessions.set(identity.partitionId, session)
    this.ownerByPartition.set(identity.partitionId, identity.accountId)
    this.deps.log.info('session.loaded', { accountId: identity.accountId, partition: identity.partitionName })
    return session
  }

  private async flushSession(session: S): Promise<void> {
    session.flushStorageData()
    await session.cookies.flushStore()
  }
}
