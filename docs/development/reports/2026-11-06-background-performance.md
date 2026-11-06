# Background performance of running accounts (Phase 7.5)

Date: 2026-11-06. Electron 45.2.3, Chromium 156, macOS arm64, 10 cores, 16 GB.

## 1. Summary

Phase 7 concluded that hiding a game view does not put the page in the background, so hidden accounts
cost as much as visible ones. **That was wrong.** It was measured through Playwright, which attaches to
every page and changes what the page reports. Measured without it, in the controlled benchmark, in the
real application and in a real idle game, a hidden view is backgrounded by Chromium: `visibilityState`
is `hidden`, a 100 ms timer fires about once a second, animation frames stop, and CPU per account falls
by about 98%. The page's saves, heartbeats and WebSocket traffic keep going once a second, and
wall-clock progress is intact. Showing the view again restores everything.

No other strategy is better, and none reduces memory. **Decision: NÃO IMPLEMENTAR** a economy mode.
The behaviour already exists. What was needed was correcting the documentation (ADR-0019).
The real cost of many accounts is memory (~100 MB per account for a light page, ~190 MB for a real game).

No application code changed.

## 2. Baseline

Row "visible" of each table below. One account: timer 10/s, 144 frames/s, 1.2% of a core, ~100 MB.
Before this phase the project documentation claimed hidden accounts looked the same.

## 3. Strategies tested

| Strategy | What was done | Result | Decision |
|---|---|---|---|
| A. Only hide | `view.setVisible(false)` | Backgrounded: hidden, 1 timer/s, 0 frames, 0.02% CPU, network/storage unchanged | Already in use. Keep |
| B. Background throttling | `setBackgroundThrottling(true)` on a hidden view | Identical to A (it is the default) | Nothing to do |
| B2. Throttling off | `setBackgroundThrottling(false)` + hidden | Page stays `visible`, 10 timers/s, 144 frames/s, visible-level CPU | Works as an "active" switch; not built (needs domain, schema, IPC, UI) |
| C. Detach | `removeChildView` | Identical to A; reattach restored bounds and state | No gain, more state to restore |
| D. Hide differently | bounds 0x0, bounds off-window, window minimised | Identical to A | No gain |
| D3. CSS | `display:none` inside the page | Page stays `visible`, frames keep running; CPU only ~40% lower | Rejected |
| E1. CPU throttle | CDP `Emulation.setCPUThrottlingRate` 10 | CPU went UP (~9% per account) | Rejected |
| E2. Frozen | CDP `Page.setWebLifecycleState frozen` | CPU 0, no network; page unreachable; needs the debugger attached to a game page; WS idle-timeouts and pushes not tested | Rejected: saves the last 0.02% |
| E3. Frame rate | `setFrameRate(1)` | No effect on a normal view | Rejected |
| E. Destroy WebContents | Not measured | It is the only thing that frees memory, and it discards page state | Not done: out of scope without an explicit decision |

Per-row detail and recovery checks are in section 4 (the last column).

## 4. Benchmarks (controlled fixture)

Fixture: idle game with a 100 ms tick (with a little work), a 150-dot canvas animation, a 1 s save to
localStorage and IndexedDB, a 1 s heartbeat and a 1 s WebSocket ping. Each account has its own in-memory
partition and its own renderer process. 3 s warm-up, strategy applied, 2 s settle, 8 s sampled, strategy
undone, 2.5 s settle, 4 s sampled to verify recovery. "Back to normal" means: reachable, `visible`,
>9 timer fires/s, >30 frames/s, socket open, view bounds restored. In every row, saved counters existed in
both localStorage and IndexedDB after recovery.

"CPU per background renderer" is the mean over the accounts the strategy was applied to; CPU is percent
of one core, from `app.getAppMetrics()`. RAM is the sum of working sets (shared pages are counted more
than once, so it overstates; use it to compare rows, not as an exact total).


