# ADR-0010: Background mode and audio policy

## Status
Accepted

## Context
Hidden pages get timer throttling from Chromium, which may slow idle games.
Four accounts playing audio at once is noisy. The user wants both as options.

## Decision
- `games.background_mode`: `economy` (default; Chromium throttling) or
  `active` (`webContents.setBackgroundThrottling(false)`), applied at runtime
  without recreating views.
- Audio preference (global, `app_state`): `focused-only` (default) or `all`.
  Per-account manual mute in `game_instances.muted` overrides it.
- "Focused" = account selected in the UI; Main applies `setAudioMuted` on
  selection change.
- No suspension in v1.

## Consequences
- In the 2×2 grid all views are visible; background mode mainly matters when
  one account is expanded or the window is minimized/occluded.
- Exact visibility semantics under `active` must be measured (Phase 9).

## Measured in Phase 7
Hiding a view with `view.setVisible(false)` does not make Chromium treat the page as
backgrounded: `visibilityState` stays `visible`, timers keep their normal rate and
`requestAnimationFrame` keeps firing at the same rate as for a visible view. The
"economy" mode described above is therefore not in effect today; neither
`backgroundMode` nor `setBackgroundThrottling` is implemented. See ADR-0017.

