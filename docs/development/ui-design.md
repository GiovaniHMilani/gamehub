# UI design

The shell is a launcher: a place to open, watch and play web games, with several accounts of each
running side by side. The reasoning and the rejected options are in ADR-0020; this is the working
reference. (The Phase 7 design, a light canvas with accounts as table lines, was replaced.)

## Tokens

| | |
|---|---|
| Night | `#16121f` canvas, `#110e19` rail, `#1e1929` surface, `#282238` raised, `#342d48` raised 2 |
| Text | `#f4f0fa`, muted `#a79fbd`, faint `#7d7594` |
| Ember (the action) | `#ffb340` to `#ff9419`; ink on it `#2a1700` |
| State | running `#52d391`, changing `#f5c04b`, problem `#ff6e6e`, stopped `#7d7594` |
| A game | `--game` `hsl(h 75% 62%)`, `--game-mid` `hsl(h 58% 36%)`, `--game-deep` `hsl(h+24 52% 15%)`; ten hues handed out by creation order |
| Radius | poster 20, tile 14, control 12, pills and portraits fully round |
| Type | Bricolage Grotesque for titles, numbers and Play; system UI face for body, 14 px; scale 12.5 / 14 / 16 / 21 / 27 |

## Components

- **Poster** (`game-panel`): generated cover, title, one line (description, else host), counts as words,
  Play, the game menu. Under it the party.
- **Party member** (`session`): portrait, name, state in words, main verb, Stop, menu.
- **Rail**: mark, Library / Play / Settings, the running accounts as portraits.
- **Play**: the top bar is the toolbar; tile headers are 30 px; the game views take the rest.
- **Menu**: platform popover anchored to its button.

## Rules kept from the earlier design
- State is never colour alone: ring style, lamp shape and a word.
- A solid control is reserved for what matters: Play (ember), and Remove in its confirmation (red).
- Sentence case, no tracked all-caps eyebrows, no `A · B · C` strings, no arrows on buttons.
- Plain words: "Allowed sites", not "origins".

## Verified
At 960 x 600 (the E2E minimum), 1280 x 720, 1440 x 900, 1600 x 900 and 1920 x 1080: empty library, one
game with and without accounts, three games with running, stopped and failed accounts, twelve games,
the filter, both menus, the add and edit dialogs, the blocked-site notice, Settings, Play with one
account and with all (composited with the real game views).
