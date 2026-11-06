# Phase 0 Spikes

Run on 2026-11-06, macOS arm64, Electron 45.2.3 (Node 24.22.2, ABI 150),
Playwright 1.65.0. Throwaway scripts; results below are what was observed.

## S1 — SQLite driver

**Question:** `better-sqlite3` (native) vs `node:sqlite`; does the native
module work in both Node (unit tests) and Electron without rebuilds?

**Observed:**
- `drizzle-orm@0.45.4` has no `node:sqlite` driver export → `node:sqlite`
  would need a custom proxy layer.
- `better-sqlite3@13.0.3` ships one Node-API binary per platform
  (`prebuilds/darwin-arm64.node`, `win32-x64.node`, …), not per ABI.
- The same binary loaded in Node 24.11 (ABI 137) and inside Electron 45
  (ABI 150, N-API 10): in-memory DB, WAL pragma, insert/select OK
  (SQLite 3.53.4).

**Decision:** `better-sqlite3@13` + Drizzle. No `@electron/rebuild` needed.
Packaging still needs the `.node` file unpacked from asar (Phase 10).

## S2 — Playwright × WebContentsView

**Observed:** `electronApp.windows()` returns the shell **and every
WebContentsView** as separate `Page`s (identified by URL). `page.evaluate`
works inside a view; localStorage written in view A was `null` in view B.

**Decision:** E2E tests drive game views directly as Playwright pages. Plan B
(`electronApp.evaluate` + fake-server assertions) not needed, but server-side
cookie assertions remain useful as an independent check.

## S3 — Partition directory naming

**Observed:** `persist:gh-<uuid>` is stored at
`<userData>/Partitions/gh-<uuid>` (verbatim, lowercase).
`session.fromPartition()` returns the same object for the same name.
Two partitions: cookie and localStorage set in A were absent in B.

**Decision:** ADR-0008 tombstone deletion targets
`userData/Partitions/gh-<partitionId>`.

## S4 — WebContentsView teardown

**Observed:**
- `contentView.removeChildView(view)` does **not** destroy the webContents
  (`isDestroyed() === false`, still in `webContents.getAllWebContents()`).
- `webContents.close()` destroys it (`destroyed` event, removed from list).
- After destruction, `view.webContents` returns `undefined`.

**Decision:** InstanceRuntime keeps its own `webContents` reference/id,
detaches, then calls `close()` and awaits `destroyed`. Code must not read
`view.webContents` after close.

## S5 — Popup session inheritance

**Observed:** `setWindowOpenHandler(() => ({ action: 'allow' }))` creates a
child whose session **is the opener's session**, with `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, no preload (inherited).
Passing `overrideBrowserWindowOptions.webPreferences.partition` of another
account was **ignored** — the child still used the opener's session.

**Decision:** OAuth popups stay in the account's partition by construction.
The Phase 2/6 test still asserts it, to catch Electron behavior changes.

## S6 — Cookies without expiry across a restart (found in the vertical slice)

**Observed** (`tests/e2e/persistence.spec.ts`, Electron 45.2.3): after a graceful
quit and relaunch of the same `userData`:
- cookie with `max-age`, localStorage, IndexedDB: **restored**, per account;
- cookie **without expiry** (session cookie): **not restored** (`null` in both
  accounts). This is standard Chromium behavior, not a GameHub bug.

**Impact:** a game that keeps its login only in a session cookie logs the user
out on every GameHub restart, even with a persistent partition. Games that use
persistent cookies/localStorage/tokens are unaffected.

**Not changed:** the only known workarounds (rewriting session cookies with an
expiry from the Main process) mean managing cookies manually, which CLAUDE.md §2
and ADR-0003 forbid. Needs an explicit decision; see the slice report.

## Deferred

- Background throttling semantics with `setBackgroundThrottling(false)` on a
  hidden view: requires the real game → Phase 9.
- Windows-specific verification (file locks during partition deletion,
  `win32-x64` binary load) → when a Windows machine/CI runner is available.

## Environment finding

The VS Code extension host exports `ELECTRON_RUN_AS_NODE=1`. Any child
Electron process inheriting it runs as plain Node (no window). The E2E launch
helper strips it. Production builds will disable this via the RunAsNode fuse
(ADR-0006).
