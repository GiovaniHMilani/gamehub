# ADR-0005: Explicit typed IPC contract

## Status
Accepted

## Context
IPC is the privileged boundary between untrusted-ish renderer code and Main.

## Options
Generic `execute(command,args)` (rejected), RPC framework (unnecessary
dependency), **explicit channels + schemas**.

## Decision
- `src/shared/ipc/contract.ts` defines each channel: name, zod input schema
  (`.strict()`), output type.
- Handler pipeline: sender guard (`event.senderFrame` is the shell main frame,
  origin `app://gamehub` or the dev server) → zod parse → service → `Result`.
- `Result<T> = { ok: true, data } | { ok: false, error: { code, message } }`,
  codes: `INVALID_ARGUMENT | NOT_FOUND | INVALID_STATE | INTERNAL`.
  No stack traces or paths cross the boundary.
- Main → Renderer events: `instances:changed`, `instances:meta` (throttled),
  `domain:changed`, `app:notice`, all with `seq`.
- Layout updates use one-way `send`, coalesced to one message per frame.
- No arbitrary `navigate(url)` exposed; `goHome`/`goBack` only.
- Logged validation failures include channel and field path, never values.

## Consequences
- Positive: small, auditable surface; shared types.
- Negative: adds `zod`.
