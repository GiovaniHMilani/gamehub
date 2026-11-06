import { randomUUID } from 'node:crypto'
import type {
  CreateInstanceInput,
  InstanceStatus,
  InstanceSummary,
} from '@shared/domain/types'
import { DomainError } from '../errors'
import { allowedOriginsFor } from '../navigation/policy'
import type { Logger } from '../logging/logger'
import type { ManagedSession, SessionManager } from '../browser-sessions/session-manager'
import type { InstanceRecord, Repositories } from '../persistence/repositories'
import { Disposables } from './disposables'
import { KeyedSerialQueue } from './keyed-queue'
import { LoadAbortedError, LoadFailedError, ProcessGoneError, type MountedView, type ViewHost } from './ports'
import { nextStatus, type InstanceEvent } from './state-machine'

/** A live (non-stopped) instance. Exists in memory only (ADR-0004). */
class InstanceRuntime {
  status: InstanceStatus = 'stopped'
  errorCode: string | null = null
  /** Bumped on every START; stale async continuations compare against it. */
  generation = 0
  view: MountedView | null = null
  startAbort: AbortController | null = null
  readonly disposables = new Disposables()

  constructor(readonly instanceId: string) {}

  apply(event: InstanceEvent): void {
    const next = nextStatus(this.status, event)
    if (next === null) {
      throw new DomainError('INVALID_STATE', `Cannot ${event} while ${this.status}`)
    }
    this.status = next
  }
}

type CommandKind = 'start' | 'stop' | 'other'

export interface InstanceManagerDeps<S extends ManagedSession> {
  repos: Repositories
  sessions: SessionManager<S>
  host: ViewHost<S>
  log: Logger
  now?: () => number
}

/**
 * Owns the logical lifecycle of GameInstances (ADR-0004).
 *
 * Concurrency model:
 *  - every command for an instance runs through a per-instance serial queue;
 *  - consecutive identical start (or stop) calls coalesce into one operation;
 *  - `stop`/`remove` first abort an in-flight start, then queue behind it;
 *  - a stop requested after a start was queued cancels that start (stopEpoch);
 *  - a generation counter invalidates stale continuations.
 */
export class InstanceManager<S extends ManagedSession> {
  private readonly runtimes = new Map<string, InstanceRuntime>()
  private readonly queue = new KeyedSerialQueue()
  private readonly lastCommand = new Map<string, { kind: CommandKind; promise: Promise<unknown> }>()
  private readonly stopEpochs = new Map<string, number>()
  private readonly listeners = new Set<(summary: InstanceSummary) => void>()
  private readonly removedListeners = new Set<(instanceId: string) => void>()
  private readonly log: Logger
  private readonly now: () => number
  private closing = false

  constructor(private readonly deps: InstanceManagerDeps<S>) {
    this.log = deps.log
    this.now = deps.now ?? Date.now
  }

  // ---- queries ---------------------------------------------------------

  list(): InstanceSummary[] {
    return this.deps.repos.instances.listRecords().map((record) => this.summarize(record))
  }

  get(instanceId: string): InstanceSummary {
    return this.summarize(this.requireRecord(instanceId))
  }

