# ADR-0016: Ask the user when an origin is blocked

## Status
Accepted. Implements the "block + notice offering to allow this domain" step
that ADR-0007 planned.

## Context
Editing a game's `allowedOrigins` by hand meant reading the log to learn which
origin was blocked, typing it, saving, and retrying. That is a bad process for
the most common case: a game that redirects to its OAuth provider.

## Decision
When policy refuses a top-level navigation, a popup, or a hop inside a popup
only because the **origin is not allowed**, Main raises a *notice*. The shell
shows it in the control strip:

> "teste" wants to go to **https://accounts.google.com**. Allow it for all
> accounts of pokeidle.io?  [Allow] [Dismiss]

- **Allow** adds exactly that origin to the game (all its accounts), applies it
  to the game's live views, persists it, and **redoes the refused navigation**.
  A refused popup cannot be redone: the UI says to click sign-in again.
- **Dismiss** saves nothing and redoes nothing.

Safeguards (all enforced in Main, `NoticeBroker`):
- **The page cannot choose what is shown or allowed.** The notice carries the
  instance label, the game name and the destination *origin*, computed by Main
  from the real URL. `notices.resolve` takes only `{noticeId, decision}`: it
  cannot name an origin, and an unknown or stale id is `NOT_FOUND`.
- **The full URL never leaves Main.** It may carry OAuth `client_id`/`state`; it
  is kept in memory for the retry only, and is not logged or sent to the
  renderer.
- **Only allowable origins are offered**: the same rules as the policy
  (`parseGameUrl`: https, or http on loopback; no credentials). Plain-http
  public hosts, `javascript:`, `file:` and credentialed URLs generate no
  question. (Top-level navigation now also refuses credentials, as popups did.)
- **No flooding**: one notice per (game, origin); at most 5 pending; a dismissed
  origin is not asked about again for 60 s (compared with timestamps, no timers).
- **Cleanup**: notices (and their retries) go away when their instance stops,
  crashes or is removed, and when a manual edit already allows the origin.
- Exact origins only: no wildcards are created from a prompt.

IPC: `notices.list`, `notices.resolve({noticeId, decision})`, event
`notices:changed` carrying the FULL pending list (state-based, so no `seq`).

## Consequences
- Positive: one click instead of log reading; the log/DB trail is unchanged
  (`notice.requested|allowed|dismissed|suppressed`, `view.allowed_origins_updated`).
- Negative: a hostile page can make the strip show a question (bounded as above);
  the user is the only gate, so the text names the origin plainly. Approving an
  origin applies to every account of the game.
- Not covered: plain http hosts and non-http schemes remain silently refused.
