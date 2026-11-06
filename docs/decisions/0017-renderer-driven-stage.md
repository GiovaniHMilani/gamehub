# ADR-0017: The renderer says where game views go; Main applies it

## Status
Accepted. Implements what ADR-0001 and ADR-0009 already specified ("the renderer
expresses intent, Main owns the views and their bounds"); until now Main laid views
out by itself in a fixed grid.

## Context
The shell has a sidebar, a top bar and a Play screen. Game views are native
`WebContentsView`s drawn ABOVE the page, so they must sit exactly in the Play
viewport, step aside for dialogs, and disappear when the user leaves the screen.
Only the renderer knows where the viewport is (it is laid out by CSS).

## Decision
- One-way message `stage:setLayout { slots: [{instanceId, x, y, width, height}] }`
  (preload: `window.gamehub.stage.setLayout`). Coordinates are the shell's CSS
  pixels, which equal the window's content coordinates.
- The renderer computes the arrangement (`computeTiles`: one tile, or a near-square
  grid with a 30 px header above each view, at most 9 tiles) because it also draws
  the headers. It sends at most one message per animation frame and skips
  unchanged layouts.
- Main (`normalizeSlots`, pure) does not trust the geometry either: slots for
  instances that are not mounted are ignored; an instance appears once (first
  wins); at most 16 slots; every rectangle is clamped into the window's content
  area and dropped if it ends up empty. The zod schema rejects the whole message
  for non-integers, negatives, extra keys or bad ids (logged, no reply: one-way).
- **Every view is hidden unless listed.** A new view starts hidden. The last
  request is re-applied when a view is mounted and when the window is resized, so a
  restarted account reappears in its slot even if React batched the intermediate
  states away.
- Occlusion (ADR-0009): while a dialog is open the renderer asks for an EMPTY
  layout, because a native view would cover the dialog. Leaving the Play screen
  does the same.
- `instances.focus(id)`: moves keyboard focus to a RUNNING instance's view
  (`INVALID_STATE` otherwise). The renderer calls it when a view has just been
  placed, not before.
- What the Play screen shows is derived, never stored: the requested instance if
  it still runs, else the first running one, else an empty state.

## Consequences
- Positive: Main stays the owner of views, and the renderer can only ask. A
  malformed or hostile layout cannot move a view outside the window.
- Negative: a layout request is lost-safe but not acknowledged; the E2E suite asserts the result by
  reading the real view bounds from Main.
- Measured (Electron 45): `view.setVisible(false)` does NOT put a page in the
  background. A hidden view keeps `visibilityState === "visible"`, its timers run
  at full rate (10/s for a 100 ms interval) and `requestAnimationFrame` keeps
  firing (~144/s). So hidden games keep progressing (good for idle games) but cost
  as much as visible ones (bad for many accounts). ADR-0010's "economy" throttling
  is therefore NOT in effect; implementing it is future work and must be tested
  against real games.
