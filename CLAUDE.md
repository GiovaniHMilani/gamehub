# GameHub — Claude Code Instructions

## 1. Project

GameHub is a desktop Electron application for managing multiple independent
browser instances for web games.

The primary use case is running multiple accounts of the same web game inside
one application while keeping each account isolated and persistent.

Example:

Game
├── Account A
├── Account B
└── Account C

Each account is represented by an independent GameInstance with its own
persistent Electron browser session.

---

## 2. Core architectural invariant

**One game account = one isolated persistent browser session.**

An instance MUST have its own:

- cookies
- localStorage
- sessionStorage
- cache
- IndexedDB
- authentication state
- browser storage
- WebContents

Different accounts MUST NOT share browser session state.

Use Electron persistent partitions such as:

`persist:gamehub-instance-<instance-id>`

Do not use `defaultSession` for game instances.

Do not manually copy cookies between instances.

Do not store browser cookies or authentication tokens in the application
database unless there is a compelling, explicitly documented reason.

---

## 3. Technology direction

Preferred stack:

- Electron
- TypeScript
- React
- Vite
- Tailwind CSS
- shadcn/ui
- Zustand
- SQLite
- Drizzle ORM
- Vitest
- Playwright
- electron-builder

Do not add a dependency simply because it is convenient.

Before adding a significant dependency, evaluate whether existing platform
capabilities or current project dependencies are sufficient.

---

## 4. Electron architecture

Use a clear separation:

Main Process
    |
    +-- WindowManager
    +-- InstanceManager
    +-- SessionManager
    +-- IPC handlers
    +-- Database
    +-- Services
    |
    +-- WebContentsView instances

Preload
    |
    +-- typed, minimal API surface
    |
    +-- IPC bridge

Renderer
    |
    +-- React UI
    +-- Zustand state
    +-- presentation logic

Renderer code MUST NOT directly access Node.js APIs.

Keep:

- `contextIsolation: true`
- `nodeIntegration: false`

Do not weaken Electron security settings merely to make a feature work.

---

## 5. Browser instance lifecycle

A GameInstance should have an explicit lifecycle.

Typical states:

- created
- mounting
- running
- hidden
- suspended
- stopping
- destroyed
- error

The lifecycle must be owned by the Main process.

Hiding a view does NOT automatically mean destroying its session.

Destroying a WebContentsView must be an intentional operation.

The SessionManager owns Electron session creation and retrieval.

The InstanceManager owns the logical game instance lifecycle.

Do not duplicate lifecycle logic across UI components.

---

## 6. WebContentsView

Prefer `WebContentsView` for embedding game web content inside the main
application window.

Do not create one BrowserWindow per account unless there is a documented
architectural reason.

The UI should be able to arrange multiple game instances inside the same
application window.

The renderer controls the requested layout state.

The Main process owns the actual WebContentsView objects and their bounds.

Never trust renderer-provided URLs, partitions, paths, or arbitrary IPC
arguments without validation.

---

## 7. IPC rules

All renderer-to-main communication must use explicit, typed IPC APIs.

Good:

Renderer
  -> window.gamehub.instances.create(...)
  -> preload
  -> ipcRenderer.invoke("instances:create")
  -> main handler
  -> InstanceManager

Bad:

Renderer
  -> arbitrary IPC channel
  -> arbitrary Electron API

Never expose:

- raw `ipcRenderer`
- raw `webContents`
- raw `session`
- raw Node.js filesystem APIs
- raw shell execution

The preload API should be small, intentional, and typed.

Validate IPC arguments in the Main process.

---

## 8. Data ownership

SQLite stores application metadata.

Examples:

- games
- accounts
- instances
- layouts
- preferences
- window configuration
- application settings

Electron persistent sessions store browser state.

Do not duplicate browser session data in SQLite.

Conceptually:

SQLite
  └── "What exists?"

Electron Session
  └── "What is the browser state?"

---

## 9. Suggested domain model

A Game represents a web game definition.

A GameAccount represents one account belonging to a Game.

A GameInstance represents a running or persisted application instance for a
GameAccount.

