# ADR-0019: Background instances are already throttled; no economy mode is added

## Status
Accepted. Corrects the "Measured in Phase 7" notes of ADR-0010 and ADR-0017, which were wrong.

## Context
Phase 7 reported that hiding a game view does not put its page in the background (timers at full
rate, `visibilityState === "visible"`, ~144 `requestAnimationFrame`/s). Everything that followed
(README, known limitations, roadmap) said hidden accounts cost as much as visible ones and that an
economy mode was missing.

That measurement was taken with Playwright (`page.evaluate`). Playwright attaches the DevTools
protocol to every page, game views included, and applies its own focus/visibility emulation. The
instrument changed the thing it measured.

## Investigation (Phase 7.5)
Full numbers: `docs/development/reports/2026-11-06-background-performance.md`. Raw data and the
scripts to reproduce them: `bench/`. Electron 45.2.3, Chromium 156, macOS arm64.

1. A controlled benchmark creates real `WebContentsView`s (one in-memory partition each, 1/2/5/10
   of them) running an idle-game fixture: a 100 ms tick, `requestAnimationFrame`, a 1 s save to
   `localStorage` and IndexedDB, a 1 s `fetch` heartbeat and a WebSocket ping. The server counts
   heartbeats and socket messages, so the page is judged from outside as well as from inside.
2. The real application was driven WITHOUT Playwright on the game page (raw DevTools protocol on
   the shell only; the game reports its own state to a local server).
3. A real idle game (a static Cookie Clicker mirror, no login) was observed with `executeJavaScript`
   only, reading the game's own logic counter (`Game.T`).

## Findings
- `view.setVisible(false)` DOES put the page in the background: `visibilityState` becomes
  `hidden`, a 100 ms timer fires once a second, `requestAnimationFrame` stops, and the renderer's
  CPU drops from about 1.2% to 0.02% in the fixture (0.04% in the real game, from 1.3%).
- What does not stop: saves, heartbeats and WebSocket traffic (1 per second in the fixture),
  IndexedDB writes. Wall-clock progress stays at 1.0 s/s. The real game's logic counter stays at
  30/s (it catches up when its timer fires).
- Going back (`setVisible(true)` / `stage:setLayout`) restores timers, frames, the socket,
  storage and the view bounds, in the fixture at 1/2/5/10 accounts, in the real application and
  in the real game.
- Detaching the view (`removeChildView`), zero bounds, off-window bounds and a minimised window
  behave exactly like `setVisible(false)`: they add nothing.
- `setBackgroundThrottling(true)` on a hidden view changes nothing (it is already the default).
  `setBackgroundThrottling(false)` keeps a hidden page running at full speed (10 timer fires/s,
  ~144 frames/s, the visible CPU cost). That is the only switch found that changes behaviour.
- Rejected: CSS `display:none` (the page stays `visible`, frames keep running), CDP CPU throttling
  (CPU went UP, ~9% per account, the emulation costs more than it saves), `setFrameRate` (no effect
  on a normal view), CDP `frozen` lifecycle state (saves the last 0.02% of CPU and the heartbeat,
  but the page cannot react, the socket is not serviced, and it needs the DevTools debugger
  attached to a game page).
- Memory is not reduced by any strategy: about 100 MB per renderer in the fixture, about 187 MB in
  the real game (5 accounts ≈ 3 GB in total). Only destroying the WebContents would free it, and
  that discards the page's state, which the project does not do automatically.

## Decision
No economy mode is implemented. Hidden accounts already get Chromium's background throttling,
by construction, with no code in GameHub. The lifecycle, the domain, IPC and `WindowManager` are
unchanged. "Hidden" remains a presentation state of a running instance (ADR-0004).

`ADR-0010`'s per-game `backgroundMode: economy | active` is not built. `setBackgroundThrottling(false)`
is the known way to implement `active`; it needs a domain field, a migration, validation and UI, so
it is a change for a future decision, and only if a real game proves to need full-rate background
timers. No game tried so far does.

## Consequences
- The cost of N running accounts is dominated by memory, not CPU. Memory is the number to watch.
- E2E tests cannot observe this behaviour: Playwright's attachment alters it. `bench/real-app.cjs`
  is the check that does not (see `bench/README.md`).
- Chromium exempts pages that play audio from throttling. That was not measured here.

## Limitations of the evidence
Games that depend on timer cadence while hidden, that play audio, or that use workers were not
tested (only one real game, without login). The user's own OAuth game was not measured because it
needs credentials; `BENCH_URL` can point the harness at any public page. The fixture is light, so
absolute CPU figures are small; the relative drop is what carries over. Several runs used
`--disable-backgrounding-occluded-windows` because the screen was locked mid-measurement (see
the report); that removes the "window is covered" path only, and the hidden-view result with and
without it was identical.
