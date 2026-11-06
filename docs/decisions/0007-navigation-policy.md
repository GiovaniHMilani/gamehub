# ADR-0007: Navigation and popup policy

## Status
Accepted. Popup rules made concrete in the OAuth phase (see "Popups" below).

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
  instance. Elsewhere: denied. (`shell.openExternal` for http(s) was planned and is
  deferred: it needs a user-confirmation flow; see "Popups".)
- `about:blank` popups: denied in v1, logged for evaluation.
- Downloads: cancelled with notice.

## Consequences
- Users may need to allow the OAuth provider's domain once per game.
- Risk: providers that block embedded browsers; not circumvented.

## Popups (OAuth)

Provider-agnostic: the policy knows origins, protocols and the instance, never a
provider name. Each game carries `allowedOrigins` (stored in `games.allowed_origins`):
its own origin is always allowed, plus configured exact origins or explicit
`https://*.example.com` wildcards. A flow must list **every** origin it touches.
The list is read at decision time, so editing it applies immediately to running
instances (views and popups), without a restart.

A popup is allowed only if all hold (`decidePopup`, pure):
- requested by the game page, not by another popup (no chains);
- disposition `new-window` or `foreground-tab`;
- URL parses, is `https` (`http` only on loopback), has no credentials, is not
  blank (`about:blank`/`window.open('')` are denied);
- its origin is in the game's allowed origins;
- the instance has no other popup open (limit 1) and made fewer than 5 allowed
  requests in the last minute.

Anything else is denied and logged with a reason. It is NOT sent to the system
browser (`shell.openExternal`): that needs a user-confirmation flow and is
deferred.

Session binding: Chromium gives a `window.open` child the BrowserContext of its
opener, and a `partition`/`session` option cannot change that (spike S5). The
`features` string is never forwarded: the popup gets fixed options (`sandbox`,
`contextIsolation`, no Node, no preload, child of the shell). On creation the
controller verifies the popup's session is the opener's and that the final
options are still secure, and destroys the window otherwise.

Inside a popup: `will-navigate`/`will-redirect` are limited to the allowed origins
(the redirect back to the game's `redirect_uri` works; an unlisted hop is
blocked), nested `window.open` is denied, the page cannot set the window title
(it shows the real host).

Lifecycle: requested -> validated -> created -> navigating <-> running -> closed.
`closed` releases the registry entry and every listener; instance stop, renderer
crash and app quit close the instance's popups.

When a request is refused only because its origin is not allowed, the user is
asked in one click (ADR-0016) instead of editing the list by hand.
