import type { InstanceStatus } from '@shared/domain/types'

/**
 * A state lamp. It is decoration for sighted users: the state is always also written as text
 * next to it, so it is hidden from assistive technology. Shapes differ per state (ring, dot,
 * pulsing dot, diamond) so colour is never the only signal.
 */
export function StatusLamp({ state }: { state: InstanceStatus | 'live' }) {
  return <span className="lamp" data-state={state} aria-hidden="true" />
}
