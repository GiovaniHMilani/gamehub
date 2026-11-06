# ADR-0015: Sequenced events and snapshots

## Status
Accepted

## Context
The renderer mirrors state owned by Main. Between calling `list()` and receiving
the first event there was a window in which a change could be missed or applied
twice, and removals emitted no event at all.

## Decision
- **Owner:** Main. One `InstanceEventPublisher` holds a single counter for the
  app run. The first event is `1`; every event is exactly previous + 1.
- **Scope:** global, not per instance. Simplest rule that detects any loss.
- **Events** (`instances:event`): `instance.changed {instance}` (full new
  summary) and `instance.removed {instanceId}`. Each carries `seq`. This is not
  event sourcing: the latest `changed` is always enough.
- **Snapshot:** `instances.snapshot()` returns `{ seq, instances }`, reading
  both in the same synchronous tick of Main, so the state is consistent with
  that `seq`.
- **Renderer protocol** (pure, in `shared/ipc/event-sync.ts`):
  1. subscribe first, buffering events;
  2. fetch the snapshot;
  3. replay buffered events: `seq <= snapshot.seq` is ignored, the rest applied;
  4. live: `seq <= current` ignored (duplicate/old); `seq == current+1` applied;
     `seq > current+1` is a **gap**: the event is dropped and a new snapshot is
     taken (bounded retries; a failed snapshot keeps the previous state).
- Removal: `InstanceManager.onRemoved` fires after the account and its data are
  gone; the publisher turns it into `instance.removed`.
- The counter restarts with the process. A renderer reload takes a new snapshot,
  so continuity is only required within one run.

## Consequences
- Positive: no race between boot and first event; loss is detectable and self-healing.
- Negative: `games` still have no events (they are fetched on demand); a second
  window would need its own subscription.
