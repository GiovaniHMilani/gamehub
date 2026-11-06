# Architecture Overview

GameHub is an Electron desktop app that runs several accounts of the same web
game side by side. Each account is an isolated, persistent browser identity.

Initial target: **1 game × 4 accounts**, macOS and Windows, no auto-update.

Decisions referenced below live in [`docs/decisions/`](../decisions/README.md).

---

## 1. Invariant

> One GameAccount = one persistent Electron partition. Two accounts never
> share browser state.

Partition name: `persist:gh-<partitionId>`, where `partitionId` is an
immutable UUID generated in Main when the account is created and stored in
SQLite (`game_accounts.partition_id`, `UNIQUE`). See ADR-0002.

---

## 2. Process model

```
┌──────────────────────────── BrowserWindow (shell) ────────────────────────────┐
│ Renderer (app://gamehub, sandbox, CSP)                                         │
│   React UI ── Zustand (read-model of Main + UI-only state)                     │
│     │ window.gamehub.*  (typed, minimal)                                       │
│ Preload (contextBridge) ── fixed channels only                                 │
│                                                                                │
│ ┌─ WebContentsView A ─┐ ┌─ WebContentsView B ─┐ ...   drawn ABOVE the DOM,     │
│ │ persist:gh-<uuidA>  │ │ persist:gh-<uuidB>  │       no preload, sandboxed    │
│ └─────────────────────┘ └─────────────────────┘                                │
└────────────────────────────────────────────────────────────────────────────────┘
                     │ IPC (sender = shell main frame only)
┌────────────────────▼────────────────── Main ──────────────────────────────────┐
│ AppLifecycle (single-instance lock, boot order, shutdown, crash-loop guard)    │
│  ├── IpcLayer ── sender guard → zod → service → Result<T>                      │
│  ├── InstanceManager ── registry<instanceId, InstanceRuntime>                  │
│  │     └── InstanceRuntime: state machine, command queue, view, listeners,     │
│  │                          OAuth popups                                       │
│  ├── SessionManager ── accountId → partitionId → Session (configured once)     │
│  ├── NavigationPolicy (pure)          ├── LayoutController (bounds/focus/audio)│
│  ├── MainWindow                       ├── Repositories ── SQLite (Drizzle)     │
│  └── Logger (redaction)               └── Paths / app:// protocol              │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Owns | Must not |
|---|---|---|
| Main | lifecycle, views, sessions, navigation policy, DB, IPC handlers | trust renderer input |
| Preload | `window.gamehub` typed API | expose `ipcRenderer`, `webContents`, `session`, Node |
| Renderer | UI, presentation state, layout *intent* | import `electron`/Node, own lifecycle |
| Game views | remote game content | have a preload or any privileged API |

ADR-0001 (window model), ADR-0005 (IPC), ADR-0006 (security baseline).

---

## 3. Domain model

```
Game 1───* GameAccount 1───0..1 GameInstance ···> InstanceRuntime (memory only)
              │
              └── partitionId ──> persist:gh-<partitionId> (Chromium on disk)
```

| Entity | Stored in | Key fields |
|---|---|---|
| Game | SQLite | name, startUrl (https), allowedOrigins[], backgroundMode |
| GameAccount | SQLite | gameId, label, color, **partitionId** (immutable, unique) |
| GameInstance | SQLite | accountId (unique), restoreOnLaunch, muted, zoom, layoutSlot |
| InstanceRuntime | Main memory | lifecycle state, generation, view, disposables, popups |
| Browser state | Electron partition | cookies, localStorage, IndexedDB, cache, service workers |

### Close vs Remove vs Logout

| Operation | Effect | Data |
|---|---|---|
| Close instance | stop runtime, `restoreOnLaunch=false` | account + partition kept |
| Remove account | stop, delete rows, tombstone, clear storage | everything deleted |
| Logout | done inside the game by the user | partition kept |
| Clear browser data | wipe partition, keep account | login lost |

---

## 4. Persistence

SQLite (`userData/gamehub.db`, WAL) answers *what exists and what to restore*:
`games`, `game_accounts`, `game_instances`, `partition_tombstones`,
`app_state` (clean-shutdown flag, preferences, layout).

The Electron partition answers *what the browser state is*.

Deliberately **not** persisted:
- cookies / tokens (ADR-0003)
- the current URL (may contain OAuth tokens; restore always starts at `startUrl`)
- runtime state (we persist intent: `restoreOnLaunch`)
- `sessionStorage` is isolated per instance but, by web semantics, does not
  survive a restart. Cookies without an expiry do not either (Chromium); see
  `docs/development/known-limitations.md`.

---

## 5. Instance lifecycle

Two orthogonal axes (ADR-0004).

```
            START              LOADED (first main-frame did-finish-load)
 stopped ─────────► starting ─────────────► running
    ▲               │     │                   │   │
    │     LOAD_FAIL │     │ STOP              │   │ PROCESS_GONE
    │               ▼     ▼                   │   ▼
    │            error   stopping ◄── STOP ───┤ crashed ──RELOAD──► starting
    │              │        │                 │   │
    └──────────────┴────────┘◄────────────────┘   └── STOP ──► stopping

