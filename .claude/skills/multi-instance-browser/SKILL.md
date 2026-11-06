---
name: multi-instance-browser
description: Architecture and implementation guidance for GameHub's isolated, persistent multi-account web browser instances. Use whenever work involves Electron sessions, partitions, WebContentsView, game accounts, instance lifecycle, cookies, localStorage, authentication persistence, instance restoration, or multiple simultaneous web-game accounts.
---

# Multi-Instance Browser Architecture

## Purpose

GameHub is a desktop application that hosts multiple independent web-game
accounts simultaneously.

The fundamental invariant is:

**One GameAccount maps to one isolated persistent Electron browser session.**

The browser state of one account must never leak into another account.

---

## 1. Domain model

Keep these concepts separate.

### Game

A web game definition.

Examples:

- name
- URL
- icon
- metadata
- optional default settings

### GameAccount

A user account belonging to a Game.

Examples:

- account ID
- game ID
- display name
- instance/session association

The account's actual browser credentials remain inside its Electron session.

### GameInstance

A runtime-managed instance associated with a GameAccount.

It owns:

- instance ID
- account ID
- lifecycle state
- layout information
- WebContentsView association
- session partition identifier

Conceptually:

Game
  |
  +-- GameAccount
        |
        +-- GameInstance
              |
              +-- Electron Session
                    |
                    +-- WebContents

Do not merge these concepts unless there is a documented reason.

---

## 2. Session isolation

Every GameAccount owns a unique persistent Electron partition (ADR-0002).
An account has at most one GameInstance (`game_instances.account_id UNIQUE`).

Format:

`persist:gh-<partitionId>`

where `partitionId` is an immutable UUID generated in Main when the account is
created and stored in `game_accounts.partition_id` (`UNIQUE`).

For example:

`persist:gh-7b2f...`

The partition identifier must be stable for the account across restarts,
unique across accounts, and never reused after deletion.

Two different accounts must never intentionally use the same partition.

Do not use:

- `defaultSession`
- one global partition for all games
- one partition per game when multiple accounts can exist
- temporary sessions for accounts that are expected to persist login state

Persistent sessions are required for restart persistence.

---

## 3. SessionManager responsibilities

The SessionManager is the only domain service responsible for obtaining
Electron Sessions for GameInstances.

It should provide a narrow API conceptually similar to:

```ts
get(accountId)              // resolves partitionId from the repository
clearBrowserData(accountId)
markForDeletion(accountId)  // tombstone; directory deleted on next boot (ADR-0008)
```

A loaded Electron session cannot be unloaded from the process, so physical
deletion of a partition directory happens at the next startup, before any
`session.fromPartition` call.

Do not expose raw Electron Session objects to the renderer.

The renderer should never know how sessions are implemented.

The SessionManager should:

1. Validate the instance identifier.
2. Resolve the partition name.
3. Obtain the Electron session.
4. Configure required session behavior.
5. Return the session to trusted Main-process code.

Keep session configuration centralized.

---

## 4. InstanceManager responsibilities

The InstanceManager owns the logical lifecycle of GameInstances.

It should coordinate:

- creation
- mounting
- navigation
- visibility
- layout
- suspension
- stopping
- destruction
- restoration

The InstanceManager may use the SessionManager, but should not duplicate
session creation logic.

Conceptually:

InstanceManager
    |
    +-- SessionManager
    |
    +-- WebContentsView
    |
    +-- Game repository

---

## 5. WebContentsView

Prefer WebContentsView for embedded game instances.

The Main process owns the WebContentsView.

The renderer owns UI intent such as:

- which instance is selected
- grid/list layout
- requested bounds
- visibility intent

The Main process translates that intent into actual WebContentsView operations.

Do not give the renderer arbitrary access to WebContents.

Do not expose:

```ts
webContents
session
BrowserWindow
WebContentsView
```

directly through preload.

---

## 6. Lifecycle

Use explicit lifecycle states.

States (ADR-0004):

```text
stopped → starting → running → stopping → stopped
starting --load failure--> error
running --render-process-gone--> crashed --reload--> starting
```

Visibility, focus and mute are a separate presentation axis
(`{ attached, visible, focused, muted }`), not lifecycle states.
Suspension is not part of v1.

Rules:

- Hiding a view must not destroy the session.
- Destroying a view must not accidentally delete persistent session data.
- Destroying an instance should be an explicit operation.
- Restoring an instance should reuse its existing persistent partition.
- A crashed renderer should be recoverable without creating a duplicate
  account/session.

---

## 7. Application restart

On application startup:

1. Process partition tombstones (before any `fromPartition`).
2. Load GameAccounts and instance metadata from SQLite.
3. Select instances with `restoreOnLaunch`.
4. Read each account's stored `partitionId` (never generate one here).
5. Obtain their persistent Electron sessions via SessionManager.
6. Create WebContentsViews and load the game's `startUrl` (the current URL is
   not persisted; it may contain OAuth tokens).
