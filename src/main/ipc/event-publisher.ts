import type { InstanceEvent } from '@shared/ipc/instance-events'

/** Event payload before Main assigns its sequence number. */
export type UnsequencedInstanceEvent =
  | { readonly type: 'instance.changed'; readonly instance: Extract<InstanceEvent, { type: 'instance.changed' }>['instance'] }
  | { readonly type: 'instance.removed'; readonly instanceId: string }

/**
 * The single owner of `seq` (ADR-0015). One counter for the whole app run:
 * the first published event is 1 and every later one is exactly previous + 1,
 * so a receiver can tell a lost event from a quiet period.
 *
 * Main is single-threaded and `publish` is synchronous, so `currentSeq` read in
 * the same tick as a state read (see the snapshot handler) is consistent with it.
 */
export class InstanceEventPublisher {
  private seq = 0
  private readonly subscribers = new Set<(event: InstanceEvent) => void>()

  get currentSeq(): number {
    return this.seq
  }

  subscribe(listener: (event: InstanceEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  publish(event: UnsequencedInstanceEvent): InstanceEvent {
    const sequenced: InstanceEvent = { ...event, seq: ++this.seq }
    for (const subscriber of this.subscribers) {
      try {
        subscriber(sequenced)
      } catch {
        // One failing subscriber must not break the others or the sequence.
      }
    }
    return sequenced
  }
}