  onChange(listener: (summary: InstanceSummary) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Fires after an instance (and its account) has been fully removed. */
  onRemoved(listener: (instanceId: string) => void): () => void {
    this.removedListeners.add(listener)
    return () => this.removedListeners.delete(listener)
  }

  /** Live runtimes (for leak checks): empty once everything is stopped. */
  get liveRuntimeCount(): number {
    return this.runtimes.size
  }

  // ---- commands --------------------------------------------------------

  /** Creates account + instance (+ immutable partition identity). Does not start. */
  createInstance(input: CreateInstanceInput): InstanceSummary {
    this.assertOpen()
    const game = this.deps.repos.games.get(input.gameId)
    if (game === undefined) throw new DomainError('NOT_FOUND', 'Game not found')

    const record = this.deps.repos.instances.createAccountWithInstance(
      {
        gameId: input.gameId,
        label: input.label,
        restoreOnLaunch: false,
        accountId: randomUUID(),
        instanceId: randomUUID(),
        partitionId: randomUUID(),
      },
      this.now(),
    )
    this.log.info('instance.created', { instanceId: record.instance.id, accountId: record.account.id })
    this.log.info('session.created', { accountId: record.account.id, partition: `persist:gh-${record.account.partitionId}` })
    const summary = this.summarize(record)
    this.emit(summary)
    return summary
  }

  start(instanceId: string): Promise<InstanceSummary> {
    this.assertOpen()
    this.requireRecord(instanceId)
    const epoch = this.stopEpoch(instanceId)
    return this.enqueue(instanceId, 'start', async () => {
      if (this.stopEpoch(instanceId) !== epoch) {
        throw new DomainError('INVALID_STATE', 'Start cancelled by a later stop')
      }
      await this.doStart(instanceId)
      this.deps.repos.instances.setRestoreOnLaunch(instanceId, true, this.now())
      return this.get(instanceId)
    })
  }

  /**
   * Gives keyboard focus to a running instance's view. Where the view is shown is the
   * renderer's request (stage layout); this only moves focus.
   */
  focus(instanceId: string): InstanceSummary {
    const record = this.requireRecord(instanceId)
    const runtime = this.runtimes.get(instanceId)
    if (runtime?.status !== 'running') throw new DomainError('INVALID_STATE', 'Instance is not running')
    this.deps.host.focusView(instanceId)
    return this.summarize(record, runtime)
  }

  /** "Close instance": stops the view, keeps the account and its session data. */
  stop(instanceId: string): Promise<InstanceSummary> {
    this.assertOpen()
    this.requireRecord(instanceId)
    this.cancelStarts(instanceId)
    return this.enqueue(instanceId, 'stop', async () => {
      await this.doStop(instanceId)
      this.deps.repos.instances.setRestoreOnLaunch(instanceId, false, this.now())
      return this.get(instanceId)
    })
  }

  /** stop + start as a single queued command; also the recovery path from error/crashed. */
  restart(instanceId: string): Promise<InstanceSummary> {
    this.assertOpen()
    this.requireRecord(instanceId)
    this.cancelStarts(instanceId)
    return this.enqueue(instanceId, 'other', async () => {
      await this.doStop(instanceId)
      await this.doStart(instanceId)
      this.deps.repos.instances.setRestoreOnLaunch(instanceId, true, this.now())
      return this.get(instanceId)
    })
  }

  /** Deletes account, instance and all browser data (ADR-0008). Irreversible. */
  remove(instanceId: string): Promise<void> {
    this.assertOpen()
    const record = this.requireRecord(instanceId)
    this.cancelStarts(instanceId)
    return this.enqueue(instanceId, 'other', async () => {
      const identity = this.deps.sessions.identityOf(record.account.id)
      await this.doStop(instanceId)
      // DB first (rows + tombstone in one transaction), then wipe the session.
      this.deps.repos.instances.removeAccount(record.account.id, identity.partitionId, this.now())
      try {
        await this.deps.sessions.purge(identity)
      } catch (error) {
        // The account is already gone and its tombstone is recorded: the
        // partition directory is deleted on the next boot regardless.
        this.log.warn('session.purge_failed', { accountId: record.account.id, error })
      }
      this.stopEpochs.delete(instanceId)
      this.log.info('instance.removed', { instanceId, accountId: record.account.id })
      this.emitRemoved(instanceId)
    })
  }

  /**
   * The game's allowed origins changed: push the new list to every live view of that
   * game, so the user does not have to restart the instance to retry a login.
   */
  applyAllowedOrigins(gameId: string): void {
    for (const record of this.deps.repos.instances.listRecords()) {
      if (record.game.id !== gameId) continue
      const runtime = this.runtimes.get(record.instance.id)
      if (runtime?.view == null) continue
      this.deps.host.updateAllowedOrigins(
        record.instance.id,
        allowedOriginsFor(record.game.startUrl, record.game.allowedOrigins),
      )
    }
  }

  /**
   * Removes a game and every account of it. Each account goes through `remove` (stop the view, delete
   * its rows with a tombstone, wipe its session), one at a time: there is exactly one way to delete
   * browser data. If one account fails the error propagates and the game keeps the accounts that
   * were not removed yet, so nothing is left half-deleted without a way to finish.
   */
  async removeGame(gameId: string): Promise<void> {
    this.assertOpen()
    if (this.deps.repos.games.get(gameId) === undefined) throw new DomainError('NOT_FOUND', 'Game not found')

    const accounts = this.deps.repos.instances.listRecords().filter((record) => record.game.id === gameId)
    for (const record of accounts) {
      try {
        await this.remove(record.instance.id)
      } catch (error) {
        if (error instanceof DomainError && error.code === 'NOT_FOUND') continue // already gone: what we wanted
        throw error
      }
    }

    try {
      this.deps.repos.games.remove(gameId)
    } catch {
      // An account appeared meanwhile (the FK is RESTRICT): refuse rather than orphan it.
      throw new DomainError('INVALID_STATE', 'The game still has accounts')
    }
    this.log.info('game.removed', { gameId, accounts: accounts.length })
  }

  /** Starts every instance flagged restoreOnLaunch. Failures are isolated per instance. */
  async restore(concurrency = 2): Promise<void> {
    const pending = this.deps.repos.instances
      .listRecords()
      .filter((record) => record.instance.restoreOnLaunch)
      .map((record) => record.instance.id)
    this.log.info('restore.begin', { count: pending.length })

    const worker = async (): Promise<void> => {
      for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
        try {
          await this.start(id)
        } catch (error) {
          this.log.warn('restore.instance_failed', { instanceId: id, error })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker))
    this.log.info('restore.end')
  }

  /**
   * App shutdown: stop every live view and flush sessions. Restore intent in the
   * database is deliberately left untouched so instances come back next launch.
   */
  async shutdown(): Promise<void> {
    this.closing = true
    const ids = [...this.runtimes.keys()]
    ids.forEach((id) => this.cancelStarts(id))
    await Promise.all(
      ids.map((id) =>
        this.enqueue(id, 'stop', async () => {
          await this.doStop(id)
          return undefined
        }).catch((error: unknown) => this.log.error('instance.shutdown_failed', { instanceId: id, error })),
      ),
    )
    await this.deps.sessions.flushAll()
  }

  // ---- lifecycle internals ---------------------------------------------

  private async doStart(instanceId: string): Promise<void> {
    const record = this.requireRecord(instanceId)
    let runtime = this.runtimes.get(instanceId)

    if (runtime?.status === 'running') return
    if (runtime !== undefined && runtime.status !== 'stopped') {
      // crashed / error: tear down what is left, then start fresh.
      if (runtime.status === 'crashed' || runtime.status === 'error') await this.teardownView(runtime)
    }

    runtime ??= new InstanceRuntime(instanceId)
    runtime.apply('START')
    runtime.errorCode = null
    const generation = ++runtime.generation
    const abort = new AbortController()
    runtime.startAbort = abort
    this.runtimes.set(instanceId, runtime)
    this.log.info('instance.starting', { instanceId, generation })
    this.emit(this.summarize(record, runtime))

    const isCurrent = (): boolean => runtime.generation === generation && runtime.status === 'starting'

    try {
      const session = this.deps.sessions.get(record.account.id)
      const view = this.deps.host.mount({
        instanceId,
        session,
        allowedOrigins: allowedOriginsFor(record.game.startUrl, record.game.allowedOrigins),
      })
      runtime.view = view
      runtime.disposables.add(view.onGone((reason) => this.handleProcessGone(runtime, generation, reason)))

      await view.loadUrl(record.game.startUrl, abort.signal)

      if (!isCurrent()) throw new DomainError('INVALID_STATE', 'Start superseded')
      runtime.startAbort = null
      runtime.apply('LOADED')
      this.log.info('instance.running', { instanceId, generation })
      this.emit(this.summarize(record, runtime))
    } catch (error) {
      runtime.startAbort = null
      if (error instanceof LoadAbortedError) {
        // A stop/remove is queued behind us and will finish the teardown.
        throw new DomainError('INVALID_STATE', 'Start cancelled')
      }
      if (error instanceof ProcessGoneError || runtime.status !== 'starting') {
        // handleProcessGone already moved the state to `crashed`.
        if (error instanceof DomainError) throw error
        return
      }
      // Genuine load failure (or session/mount failure): error, recoverable by restart.
      const code = error instanceof LoadFailedError ? error.code : 'START_FAILED'
      runtime.errorCode = code
      runtime.apply('LOAD_FAILED')
      this.log.error('instance.error', { instanceId, code, error })
      await this.teardownView(runtime)
      this.emit(this.summarize(record, runtime))
    }
  }

  private async doStop(instanceId: string): Promise<void> {
    const runtime = this.runtimes.get(instanceId)
    if (runtime === undefined) return // already stopped

    runtime.apply('STOP')
    runtime.startAbort?.abort()
    this.log.info('instance.stopping', { instanceId })
    this.emitFor(instanceId, runtime)

    await this.teardownView(runtime)
    const record = this.deps.repos.instances.getRecord(instanceId)
    if (record !== undefined) {
      // Persist cookies/DOM storage written during this run.
      await this.deps.sessions.flush(record.account.id).catch((error: unknown) =>
        this.log.warn('session.flush_failed', { instanceId, error }),
      )
    }

    runtime.apply('STOPPED')
    this.runtimes.delete(instanceId) // a stopped instance holds no runtime
    this.log.info('instance.stopped', { instanceId })
    this.emitFor(instanceId, runtime)
  }

  private async teardownView(runtime: InstanceRuntime): Promise<void> {
    runtime.disposables.dispose() // listeners first, so closing raises no events
    if (runtime.view === null) return
    runtime.view = null
    try {
      await this.deps.host.unmount(runtime.instanceId)
    } catch (error) {
      this.log.error('view.unmount_failed', { instanceId: runtime.instanceId, error })
    }
  }

  private handleProcessGone(runtime: InstanceRuntime, generation: number, reason: string): void {
    if (runtime.generation !== generation) return
    if (runtime.status !== 'starting' && runtime.status !== 'running') return
    runtime.apply('PROCESS_GONE')
    this.log.error('instance.crashed', { instanceId: runtime.instanceId, reason })
    this.emitFor(runtime.instanceId, runtime)
  }

  // ---- helpers ---------------------------------------------------------

  private enqueue<T>(instanceId: string, kind: CommandKind, task: () => Promise<T>): Promise<T> {
    const last = this.lastCommand.get(instanceId)
    if (kind !== 'other' && last?.kind === kind) return last.promise as Promise<T>

    const promise = this.queue.run(instanceId, task)
    const entry = { kind, promise }
    this.lastCommand.set(instanceId, entry)
    const clear = (): void => {
      if (this.lastCommand.get(instanceId) === entry) this.lastCommand.delete(instanceId)
    }
    promise.then(clear, clear)
    return promise
  }

  /** Cancels queued and in-flight starts for an instance. */
  private cancelStarts(instanceId: string): void {
    this.stopEpochs.set(instanceId, this.stopEpoch(instanceId) + 1)
    this.runtimes.get(instanceId)?.startAbort?.abort()
  }

  private stopEpoch(instanceId: string): number {
    return this.stopEpochs.get(instanceId) ?? 0
  }

  private assertOpen(): void {
    if (this.closing) throw new DomainError('INVALID_STATE', 'Application is shutting down')
  }

  private requireRecord(instanceId: string): InstanceRecord {
    const record = this.deps.repos.instances.getRecord(instanceId)
    if (record === undefined) throw new DomainError('NOT_FOUND', 'Instance not found')
    return record
  }

  private summarize(record: InstanceRecord, runtime = this.runtimes.get(record.instance.id)): InstanceSummary {
    return {
      id: record.instance.id,
      gameId: record.game.id,
      accountId: record.account.id,
      label: record.account.label,
      status: runtime?.status ?? 'stopped',
      errorCode: runtime?.status === 'error' ? runtime.errorCode : null,
      restoreOnLaunch: record.instance.restoreOnLaunch,
    }
  }

  private emitFor(instanceId: string, runtime: InstanceRuntime): void {
    const record = this.deps.repos.instances.getRecord(instanceId)
    if (record !== undefined) this.emit(this.summarize(record, runtime))
  }

  private emitRemoved(instanceId: string): void {
    for (const listener of this.removedListeners) {
      try {
        listener(instanceId)
      } catch (error) {
        this.log.error('instance.listener_failed', { error })
      }
    }
  }

  private emit(summary: InstanceSummary): void {
    for (const listener of this.listeners) {
      try {
        listener(summary)
      } catch (error) {
        this.log.error('instance.listener_failed', { error })
      }
    }
  }
}
