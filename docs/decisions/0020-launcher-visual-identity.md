# ADR-0020: A launcher, not a dashboard: visual identity and the shape of the shell

## Status
Accepted. Supersedes the visual part of ADR-0018 (light work area, accounts as table lines);
its state and store decisions stand.

## Context
Phase 7's interface worked but read as an admin panel: a light canvas, games as database
records, four management buttons beside every game title, accounts as rows of a table. The product
is a place to open, watch and play games, with several accounts of each running at once.

## Decision
**Idea.** Games are posters; accounts are the party that plays them; the only loud thing is Play.

- **Game poster.** Each game has a cover generated from its colour: a gradient, one of six patterns
  (`gameMotif`, a hash of its id, so it never changes) and a huge initial. Nothing is loaded: no image,
  no blur, no filter. A game with something running glows in its own colour.
- **Accounts as a party.** A round portrait in the game's colour, ringed by its state, with a small lamp.
  State is told by ring style (dashed stopped, solid running/error, turning while changing), lamp shape
  (ring, dot, pulse, diamond) AND the word beside it; colour is the third signal, not the only one.
- **One loud verb.** Play is the only solid ember control. On a game it means: nothing running, start
  every stopped account and go to Play; something running, "Open" only opens (starts nothing: the label
  must not promise less than it does). An account's main verb is tinted, not solid; Stop is an icon.
- **Administration out of the way.** Allowed sites, Edit game, Remove game live in the game's menu;
  Restart and Remove in the account's menu. Nothing was removed; it moved.
- **Narrow rail.** Icon navigation (names in the accessible label and tooltip) and the running
  accounts as portraits. There is no separate Home: the Library opens on the posters and the rail
  already shows what is running.
- **Play steps back.** The top bar becomes the toolbar (account, game, One/All, restart, stop) and the
  game views take the rest. Tile headers are 30 px with icon buttons. The toolbar keeps a small
  "Add game" so dialogs can still be opened from Play (and the view-covers-dialog rule stays testable).
- **Dark, warm, quiet.** Aubergine night (`#16121f`), warm greys, one ember (`#ffb340`) for the action,
  per-game hues for everything else. A static two-light aura behind the shell, painted once.
- **Type.** Bricolage Grotesque (variable, weight axis only) for titles, numbers and Play; the system
  UI face for body text. Sentence case, no tracked all-caps, no `A · B · C` strings.
- **Motion.** One entrance (posters rise in, staggered, capped at 8) and state feedback: a lamp that
  pulses and a ring that turns only while an account is starting or stopping. Nothing runs
  continuously otherwise (checked: no running animations on an idle Library). Reduced motion removes all of it.
- **Menus** use the platform popover (`popover` + CSS anchor positioning): outside click, Escape and
  top layer come from the browser; the component only adds arrow-key movement and focus return.

## Dependency
`@fontsource-variable/bricolage-grotesque` (OFL-1.1), a dev dependency bundled by Vite: 44 KB of latin
glyphs plus two on-demand subsets. Evaluated against the system stack: the system faces differ per
platform and none gives the titles a character of their own, which is the point of the redesign. The
CSP already allows same-origin fonts. If the font fails to load the stack falls back to `ui-rounded` and
the system UI face.

## Rejected
- Home screen with "recently played": there is no play history in the model, and inventing one is a
  domain change. The Library plays that role.
- A game detail drawer for accounts: more navigation state and every E2E flow one click deeper, for no
  gain over accounts sitting inside the poster.
- Showing uptime (`ligada há 10 s`): `InstanceSummary` has no start time; adding one is an event and
  domain change, not a visual one.
- Tailwind / shadcn: still plain CSS tokens (ADR-0018).
- Renaming states to Online/Offline: Running/Stopped are the lifecycle's own words (ADR-0004) and a
  logged-in/online meaning would be wrong.

## Consequences
- No change to Main, preload, IPC, the domain, sessions or the stage contract.
- `performInstanceAction` now resolves to a boolean (was void) and there is a new `playGame` action.
- Panels are laid out in CSS columns (not a grid) so panels of different heights leave no holes; the
  reading order is down each column.
- E2E tests changed where the contract visibly changed (menus, class names, copy); see the Phase report.
