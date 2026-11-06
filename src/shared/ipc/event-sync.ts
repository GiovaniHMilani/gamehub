import type { InstanceSummary } from '../domain/types'
import type { InstanceEvent, InstancesSnapshot } from './instance-events'
import type { Result } from './result'

/**
 * Pure renderer-side synchronisation of instance state with Main's events.
 * Lives in shared/ so it can be unit-tested without a DOM or Electron.
 *
 * Rules (ADR-0015):
 *   event.seq <= state.seq      -> ignored (duplicate or already in the snapshot)
 *   event.seq === state.seq + 1 -> applied
 *   event.seq  >  state.seq + 1 -> gap: an event was lost, take a new snapshot
 */
export interface SyncState {
  readonly seq: number
  readonly instances: readonly InstanceSummary[]
}

export type SyncOutcome =
  | { readonly kind: 'applied'; readonly state: SyncState }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'gap'; readonly expected: number; readonly got: number }

export function fromSnapshot(snapshot: InstancesSnapshot): SyncState {
  return { seq: snapshot.seq, instances: snapshot.instances }
}

export function applyEvent(state: SyncState, event: InstanceEvent): SyncOutcome {
  if (event.seq <= state.seq) return { kind: 'ignored' }
  if (event.seq !== state.seq + 1) return { kind: 'gap', expected: state.seq + 1, got: event.seq }

  if (event.type === 'instance.removed') {
    return {
      kind: 'applied',
      state: { seq: event.seq, instances: state.instances.filter((item) => item.id !== event.instanceId) },
    }
  }
  const exists = state.instances.some((item) => item.id === event.instance.id)
  const instances = exists
    ? state.instances.map((item) => (item.id === event.instance.id ? event.instance : item))
    : [...state.instances, event.instance]
  return { kind: 'applied', state: { seq: event.seq, instances } }
}

// ---- engine ---------------------------------------------------------------

export interface SyncView {
  /** null until the first snapshot arrives. */
  readonly seq: number | null
  readonly instances: readonly InstanceSummary[]
  /** Snapshots taken because a gap was detected (not counting the initial one). */
  readonly resyncs: number
}

export interface SyncDeps {
  snapshot(): Promise<Result<InstancesSnapshot>>
  subscribe(listener: (event: InstanceEvent) => void): () => void
  onChange(view: SyncView): void
}

const MAX_RESYNC_ATTEMPTS = 3

/**
 * Initialisation order matters: subscribe FIRST, then fetch the snapshot, buffering
 * events that arrive meanwhile. Events at or below the snapshot's seq are dropped on
 * replay, so nothing is lost and nothing is applied twice.
 */
export class InstanceSyncEngine {
  private state: SyncState | null = null
  private buffer: InstanceEvent[] = []
  private syncing = false
  private stopped = false
  private resyncs = 0
  private unsubscribe: (() => void) | null = null

  constructor(private readonly deps: SyncDeps) {}

  start(): void {
    this.stopped = false
    this.unsubscribe = this.deps.subscribe((event) => this.receive(event))
    void this.sync()
  }

  stop(): void {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = null
    this.buffer = []
  }

  private receive(event: InstanceEvent): void {
    if (this.stopped) return
    if (this.syncing || this.state === null) {
      this.buffer.push(event)
      return
    }
    const outcome = applyEvent(this.state, event)
    if (outcome.kind === 'applied') {
      this.state = outcome.state
      this.emit()
    } else if (outcome.kind === 'gap') {
      this.resyncs++
      void this.sync()
    }
  }

  private async sync(): Promise<void> {
    if (this.syncing) return
    this.syncing = true
    try {
      for (let attempt = 0; attempt < MAX_RESYNC_ATTEMPTS && !this.stopped; attempt++) {
        this.buffer = []
        const result = await this.deps.snapshot()
        if (this.stopped) return
        if (!result.ok) return // keep what we have; the next gap or start retries

        let state = fromSnapshot(result.data)
        let gap = false
        for (const event of this.buffer.splice(0)) {
          const outcome = applyEvent(state, event)
          if (outcome.kind === 'applied') state = outcome.state
          else if (outcome.kind === 'gap') {
            gap = true
            break
          }
        }
        this.state = state
        this.emit()
        if (!gap) return
        this.resyncs++
      }
    } finally {
      this.syncing = false
    }
  }

  private emit(): void {
    if (this.state === null) return
    this.deps.onChange({ seq: this.state.seq, instances: this.state.instances, resyncs: this.resyncs })
  }
}
