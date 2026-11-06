# ADR-0001: One shell window + WebContentsView per instance

## Status
Accepted

## Context
Four accounts of one game must be visible and controllable in one cohesive
desktop UI, with centralized focus, shortcuts and layout.

## Options
| Option | Pros | Cons |
|---|---|---|
| N BrowserWindows | native window management, simple bounds | fragmented UX, focus/shortcut handling per window; RAM not lower (process cost is per session, not per window) |
| 1 BrowserWindow + N WebContentsView | unified layout, one place for focus/shortcuts | views draw above the DOM; bounds synced manually |
| `<webview>` tag | DOM-integrated | discouraged by Electron, extra attack surface |

## Decision
One shell BrowserWindow hosting the React UI, plus one WebContentsView per
running instance, all owned by Main. OAuth popups are child BrowserWindows in
the opener's partition (the only exception).

## Consequences
- Positive: one coherent app, Main controls bounds/visibility/focus.
- Negative: React overlays cannot float over views (ADR-0009); renderer must
  report slot rects.

## Revisit when
Users need detachable per-account windows.
