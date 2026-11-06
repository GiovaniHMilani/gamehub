import { resolve } from 'node:path'
import type { ManagedSession } from '../../../src/main/browser-sessions/session-manager'
import { SessionManager } from '../../../src/main/browser-sessions/session-manager'
import { InstanceManager } from '../../../src/main/instances/instance-manager'
import {
  LoadAbortedError,
  LoadFailedError,
  ProcessGoneError,
  type MountedView,
  type ViewHost,
} from '../../../src/main/instances/ports'
import { createLogger, MemorySink } from '../../../src/main/logging/logger'
import { openDatabase, type OpenedDatabase } from '../../../src/main/persistence/db'
import { createRepositories, type Repositories } from '../../../src/main/persistence/repositories'

export const MIGRATIONS = resolve(import.meta.dirname, '../../../drizzle')

export function makeDb(): OpenedDatabase {
  return openDatabase(':memory:', MIGRATIONS)
}

export class FakeSession implements ManagedSession {
  cleared = 0
  flushed = 0
  readonly cookies = { flushStore: (): Promise<void> => Promise.resolve() }
  constructor(readonly partitionName: string) {}
  clearStorageData(): Promise<void> {
    this.cleared++
    return Promise.resolve()
  }
  clearCache(): Promise<void> {
    return Promise.resolve()
  }
  clearAuthCache(): Promise<void> {
    return Promise.resolve()
  }
  flushStorageData(): void {
    this.flushed++
  }
}

export interface Deferred<T = void> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type LoadMode = 'ok' | 'hold' | { fail: string }

/** In-memory ViewHost with controllable loads and leak counters. */
export class FakeHost implements ViewHost<FakeSession> {
  mounts = 0
  unmounts = 0
  loadMode: LoadMode = 'ok'
  readonly mountedIds = new Set<string>()
  readonly sessionsByInstance = new Map<string, FakeSession>()
  readonly originsByInstance = new Map<string, readonly string[]>()
  private readonly goneListeners = new Map<string, Set<(reason: string) => void>>()
  private pendingHold: Deferred | null = null

  /** Resolves loads that are waiting in 'hold' mode. */
  releaseHeldLoads(): void {
    this.pendingHold?.resolve()
    this.pendingHold = null
  }

  /** Simulates the renderer process dying. */
  crash(instanceId: string, reason = 'crashed'): void {
    this.goneListeners.get(instanceId)?.forEach((listener) => listener(reason))
  }

  listenerCount(instanceId: string): number {
    return this.goneListeners.get(instanceId)?.size ?? 0
  }

  mount(args: { instanceId: string; session: FakeSession; allowedOrigins: readonly string[] }): MountedView {
    const { instanceId, session } = args
    if (this.mountedIds.has(instanceId)) throw new Error(`duplicate mount for ${instanceId}`)
    this.mounts++
    this.mountedIds.add(instanceId)
    this.sessionsByInstance.set(instanceId, session)
    this.originsByInstance.set(instanceId, args.allowedOrigins)
    const listeners = new Set<(reason: string) => void>()
    this.goneListeners.set(instanceId, listeners)

    return {
      onGone: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      loadUrl: (_url, signal) => this.load(signal, listeners),
    }
  }

  readonly originUpdates: Array<{ instanceId: string; origins: readonly string[] }> = []

  updateAllowedOrigins(instanceId: string, origins: readonly string[]): void {
    this.originUpdates.push({ instanceId, origins })
  }

  unmount(instanceId: string): Promise<void> {
    this.unmounts++
    this.mountedIds.delete(instanceId)
    // Listeners are deliberately NOT cleared here: a real webContents would keep
    // them until someone removes them, so leaks must be caught by the caller.
    return Promise.resolve()
  }

  private load(signal: AbortSignal, listeners: Set<(reason: string) => void>): Promise<void> {
    const mode = this.loadMode
    if (mode === 'ok') return Promise.resolve()
    if (typeof mode === 'object') return Promise.reject(new LoadFailedError(mode.fail))
    this.pendingHold ??= deferred()
    const hold = this.pendingHold
    return new Promise<void>((resolve, reject) => {
      const onGone = (reason: string): void => reject(new ProcessGoneError(reason))
      listeners.add(onGone)
      const settle = (fn: () => void) => (): void => {
        listeners.delete(onGone)
        fn()
      }
      signal.addEventListener('abort', settle(() => reject(new LoadAbortedError())), { once: true })
      void hold.promise.then(settle(resolve))
    })
  }
}

export interface Harness {
  readonly db: OpenedDatabase
  readonly repos: Repositories
  readonly host: FakeHost
  readonly sink: MemorySink
  readonly fakeSessions: Map<string, FakeSession>
  readonly sessions: SessionManager<FakeSession>
  readonly manager: InstanceManager<FakeSession>
  readonly gameId: string
}

export function makeHarness(startUrl = 'https://game.example/play'): Harness {
  const db = makeDb()
  const repos = createRepositories(db.db)
  const sink = new MemorySink()
  const log = createLogger('test', sink)
  const fakeSessions = new Map<string, FakeSession>()
  const host = new FakeHost()
  const sessions = new SessionManager<FakeSession>({
    resolvePartitionId: (accountId) => repos.instances.getPartitionId(accountId),
    fromPartition: (name) => {
      let session = fakeSessions.get(name)
      if (session === undefined) {
        session = new FakeSession(name)
        fakeSessions.set(name, session)
      }
      return session
    },
    configure: () => undefined,
    log,
  })
  const manager = new InstanceManager<FakeSession>({ repos, sessions, host, log })
  const game = repos.games.create({ id: crypto.randomUUID(), name: 'Test Game', startUrl }, Date.now())
  return { db, repos, host, sink, fakeSessions, sessions, manager, gameId: game.id }
}
