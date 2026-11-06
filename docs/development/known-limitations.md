# Known limitations

Behavior that is deliberate or inherited from Chromium/Electron, and that
affects users or future decisions. Nothing here is silently worked around.

## Cookies without an expiry do not survive a restart

**What happens.** Each account has a persistent partition (`persist:gh-<id>`).
After closing and reopening GameHub:

| Data | Restored |
|---|---|
| cookie with `Expires`/`Max-Age` | yes |
| `localStorage`, `IndexedDB`, cache, service workers | yes |
| cookie **without** an expiry ("session cookie") | **no** |
| `sessionStorage` | no (web semantics: it is per tab) |

This is standard Chromium behavior, observed with Electron 45.2.3
(`docs/development/spikes.md`, S6; asserted in `tests/e2e/persistence.spec.ts`).

**Impact.** A game that keeps its login only in a session cookie logs the user
out each time GameHub restarts, even though the session partition persists.
Games that use persistent cookies, tokens in storage, or a refresh token are
unaffected. OAuth does not change this: the popup runs in the same session.

**What was deliberately not done.** No conversion of session cookies into
persistent ones, no rewriting of `expires`, no copying or manual management of
cookies or authentication. CLAUDE.md §2 and ADR-0003 forbid it, and it would
change what the game believes about its own cookies.

**If a game needs it.** Treat it as a future, game-specific architectural
decision with its own ADR and security review, not a global setting.

## Popups

- `allowedOrigins` must list every origin of an OAuth flow (the game's own
  origin is implicit). A hop through an unlisted origin is blocked, for popups
  and for top-level redirects alike (log event `navigation.blocked` /
  `popup.navigation_blocked`; the log shows origin and path only). The list is
  granted from the notice the control strip shows when something is blocked
  ("Allow" / "Dismiss", ADR-0016); it applies at once to the game's running
  instances. There is no manual field any more, and no UI to remove or edit a
  granted origin yet (`games.setAllowedOrigins` exists in Main/IPC for a future
  settings screen).
- Only origins that can be allowed are offered (https, or http on loopback). Other
  refusals (plain http on a public host, `javascript:`, `file:`) are silent.
- Allowing from a notice is per game, not per account, and cannot be undone from
  the UI yet.
- `window.open('about:blank')` followed by a script-set location is denied;
  libraries that use it must open the provider URL directly.
- Denied popups are not offered in the system browser.
- One popup at a time per instance, 5 per minute. Popups cannot open popups.
- Wildcard origins do not use the public-suffix list: `https://*.co.uk` is
  accepted and is the user's responsibility.
- Providers that block embedded browsers (some do) will refuse to sign in. No
  user-agent spoofing or other workaround is applied.

## Shell

- `pnpm dev` serves the shell from the Vite dev server (`http://localhost:5173`)
  for HMR; builds, tests and packaged apps use `app://gamehub`.
- Closing the main window quits the app on every platform.
