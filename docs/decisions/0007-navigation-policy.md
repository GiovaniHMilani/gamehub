# ADR-0007: Navigation and popup policy

## Status
Accepted

## Context
Target games use HTTPS and OAuth popups. Login flows cross origins; arbitrary
navigation must not stay inside the app.

## Decision
- Game URLs: `https` only; `http` allowed only for loopback (tests). No
  credentials in URL; `file:`, `javascript:`, `data:`, `chrome:` etc. rejected.
- `games.allowed_origins` = origin of `start_url` + user-added entries (exact
  origin or explicit `https://*.example.com`). No public-suffix dependency.
- Top-level navigation (`will-navigate`, `will-redirect`): allowed origins stay;
  others are blocked with an `app:notice` offering "open in browser" or
  "allow this domain".
- Subframe navigation: allowed (no privileges are involved).
- `window.open` to allowed origins: child BrowserWindow pinned to the opener's
  partition, sandboxed, no preload, same policy, tracked and closed with the
  instance. Elsewhere: `shell.openExternal` for http(s) only, otherwise deny.
- `about:blank` popups: denied in v1, logged for evaluation.
- Downloads: cancelled with notice.

## Consequences
- Users may need to allow the OAuth provider's domain once per game.
- Risk: providers that block embedded browsers; not circumvented.
