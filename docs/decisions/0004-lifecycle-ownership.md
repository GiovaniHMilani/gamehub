# ADR-0004: Main-owned instance lifecycle

## Status
Accepted

## Context
Concurrent start/stop/crash events and UI actions can race. Lifecycle needs a
single source of truth.

## Options
Renderer-owned (rejected: untrusted, duplicated per component), shared
(rejected: two sources of truth), **Main-owned**.

## Decision
- `InstanceRuntime` in Main holds a pure state machine:
  `stopped → starting → running → stopping → stopped`, plus `error` and
  `crashed`. Visibility/focus/mute are a separate `presentation` axis.
- Commands are serialized per instance id and idempotent.
- A `generation` counter invalidates stale async continuations.
- Listeners/timers are registered via `Disposables`; `stopping` disposes them
  and calls `webContents.close()`.
- Renderer is a read-model: `getSnapshot()` returns `seq`; events carry `seq`;
  stale events are dropped.
- DB stores intent (`restore_on_launch`), not runtime state.
- No automatic reload after crashes in v1.

## Consequences
- Positive: deterministic, unit-testable transitions.
- Negative: snapshot + event plumbing.

## Revisit when
Suspension is introduced (Phase 9 evidence).
