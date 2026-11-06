# Development Roadmap

Target: 1 game × 4 accounts, macOS + Windows, no auto-update.
Each phase ends with typecheck + phase tests + a report of what was verified.

## Status

- Phase 0 — done.
- Vertical slice (2, 3, 4 and the parts of 1, 5, 6 it needs) — done: domain,
  SQLite + Drizzle, SessionManager, InstanceManager (state machine, per-instance
  queue), WindowManager, typed IPC + preload, restore, tombstones, structured
  logging, isolation/persistence/removal/lifecycle/security E2E tests.
- OAuth/app:///seq phase — done: popup policy and controller (same-session,
  allowlist, limits, cleanup), shell served from `app://gamehub`, sequenced
  events with snapshot, removal event.
- Allowed origins: granted from a blocked-request notice in one click (ADR-0016), live, and
  reviewed or revoked per game from the UI ("Allowed sites").
- Phase 7 (UI) — done: sidebar, Library (games with their accounts as lines), Play screen whose
  viewport is requested by the renderer and applied by Main (ADR-0017), dialogs, loading / empty /
  error states, notices and toasts. State is a Zustand read-model over the existing sequenced
  events; styling is plain CSS tokens (ADR-0018).
- Not done yet: an economy mode for hidden accounts (they currently cost as much as visible ones,
  ADR-0010 / ADR-0017), events for games, opening denied links in the
  system browser, `app_state` / crash-loop guard, packaging, Windows verification.

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 — Foundation + spikes | gitignore fix, electron-vite, TS strict, lint boundaries, Vitest, Playwright, empty window; spikes (see `spikes.md`) | app opens; unit + E2E launch tests pass; spikes documented |
| 1 — Secure shell | `app://` + CSP, sandbox, minimal preload, sender guard, global web-contents guard, single-instance lock, paths, logger | E2E: shell has no Node; `window.gamehub` keys exact |
| 2 — Architecture proof | SessionManager + minimal InstanceRuntime + views, 4 fixed accounts on a fake game, fake OAuth popup (no DB) | isolation + restart persistence + popup-in-same-partition tests pass |
| 3 — Persistence | Drizzle schema, migrations, repositories, tombstones, restore from DB | repo unit tests; restart E2E with DB; removal deletes partition on next boot |
| 4 — Lifecycle | state machine, command queue, generation, crash/unresponsive, stop/restart/remove/clear | transition table tests; start/stop stress without leaked webContents |
| 5 — IPC contract | all channels, zod, Result, seq events | invalid-input tests per channel |
| 6 — Policies | navigation, popups, permissions, downloads | E2E: block, popup partition, permission denied |
| 7 — Layout, focus, audio | 2×2 grid + expand, occlusion, accelerators, focused-only audio | resize without flicker; dialog over stage works |
| 8 — UI | design plan, then library, accounts, stage, empty/error/crash states | visual review via screenshots; no broad re-renders |
| 9 — Measurement | diagnostics panel; baseline 1/2/4/8; validate economy mode with real game | report with numbers |
| 10 — Packaging | electron-builder dmg + NSIS, fuses, icons (signing optional) | packaged app: sessions persist, no Node, IPC works |
