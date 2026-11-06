---
name: electron-development
description: Build and maintain GameHub as a production-grade Electron application. Use for Electron architecture, Main/Preload/Renderer boundaries, WebContentsView, IPC, lifecycle, packaging, persistence, windows, permissions, navigation, and native integration.
---

# Electron Development

## Goal
Implement Electron features with clear process boundaries, predictable lifecycles, security-first defaults, and testable services.

## Process responsibilities

### Main
Main is authoritative for:
- application lifecycle
- BrowserWindow/WebContentsView creation and destruction
- persistent Electron sessions
- navigation policy
- IPC handlers
- filesystem/database access
- privileged APIs
- external URL handling
- recovery and restoration

### Preload
Preload is a narrow capability boundary:
- expose only explicit application operations
- use `contextBridge`
- expose typed request/response contracts
- validate/normalize data before sending it to Main where practical
- never expose unrestricted Electron or Node APIs

### Renderer
Renderer:
- renders UI
- manages presentation state
- calls the typed preload API
- must not import `electron`, `fs`, `path`, `child_process`, or Node internals
- must not directly manage browser sessions

## IPC rules
Prefer explicit channels or a typed API such as:

```ts
type GameInstanceApi = {
  list(): Promise<GameInstanceSummary[]>
  create(input: CreateGameInstanceInput): Promise<GameInstanceSummary>
  close(instanceId: string): Promise<void>
  focus(instanceId: string): Promise<void>
}
```

Avoid generic channels such as:

```ts
ipcRenderer.invoke("execute", arbitraryPayload)
```

Every IPC operation should have:
1. a documented contract
2. input validation
3. authorization/ownership checks where applicable
4. a deterministic response/error shape

## WebContentsView
Use `WebContentsView` when multiple embedded browser surfaces need to coexist inside one application window.

The Main process owns:
- creation
- bounds
- attachment/detachment
- navigation
- visibility
- focus
- destruction

Renderer state should represent the UI's understanding of the instance, not own the underlying WebContents.

## Session creation
For an independent browser identity:

```ts
const partition = `persist:gamehub-instance-${instanceId}`
const session = session.fromPartition(partition)
```

Do not reuse a session between accounts unless that is explicitly the intended product behavior.

Do not use:
- `defaultSession` for independent accounts
- one partition for multiple unrelated accounts
- an in-memory session when persistence is required

## Lifecycle
Design explicit transitions:

```text
created
  -> starting
  -> running
  -> stopping
  -> stopped
  -> error
```

Destroy WebContents and detach views when an instance is permanently closed.

Do not use arbitrary delays to "make Electron ready". Prefer Electron lifecycle events, WebContents events, promises, and explicit state transitions.

## Navigation
Define an explicit navigation policy:
- allowed initial URLs/domains
- external links
- new windows
- downloads
- permission requests
- redirects

Do not blindly allow every navigation request from remote content.

## External URLs
When a link should leave GameHub, open it using an explicit external-browser path rather than allowing arbitrary embedded navigation.

## Permissions
Only grant permissions required by the application. Handle permission requests explicitly when the Electron API surface requires it.

## Persistence
Separate:
- app metadata -> SQLite/Drizzle
- browser state -> Electron persistent session

Never duplicate cookies/localStorage/auth state into SQLite unless there is a concrete product requirement and a security review.

## Packaging
Before release, verify:
- production build
- packaged app launches
- persistent sessions survive restart
- renderer cannot access Node APIs
- IPC contracts work in production mode
- external navigation behaves as intended

## Testing
For Electron behavior, prefer testing at service boundaries first:
- SessionManager
- InstanceManager
- IPC handlers
- navigation policy

Then add end-to-end tests for critical user flows.

## Anti-patterns
Do not:
- put Electron logic in React components
- expose `ipcRenderer` directly
- use `remote`
- use arbitrary `eval`
- make the renderer authoritative for instance lifecycle
- create one BrowserWindow per account without a strong reason
- leak WebContents listeners
- keep hidden WebContents alive forever without a lifecycle policy

## Definition of done
A change is complete only when:
- architecture boundaries remain intact
- types pass
- relevant tests pass
- lifecycle cleanup is accounted for
- security implications are considered
- production behavior is verified where relevant
