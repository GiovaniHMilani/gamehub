# ADR-0003: SQLite metadata vs Electron session state

## Status
Accepted

## Context
Avoid duplicated state and keep secrets out of the application database.

## Decision
- SQLite: games, accounts, instances (restore intent, mute, zoom, slot),
  tombstones, app state/preferences/layout.
- Electron partition: cookies, localStorage, IndexedDB, cache, service workers,
  site auth.
- Never store: cookies, tokens, authorization headers, the current page URL
  (OAuth redirects carry tokens in query/hash), runtime lifecycle state.
- Restore always starts from `games.start_url`.
- `sessionStorage` does not survive restarts (web semantics) — documented, not
  worked around.

## Consequences
- Positive: minimal secret surface; one source of truth per data kind.
- Negative: user returns to the game's start page after restart.

## Revisit when
A game cannot recover its in-game location from cookies alone.