#### N = 1 (the single account is the one being hidden)
| Strategy | Page state | Timer fires/s (100 ms timer) | Game progress/s (wall clock) | rAF/s | Server sees: heartbeats / ws msgs per s | CPU per background renderer (%) | CPU, all processes (%) | RAM, all processes (MB) | Back to normal |
|---|---|---|---|---|---|---|---|---|---|
| visible | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 1.23 | 3.3 | 459 | ok |
| hidden | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 0.1 | 395 | ok |
| hidden+throttle | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 0.1 | 396 | ok |
| hidden+nothrottle | visible | 10.0 | 1.00 | 1 | 1.0 / 1.0 | 0.08 | 0.3 | 402 | ok |
| detach | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 0.1 | 399 | ok |
| zero-bounds | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 0.1 | 401 | ok |
| offscreen | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 0.1 | 402 | ok |
| css-display-none | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 0.71 | 1.6 | 414 | ok |
| cpu-throttle-10 | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 9.29 | 9.6 | 413 | ok |
| hidden+frozen | unreachable | n/a | n/a | n/a | 0.0 / 0.0 | 0.00 | 0.0 | 409 | ok |
| detach+frozen | unreachable | n/a | n/a | n/a | 0.0 / 0.0 | 0.00 | 0.0 | 410 | ok |
| frame-rate-1 | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 1.56 | 4.0 | 415 | ok |
| window-minimized | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 0.1 | 411 | ok |

#### N = 2 (1 visible + 1 in background)
| Strategy | Page state | Timer fires/s (100 ms timer) | Game progress/s (wall clock) | rAF/s | Server sees: heartbeats / ws msgs per s | CPU per background renderer (%) | CPU, all processes (%) | RAM, all processes (MB) | Back to normal |
|---|---|---|---|---|---|---|---|---|---|
| visible | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 1.30 | 6.2 | 520 | ok |
| hidden | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 4.0 | 517 | ok |
| hidden+throttle | hidden | 1.1 | 1.12 | 0 | 1.1 / 1.1 | 0.03 | 4.0 | 521 | ok |
| hidden+nothrottle | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 1.29 | 6.2 | 525 | ok |
| detach | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 4.1 | 526 | ok |
| zero-bounds | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 4.0 | 529 | ok |
| offscreen | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 4.0 | 532 | ok |
| css-display-none | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 0.70 | 5.0 | 537 | ok |
| cpu-throttle-10 | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 9.31 | 10.1 | 540 | ok |
| hidden+frozen | unreachable | n/a | n/a | n/a | 0.0 / 0.0 | 0.00 | 4.1 | 541 | ok |
| detach+frozen | unreachable | n/a | n/a | n/a | 0.0 / 0.0 | 0.00 | 4.0 | 544 | ok |
| frame-rate-1 | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 1.31 | 6.3 | 545 | ok |
| window-minimized | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 0.2 | 541 | ok |

#### N = 5 (1 visible + 4 in background)
| Strategy | Page state | Timer fires/s (100 ms timer) | Game progress/s (wall clock) | rAF/s | Server sees: heartbeats / ws msgs per s | CPU per background renderer (%) | CPU, all processes (%) | RAM, all processes (MB) | Back to normal |
|---|---|---|---|---|---|---|---|---|---|
| visible | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 1.18 | 10.7 | 857 | ok |
| hidden | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 4.2 | 834 | ok |
| hidden+throttle | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 4.0 | 840 | ok |
| hidden+nothrottle | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 1.24 | 10.8 | 848 | ok |
| detach | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 3.9 | 852 | ok |
| zero-bounds | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 4.1 | 857 | ok |
| offscreen | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 4.1 | 862 | ok |
| css-display-none | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 0.63 | 7.4 | 885 | ok |
| cpu-throttle-10 | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 9.65 | 41.5 | 885 | ok |
| hidden+frozen | unreachable | n/a | n/a | n/a | 0.0 / 0.0 | 0.00 | 3.8 | 886 | ok |
| detach+frozen | unreachable | n/a | n/a | n/a | 0.0 / 0.0 | 0.00 | 4.0 | 892 | ok |
| frame-rate-1 | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 1.13 | 10.2 | 895 | ok |
| window-minimized | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.03 | 0.3 | 891 | ok |

