import type { InstanceStatus } from '@shared/domain/types'

/**
 * Pure lifecycle transition table (ADR-0004). No side effects, no Electron.
 *
 *   stopped ─START─► starting ─LOADED─► running
 *   starting ─LOAD_FAILED─► error          starting/running ─PROCESS_GONE─► crashed
 *   starting/running/crashed/error ─STOP─► stopping ─STOPPED─► stopped
 *   crashed/error ─START─► starting        (recovery = restart)
 *
 * Visibility/focus/mute are a separate presentation axis, not lifecycle.
 */
export type InstanceEvent = 'START' | 'LOADED' | 'LOAD_FAILED' | 'PROCESS_GONE' | 'STOP' | 'STOPPED'

const TRANSITIONS: Readonly<Record<InstanceStatus, Partial<Record<InstanceEvent, InstanceStatus>>>> = {
  stopped: { START: 'starting' },
  starting: { LOADED: 'running', LOAD_FAILED: 'error', PROCESS_GONE: 'crashed', STOP: 'stopping' },
  running: { PROCESS_GONE: 'crashed', STOP: 'stopping' },
  stopping: { STOPPED: 'stopped' },
  crashed: { START: 'starting', STOP: 'stopping' },
  error: { START: 'starting', STOP: 'stopping' },
}

/** Returns the next status, or `null` if the event is invalid in `status`. */
export function nextStatus(status: InstanceStatus, event: InstanceEvent): InstanceStatus | null {
  return TRANSITIONS[status][event] ?? null
}
