# ADR-0009: UI overlays above WebContentsViews

## Status
Accepted

## Context
WebContentsViews are composited above the shell renderer's DOM. React menus,
popovers and dialogs placed over a game area would be hidden.

## Options
| Option | Notes |
|---|---|
| Chrome-region popovers + occlusion mode for modals | simple; brief visibility change on views |
| Transparent overlay WebContentsView on top | complex input/focus routing |
| Hide all views whenever any overlay opens | disruptive |

## Decision
- Layout separates the chrome region (sidebar/toolbar) from the stage.
  Popovers/menus/tooltips render within the chrome region.
- Modal dialogs call `view:setOcclusion(true)`; Main hides views; the stage
  shows placeholders until occlusion ends.
- Global shortcuts are application-menu accelerators, which work while a game
  view holds keyboard focus.

## Revisit when
Occlusion visibly disrupts games or UX.