#### N = 10 (1 visible + 9 in background)
| Strategy | Page state | Timer fires/s (100 ms timer) | Game progress/s (wall clock) | rAF/s | Server sees: heartbeats / ws msgs per s | CPU per background renderer (%) | CPU, all processes (%) | RAM, all processes (MB) | Back to normal |
|---|---|---|---|---|---|---|---|---|---|
| visible | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 0.96 | 15.5 | 1418 | ok |
| hidden | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 4.4 | 1424 | ok |
| hidden+throttle | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 4.3 | 1435 | ok |
| hidden+nothrottle | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 0.97 | 14.9 | 1453 | ok |
| detach | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 4.0 | 1381 | ok |
| zero-bounds | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 4.0 | 1348 | ok |
| offscreen | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 4.2 | 1361 | ok |
| css-display-none | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 0.44 | 8.9 | 1402 | ok |
| cpu-throttle-10 | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 9.43 | 90.9 | 1410 | ok |
| hidden+frozen | unreachable | n/a | n/a | n/a | 0.0 / 0.0 | 0.00 | 4.0 | 1409 | ok |
| detach+frozen | unreachable | n/a | n/a | n/a | 0.0 / 0.0 | 0.00 | 4.0 | 1421 | ok |
| frame-rate-1 | visible | 10.0 | 1.00 | 144 | 1.0 / 1.0 | 0.84 | 13.7 | 1425 | ok |
| window-minimized | hidden | 1.0 | 1.00 | 0 | 1.0 / 1.0 | 0.02 | 0.4 | 1424 | ok |


### What the tables say
- 1, 2, 5 and 10 accounts give the same per-account picture: a background account costs ~0.02% CPU
  against ~1.2% visible. Total CPU with 9 hidden accounts is about the same as with none (≈4%, which is the
  one visible account plus GPU/browser), against 15.5% with all 10 visible.
- RAM does not move with any strategy: ~395→1424 MB for 1→10 accounts regardless of what is done.
- `hidden+frozen` / `detach+frozen`: the server saw no heartbeat or socket message while frozen, and the
  page could not be read. Recovery was fine after ≤10 s frozen; a long freeze was not tested.
- `cpu-throttle-10` raised total CPU to 91% at N=10: the emulation spends more than it saves.

## 5. Multiple accounts
See the N = 1, 2, 5, 10 tables above. "1 visible + the rest in background" is the realistic comparison;
`visible` in each table is all of them visible.

## 6. Real game
Cookie Clicker, a static public mirror (`ozh.github.io/cookieclicker`, no login), observed with
`executeJavaScript` only (nothing injected, no DevTools attached). `Game.T` is the game's own logic counter.

| Accounts | State | Page state | Game logic ticks/s | CPU per renderer (%) | CPU, all processes (%) | RAM, all processes (MB) | RAM per renderer (MB) |
|---|---|---|---|---|---|---|---|
| 1 | all visible | visible | 30.0 | 1.31 | 3.8 | 982 | 187 |
| 1 | background accounts hidden | hidden | 29.9 | 0.04 | 0.1 | 930 | 190 |
| 1 | shown again | visible | 30.1 | 1.34 | 3.9 | 936 | 183 |
| 5 | all visible | visible | 30.0 | 0.71 | 7.6 | 3059 | 186 |
| 5 | background accounts hidden | hidden | 29.9 | 0.03 | 3.6 | 2798 | 188 |
| 5 | shown again | visible | 30.1 | 0.69 | 7.8 | 2766 | 178 |

