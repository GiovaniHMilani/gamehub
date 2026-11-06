# ADR-0018: UI state, components and styling

## Status
Accepted. Refines ADR-0011 (toolchain) for the renderer.

## Decision
- **State:** Zustand, as planned in ADR-0011, in three small stores.
  - `domain-store`: a READ-MODEL of what Main reports (games, instances, indexes,
    sync diagnostics, loading/error status). Nothing in it is authoritative.
  - `ui-store`: what the user is looking at (screen, dialog, search, filter, toasts,
    in-flight actions).
  - `notice-store`: pending "blocked request" notices.
  Instances still arrive through the existing snapshot + sequenced events
  (ADR-0015); the sync engine is the one in `shared/ipc/event-sync.ts`, extended
  with an error callback and `retry()`, not replaced.
- **Narrow subscriptions.** The domain store keeps normalised indexes whose arrays
  and records KEEP THEIR IDENTITY when their content did not change, so a row
  subscribes to `instancesById[id]` and re-renders only when its own instance
  changes. Lists are selected with `useShallow`. Derived values (the instance shown
  on Play, counts, visible games) are computed, not stored.
- **Components:** explicit variants and data tables instead of boolean props
  (`Button tone/size`, `actionsFor(status)`), composition for dialogs (`Modal` +
  `Field`), no components defined inside components.
- **Styling:** plain CSS with design tokens (`styles/*.css`), no Tailwind and no
  shadcn. The app needs a handful of components; a native `<dialog>` gives focus
  trapping, Escape and an inert background for free, and skipping two dependencies
  keeps the look from becoming the generic one. Tailwind/shadcn remain approved if
  the UI grows enough to need them.
- **No new IPC for state:** the renderer never polls. Games have no events yet; the
  list is refetched after the user's own actions and when an instance of an unknown
  game appears.

## Consequences
- The renderer can be unit-tested for its logic without a DOM: models, selectors,
  stores and actions run in Node with a fake preload API. Rendering and layout are
  covered by Playwright against the real Electron app.
- Colours: a game's colour is assigned by creation order from a fixed palette, so the
  first ten games never share one, and it is resolved in JavaScript and set as CSS
  variables on the game's element (a custom property computed from `var(--hue)` on
  `:root` would not reach its descendants).

## Update (Phase 7.6)
The visual decisions here (light work area, accounts as table lines, no cards) were replaced by ADR-0020. The state
model, the stores, the identity-preserving indexes and the plain-CSS-tokens choice stand.