Presentation: { attached, visible, focused, muted }
Running attributes: { loading, title, unresponsive }
```

- Commands are serialized per instance; idempotent (start on running = no-op).
- Every START increments a `generation`; stale async continuations abort.
- All listeners are registered through a per-runtime `Disposables`.
- Removing a view does not destroy its webContents: `webContents.close()` is
  called explicitly on stop.
- Restart = STOP + START. Reload keeps `running` with `loading=true`.
- No suspension in v1 (measure first).

---

## 6. Startup / shutdown

1. Pre-ready: single-instance lock → paths (dev: `GameHub-dev`, tests: temp
   dir) → logger → register `app://` scheme → `app.enableSandbox()`.
2. Ready: open DB → backup → migrations → `quick_check` if last boot unclean.
3. Process partition tombstones **before** any `session.fromPartition`.
4. Crash-loop guard: ≥2 consecutive unclean boots → do not auto-restore.
5. Mark `clean_shutdown=false`, register IPC handlers, create the shell window.
6. Renderer calls `getSnapshot()` (includes `seq`).
7. Restore queue: instances with `restoreOnLaunch`, concurrency 2.
   Failures are isolated per instance (`error` state + retry).

Shutdown: stop accepting commands → flush sessions → close views →
`clean_shutdown=true` → close DB.

A failed session is never silently replaced with a new one.

---

## 7. Navigation & popups (ADR-0007)

Per game `allowedOrigins` = origin of `startUrl` + user-added entries
(exact origins or explicit `*.example.com`).

| Event | Behavior |
|---|---|
| top-level navigation to allowed origin | stays in view |
| top-level navigation elsewhere | blocked + notice (open externally / allow) |
| subframe navigation | allowed |
| `window.open` to allowed/auth origin | child BrowserWindow, **same partition**, sandboxed, no preload, closed on stop |
| `window.open` elsewhere | denied and logged (opening it in the system browser is deferred, ADR-0007) |
| downloads | cancelled + notice (v1) |
| permissions | deny except fullscreen, pointerLock, clipboard-sanitized-write |

OAuth popups are the only documented exception to "no BrowserWindow per
account". No user-agent spoofing or anti-bot bypass.

Popup rules (allowlist per game, limits, session pinning, lifecycle) are in
ADR-0007. The shell itself is served from `app://gamehub` (ADR-0014) and
receives sequenced events (ADR-0015). Known limitations, notably session
cookies across restarts, are in
[`docs/development/known-limitations.md`](../development/known-limitations.md).

---

## 8. Background & audio

- `backgroundMode` per game: **economy** (default, Chromium throttling) or
  **active** (`setBackgroundThrottling(false)`), switchable at runtime.
- In the 2×2 grid all four views are visible; the mode matters when one
  account is expanded or the window is minimized/occluded.
- Audio preference (global): **focused only** (default) or **all**; plus a
  per-account manual mute. Focus = the account selected in the UI. Main applies
  `setAudioMuted`.

---

## 9. UI over views (ADR-0009)

WebContentsViews render above the renderer DOM. Popovers/menus live in the
chrome region (sidebar/toolbar). Modal dialogs enable *occlusion*: Main hides
the views and the renderer shows placeholders.

Global shortcuts are application-menu accelerators (they work while a game view
has keyboard focus).

---

## 10. Data locations

| | macOS | Windows |
|---|---|---|
| userData (DB + Partitions) | `~/Library/Application Support/GameHub` | `%APPDATA%\GameHub` |
| logs | `~/Library/Logs/GameHub` | `%APPDATA%\GameHub\logs` |

`productName`/`appId` are frozen (ADR-0012). Development uses `GameHub-dev`;
tests use a temporary directory.

---

## 11. Source layout

```
src/
├── main/        app/ window/ instances/ browser-sessions/ navigation/
│                persistence/ ipc/ platform/ logging/
├── preload/     index.ts
├── renderer/    app/ features/{library,accounts,stage,settings}/ stores/ api/
│                components/ui/
└── shared/      ipc/ domain/        (pure TS: no electron, node or react)
tests/ unit/ integration/ e2e/ fixtures/
```

Layer boundaries are enforced by separate tsconfigs and lint rules.