The game keeps its logic loop at 30/s while hidden (it catches up when its throttled timer fires), so no
progress was lost; CPU per renderer fell ~97%; going back to visible restored everything; memory did not
change. **The user's own game (OAuth sign-in) was not measured**: it needs credentials. `BENCH_URL`
points `bench/real-game.cjs` at any public page; a game behind a login needs a manual run.
Not measured: audio (Chromium exempts pages playing audio from throttling), games using workers.

## 7. Real application, without Playwright
`bench/real-app.cjs` drives the built app through raw DevTools protocol on the shell page only. The game
page has no client attached; it reports `visibilityState` and its counters to a local server.

| Phase | Page state | Timer fires/s | rAF/s |
|---|---|---|---|
| visible (Play) | visible | 10.0 | 143.9 |
| hidden (empty layout) | hidden | 1.0 | 0.0 |
| visible again | visible | 10.0 | 143.9 |
| hidden again | hidden | 1.0 | 0.0 |

## 8. Implementation
None. No source file under `src/` changed. Added: `bench/` (tooling and raw results), ADR-0019,
this report, corrections in ADR-0010, ADR-0017, the overview, the known limitations, the roadmap and the
README. `eslint.config.js` ignores `bench/**`.

## 9. Sessions
Unchanged by construction (no app code touched). In the benchmark each account had its own partition and
its own storage; after every strategy and recovery, each page's saved counter was present in its own
localStorage and IndexedDB. No cookies were copied, `defaultSession` was not used.
Cookie behaviour was not altered. The existing isolation E2E tests were not re-run (see Tests).

## 10. Security
Nothing relaxed: no setting, policy, IPC channel, preload or protocol was touched. The one strategy that
would have attached the DevTools debugger to game pages (frozen) was rejected.

## 11. Tests
```
Typecheck: passes (node, web and test projects)
Lint:      passes (bench/** is ignored)
Unit:      442 passed (13 files)
E2E:       not re-run. Nothing under src/ changed; the screen was locked for part of the session and
           the E2E suite needs a visible window. Last full result before this phase: 60 passed, 3 runs.
Benchmark: run.cjs 13 strategies x N=1,2,5,10 (N=10 partly repeated, see below); real-app.cjs; real-game.cjs.
```
The prompt quoted 395 unit / 54 E2E tests; the repository had 442 / 60.

## 12. Data validity and caveats
- The macOS screen locked during the first full run, at N=10, from `detach` onward: every page then reported
  `hidden` and those 9 rows are invalid (they are not used). The harness now refuses to measure unless every
  page is `visible` first. The 9 rows were re-measured with `--disable-backgrounding-occluded-windows`, which
  removes the "window is covered" path only; a check at N=2 gave the same hidden-view result with and without it.
  The real-app and real-game runs also used it. N=1, 2, 5 and the first four N=10 rows were taken with the
  screen unlocked.
- One run per cell, 8 s samples: differences of a few hundredths of a percent are noise. The fixture is light.
- GPU: the all-process CPU column includes the GPU process; separate GPU activity was not analysed.
- Network: only the fixture's heartbeat and WebSocket were observed, from the server side.

## 13. Débitos
- Per-game "keep running at full speed" (`setBackgroundThrottling(false)`), only if a real game needs it.
- Memory per account is the open cost; the only lever (destroying the WebContents) discards page state.
- Audio and worker-based games under throttling; the user's OAuth game; a long-freeze test if frozen is ever reconsidered.
- An E2E-visible guard for this behaviour is impossible with Playwright attached; `bench/real-app.cjs` is manual.

## 14. ADR
ADR-0019 created. ADR-0010 and ADR-0017 corrected.

## 15. Decisão
**NÃO IMPLEMENTAR** (conclusion C): no economy mode is added; the behaviour already exists.

## 16. Próximo passo (recomendação)
Measure memory per account on the user's real game(s) and decide whether a "stop accounts I am not using"
affordance is worth more than any throttling control. Run `bench/real-game.cjs` against that game
(manually signed in) before deciding about an `active` switch.
