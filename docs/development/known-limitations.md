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

## Interface

- **Hidden accounts are not cheap.** Accounts that are running but not on screen (you
  are on the Library, or on Play showing another one) are hidden, not suspended. They
  keep their timers AND their animation frames running at the same rate as a visible
  one, so memory and CPU grow with the number of running accounts, not with the number
  you are looking at. Measured with a trivial page: about 100 MB per account renderer,
  about 1.07 GB for 5 accounts plus the shell. There is no economy mode yet (ADR-0010).
- The "All" view on Play shows at most 9 accounts at once (the rest keep running).
- Games have no change events: the game list is refetched after your own actions and
  when an account of an unknown game appears. A game added or removed by another route
  would not show up until then. A game can be added, edited (name, address, description)
  and removed from the UI.
- Changing a game's address: accounts keep their data (a partition belongs to the account),
  but cookies and storage belong to a SITE, so moving to another site may sign accounts out.
  The edit form warns about that, and that running accounts stay on their current page until
  restarted. A running account also keeps the sites it was started with; they are recomputed
  from the saved game the next time the game's allowed sites change.
- Removing a game removes its accounts one by one, through the same path as removing a
  single account (stop, delete rows, tombstone, wipe the session). If one of them fails,
  the error is shown and the game keeps the accounts that were not removed yet; removing
  it again finishes the job. The accounts already removed are gone.
- A game's colour follows the order in which games were created (ten distinct colours,
  then they repeat). It is not configurable, and removing a game shifts the colours of the
  games created after it.
- Electron's window capture does not include the game views, so screenshots of the
  window show an empty viewport; the views are verified by reading their real bounds.

