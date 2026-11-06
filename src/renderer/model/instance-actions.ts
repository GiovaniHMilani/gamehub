import type { InstanceStatus } from '@shared/domain/types'

/**
 * What the user can do with an instance in each lifecycle state (ADR-0004).
 * Only actions the backend really supports: `start`, `stop` (also cancels a start in
 * progress), `restart` and `remove`; `open` just navigates to the Play screen.
 */
export type InstanceAction = 'open' | 'start' | 'stop' | 'restart' | 'remove'

export type ActionTone = 'primary' | 'neutral' | 'danger'

export interface ActionSpec {
  readonly action: InstanceAction
  readonly label: string
  readonly tone: ActionTone
}

// One solid button per context: Start is routine (neutral); Open, Retry and Restart-after-crash matter more.
const START: ActionSpec = { action: 'start', label: 'Start', tone: 'neutral' }
const RETRY: ActionSpec = { action: 'start', label: 'Retry', tone: 'primary' }
const CANCEL: ActionSpec = { action: 'stop', label: 'Cancel', tone: 'neutral' }
const STOP: ActionSpec = { action: 'stop', label: 'Stop', tone: 'neutral' }
const RESTART: ActionSpec = { action: 'restart', label: 'Restart', tone: 'neutral' }
const RESTART_PRIMARY: ActionSpec = { action: 'restart', label: 'Restart', tone: 'primary' }
const OPEN: ActionSpec = { action: 'open', label: 'Open', tone: 'primary' }
const REMOVE: ActionSpec = { action: 'remove', label: 'Remove', tone: 'danger' }

const BY_STATUS: Readonly<Record<InstanceStatus, readonly ActionSpec[]>> = {
  stopped: [START, REMOVE],
  starting: [CANCEL],
  running: [OPEN, STOP, RESTART],
  stopping: [], // nothing destructive or duplicated while it is shutting down
  crashed: [RESTART_PRIMARY, REMOVE],
  error: [RETRY, REMOVE],
}

export function actionsFor(status: InstanceStatus): readonly ActionSpec[] {
  return BY_STATUS[status]
}

const LABELS: Readonly<Record<InstanceStatus, string>> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  stopping: 'Stopping…',
  crashed: 'Crashed',
  error: 'Error',
}

export function statusLabel(status: InstanceStatus): string {
  return LABELS[status]
}

/** Transitional states get feedback that something is in progress. */
export function isBusy(status: InstanceStatus): boolean {
  return status === 'starting' || status === 'stopping'
}

export function needsAttention(status: InstanceStatus): boolean {
  return status === 'error' || status === 'crashed'
}
