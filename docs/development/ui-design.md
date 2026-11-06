# UI design

The shell is a desk for running several accounts of one web game side by side. Its job:
see at a glance what is running, start and stop accounts, and jump into one.

## Plan

- **Colour.** Ink `#1b2430` for the sidebar and text (blue-tinted slate, never a flat black),
  cool paper `#eef1f5` for the canvas, hairline `#d3dae3`, one action colour `#0e7c86`, and one
  colour **per game** from a fixed ten-hue palette. State lamps: green, amber, red, grey.
- **Type.** The system UI face (native on macOS and Windows), 13 px base, tabular numerals,
  sentence case. No uppercase labels.
- **Layout.** Dark sidebar (navigation, the running accounts, a live indicator) and a light
  work area. The Library lists games, and each game's accounts are **lines**, not cards,
  separated by hairlines and carried by a rail in the game's colour.
- **The one memorable thing.** The account line: game-coloured rail, state lamp, name, state in
  words, and only the buttons that make sense for that state. Everything else stays quiet.

## Review against the generic defaults

Done before building, and again on screenshots of the real app:

- Not the cream + serif + terracotta page, and not near-black + one acid accent: the sidebar is
  blue-ink, the action colour only marks actions, and identity comes from many per-game hues.
- No kit of identical rounded cards with the same soft shadow: there are no cards and no shadows
  except the dialog.
- No tracked all-caps eyebrow labels, no `A · B · C` meta strings (counts read "3 accounts, 2
  running"), no `→` on buttons, no spaced-dash labels.
- State is never colour alone: ring (stopped), dot (running), pulsing dot (starting, stopping),
  diamond (error, crashed), and always the word next to it.

## What the visual review changed

1. Every game came out the same blue. Not a hash collision, as first assumed: a CSS custom
   property computed with `var(--hue)` on `:root` is inherited already resolved. The colours are
   now resolved in JavaScript and set on each game's element, assigned in order of creation so
   the first ten games are always different. A test now reads the computed colours.
2. Too many solid buttons (every Start, every Add account) hid which accounts were running.
   Now a solid button is reserved for what matters: Open (running), Retry (problem), and the
   single global Add game. Start and Add account are outlined, Allowed sites is quiet.
3. The final "Remove account" read as plain red text. It is now a solid red button
   (`destructive`), distinct from the quiet red row action (`danger`).

## Verified at 960 x 600, 1280 x 800 and 1600 x 1000

Library (empty, populated, an account in error, search, filter), the four dialogs, the
blocked-request notice, Play (one and all), Settings. Nothing is clipped or overlapping; at the
smallest window every account button stays inside the window.
