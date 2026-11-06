---
name: electron-performance
description: Performance engineering for GameHub's Electron multi-instance architecture. Use when optimizing CPU, memory, WebContentsView, browser instances, sessions, IPC, React rendering, startup, background instances, or leaks.
---

# Electron Performance

## Primary goal
Keep the GameHub shell responsive while multiple independent browser instances are alive.

Optimize based on measurements, not guesses.

## Performance model

```text
GameHub Shell
  ├── React Renderer
  ├── Main process
  ├── WebContentsView × N
  └── Persistent Session × N
```

The expensive resources are primarily:
- Chromium renderer processes
- DOM/JS execution in game pages
- network activity
- timers
- memory retained by pages
- IPC traffic
- React re-renders
- duplicated listeners

## Measure first
Before changing architecture, collect:
- number of active instances
- CPU usage
- memory usage
- startup time
- time to first usable game view
- renderer responsiveness
- IPC frequency
- number of WebContents
- number of event listeners
- network activity where observable

Record a baseline for representative instance counts such as:

```text
1
3
5
10
```

Do not claim an optimization without evidence.

## Instance lifecycle
Every instance must have a clear lifecycle.

When an instance is closed:
- remove it from its container
- detach/destroy its WebContents as appropriate
- remove event listeners
- clear timers
- release references
- release associated UI state

A "closed" instance must not remain strongly referenced indefinitely.

## Background instances
Do not assume hidden instances are cheap.

Background game pages may continue:
- JavaScript timers
- animation
- network polling
- WebSocket traffic
- DOM mutation
- audio/media work

If the product later needs suspension/throttling, implement it deliberately and test whether the game remains functional.

Never add arbitrary delays or polling loops merely to reduce perceived load.

## WebContentsView
Avoid repeatedly creating/destroying views for simple visibility changes.

Prefer:
- stable instance identity
- controlled attach/detach
- explicit visibility
- reuse when appropriate

But do not retain abandoned WebContents indefinitely.

## IPC performance
Do not stream high-frequency browser events into React unless the UI needs them.

Avoid patterns like:

```text
WebContents event
  -> IPC
  -> Zustand
  -> React render
  -> every few milliseconds
```

Instead:
- aggregate events
- debounce/throttle UI updates when appropriate
- keep high-frequency data in Main when the UI does not need every event
- send snapshots/deltas rather than redundant full objects

## React performance
Use the project's React best-practice guidance.

For large instance lists:
- keep row components isolated
- subscribe to narrow Zustand slices
- avoid selecting entire stores
- avoid recreating large objects unnecessarily
- consider virtualization if the number of visible items becomes large

## Memory leaks
Common causes:
- WebContents listeners not removed
- IPC listeners registered repeatedly
- timers surviving instance destruction
- retained closures
- Zustand subscriptions not cleaned up
- references to destroyed BrowserViews/WebContents
- repeated preload/page listeners

When fixing a suspected leak, identify the retained reference first.

## Startup
Do not initialize every expensive resource eagerly if the product does not need it.

Separate:
- application shell startup
- metadata loading
- session restoration
- browser instance creation
- first-view activation

Restore state in a controlled sequence and avoid creating duplicate instances.

## Database performance
SQLite operations should not block the renderer.

Use Main-side database access and appropriate indexes.

Avoid writing to SQLite on every UI keystroke or browser event.

## Network
Do not implement application-level polling when an event-driven mechanism is available.

For diagnostics, distinguish:
- GameHub-generated traffic
- game-page traffic
- update/download traffic

## Profiling checklist
When performance degrades:
1. Reproduce with a known number of instances.
2. Establish whether CPU, memory, network, IPC, or React rendering is the bottleneck.
3. Capture measurements.
4. Identify the largest contributor.
5. Change one variable.
6. Re-measure.
7. Keep the change only if it improves the relevant metric without breaking lifecycle/security.

## Anti-patterns
Avoid:
- polling every instance from React
- global 100ms/1s intervals for everything
- keeping destroyed WebContents in maps
- rendering all instance details on every update
- serializing huge WebContents/browser state objects through IPC
- optimizing before measuring
- disabling useful functionality solely to reduce resource usage

## Definition of done
Performance work is complete when:
- a measurable bottleneck was identified
- the fix addresses the bottleneck
- no lifecycle/resource leak was introduced
- behavior remains correct
- representative instance-count testing was performed