7. Mount them into the main window with bounded concurrency.

Do not create a new random partition during restoration.

If the partition changes, the user may appear logged out.

---

## 8. Cookies and authentication

Do not manually manage cookies unless the product explicitly requires it.

Electron persistent sessions should own browser state.

Avoid code such as:

```ts
database.save("cookies", ...)
```

unless there is a documented, security-reviewed requirement.

Never log cookies or authentication tokens.

Never send cookies to the renderer for display or storage.

---

## 9. Navigation security

Game URLs are untrusted input.

Before navigating:

- validate the URL
- require an allowed protocol
- reject dangerous protocols
- apply the application's external-navigation policy
- prevent arbitrary privileged navigation

Do not allow a game page to navigate into privileged application routes
without explicit handling.

If external links are supported, make the behavior intentional.

---

## 10. IPC

Renderer requests should use domain-level commands.

Good:

```ts
instances.create(...)
instances.close(...)
instances.reload(...)
instances.navigate(...)
instances.setBounds(...)
```

Avoid:

```ts
electron.execute(...)
webContents.execute(...)
session.execute(...)
```

IPC arguments must be validated in Main.

The renderer must not be trusted to provide:

- arbitrary partition names
- arbitrary filesystem paths
- arbitrary Electron APIs
- arbitrary shell commands

---

## 11. Multiple instances of the same game

This is a first-class use case.

Example:

```text
PokéIdle
├── Account A
│   └── persist:gh-<partitionId-A>
├── Account B
│   └── persist:gh-<partitionId-B>
└── Account C
    └── persist:gh-<partitionId-C>
```

All three may load the same URL while remaining completely separate browser
contexts.

The fact that the URLs are identical must never cause session sharing.

---

## 12. Performance

Multiple browser instances can be expensive.

Measure before optimizing.

Important metrics:

- renderer process memory
- CPU per instance
- number of active WebContents
- GPU usage
- network activity
- page visibility
- background timers

Possible future optimizations may include:

- visibility-aware throttling
- suspension of inactive instances
- configurable instance limits
- lazy mounting
- reduced rendering frequency

Do not implement aggressive throttling merely because it sounds efficient.
Some idle/web games rely on timers, WebSockets, visibility state, or browser
behavior that can be affected by suspension.

Any throttling feature must be tested against representative games.

---

## 13. Failure handling

Expected failures include:

- renderer crash
- navigation failure
- network failure
- invalid URL
- corrupted session data
- database inconsistency
- duplicate instance creation

The system should fail in a controlled way.

Never silently create a new account/session because an existing session failed
to initialize.

Prefer an explicit error state and recovery action.

---

## 14. Testing

Tests should verify:

### Isolation

Create two instances of the same game.

Set different browser state in each.

Verify the state does not cross over.

Examples of state:

- cookies
- localStorage
- IndexedDB
- authentication

### Persistence

1. Create an instance.
2. Authenticate.
3. Close the application.
4. Restart.
5. Restore the instance.
6. Verify authentication state remains.

### Lifecycle

Verify:

- create
- mount
- hide
- show
- reload
- stop
- destroy
- restore

### Security

Verify:

- renderer cannot access Node APIs
- invalid IPC arguments are rejected
- invalid navigation is rejected
- raw Electron objects are not exposed through preload

---

## 15. Anti-patterns

Avoid:

### Shared session

```ts
const ses = session.defaultSession
```

for all game instances.

### Session based only on game

```text
persist:game-pokeidle
```

This would cause all accounts of PokéIdle to share state.

### Random partition on every launch

```text
persist:<random-id>
```

This breaks persistence.

### Renderer-owned Electron lifecycle

The renderer should not directly create/destroy WebContentsView or Sessions.

### Cookie synchronization

Do not periodically copy cookies between stores.

### One BrowserWindow per account

Do not use this as the default architecture. Prefer one application window
with multiple WebContentsView instances unless a concrete requirement proves
otherwise.

---

## 16. Architectural checklist

Before approving a change involving browser instances, verify:

- [ ] Every instance has a unique persistent partition.
- [ ] Different accounts cannot share a partition.
- [ ] Session creation is centralized.
- [ ] Instance lifecycle is centralized.
- [ ] WebContentsView is owned by Main.
- [ ] Renderer receives only typed domain APIs.
- [ ] IPC arguments are validated.
- [ ] Cookies are not manually persisted.
- [ ] Authentication state is not logged.
- [ ] Restart restores the same partition.
- [ ] Security settings remain enabled.
- [ ] Relevant tests exist.
- [ ] Performance impact is understood.