Conceptually:

Game
  |
  +-- GameAccount
        |
        +-- GameInstance
              |
              +-- Persistent Session
                    |
                    +-- WebContents

Do not collapse these concepts into one generic object.

---

## 10. Security

Treat game sessions as sensitive.

Never log:

- cookies
- authentication tokens
- authorization headers
- passwords
- session contents

Do not expose session paths to the renderer unless absolutely necessary.

External navigation must be explicitly controlled.

Do not allow arbitrary websites to gain access to privileged Electron APIs.

Keep CSP and navigation restrictions appropriate for the application.

Any security-sensitive architectural change must be documented.

---

## 11. Performance

The application is expected to support multiple concurrent game instances.

Performance matters from the beginning.

Monitor:

- renderer CPU
- main process CPU
- memory
- number of WebContents
- network activity
- background instances
- GPU usage when relevant

Do not prematurely implement aggressive suspension mechanisms.

First measure.

Then optimize based on evidence.

Avoid unnecessary React re-renders when many instances are visible.

The UI must remain responsive even when several game instances are active.

---

## 12. UI/UX principles

The product should feel like a polished desktop application rather than a
website placed inside Electron.

Target qualities:

- dense but readable
- fast
- keyboard-friendly
- responsive
- clear hierarchy
- consistent spacing
- polished empty states
- meaningful loading states
- clear instance status
- easy account switching
- obvious game organization

Avoid generic AI-generated dashboards.

Do not introduce visual complexity without a UX reason.

---

## 13. Development workflow

For significant tasks:

1. Inspect the existing architecture.
2. Identify affected boundaries.
3. Create a concise implementation plan.
4. Implement the smallest coherent change.
5. Run type checking.
6. Run relevant unit/integration tests.
7. Run E2E tests when behavior crosses the UI/Electron boundary.
8. Verify the actual application behavior when appropriate.
9. Review for security and session isolation.
10. Report what was actually verified.

Do not claim a task is complete merely because code was written.

---

## 14. Before changing architecture

If a change affects:

- session isolation
- IPC
- WebContents lifecycle
- persistence
- database schema
- security settings
- application-wide state
- process boundaries

explain the architectural impact before making a broad change.

Prefer small, reversible changes.

Record important architectural decisions in `docs/decisions/`.

---

## 15. Debugging

When debugging:

1. Reproduce the issue.
2. Identify which process owns the failing behavior.
3. Inspect the relevant lifecycle/state transition.
4. Form a concrete hypothesis.
5. Instrument minimally.
6. Test the hypothesis.
7. Fix the root cause.
8. Regression-test the fix.

Do not make unrelated changes while debugging.

Do not repeatedly guess at fixes without gathering evidence.

---

## 16. Testing requirements

Important behaviors should be testable.

Prioritize tests for:

- creating an instance
- creating multiple instances
- session isolation
- session persistence
- destroying an instance
- restoring instances after application restart
- IPC validation
- invalid game URLs
- invalid instance IDs
- layout changes
- database migrations

A particularly important invariant:

> Two different GameInstances must never unintentionally share browser state.

---

## 17. Git discipline

Keep commits focused.

Do not mix:

- architectural refactors
- unrelated UI changes
- dependency upgrades
- feature implementation

in one change unless necessary.

Never commit:

- credentials
- cookies
- session data
- local databases containing real user data
- build artifacts
- secrets

---

## 18. Documentation

When architecture changes, update the relevant documentation.

Important architectural concepts should remain understandable without reading
the implementation.

Prefer documenting:

- why a decision exists
- what invariant it protects
- what alternatives were rejected

rather than documenting obvious code line-by-line.

---

## 19. Definition of done

A feature is not complete until:

- TypeScript passes.
- Relevant tests pass.
- The feature was manually verified when appropriate.
- Session isolation remains intact.
- Electron security boundaries remain intact.
- No unnecessary dependency was introduced.
- Documentation was updated if architecture changed.
- No known regression was introduced.

When reporting completion, state what was actually checked.

Never say "fully tested" if only static analysis was performed.
