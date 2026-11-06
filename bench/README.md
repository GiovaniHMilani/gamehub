# bench/

Throwaway measurement tooling for Phase 7.5 (background cost of running accounts). Not part of the
app, not linted, not shipped. Results and conclusions: `docs/development/reports/2026-11-06-background-performance.md`,
ADR-0019.

| File | What it does |
|---|---|
| `idle-game.html` | The fixture: 100 ms tick, `requestAnimationFrame` canvas, 1 s save to localStorage + IndexedDB, 1 s `fetch` heartbeat, WebSocket ping, reconnect on drop. Everything is counted. |
| `run.cjs` | Controlled benchmark. N accounts (own in-memory partition each), a strategy applied to the background ones, sampled, undone, sampled again. `BENCH_N`, `BENCH_SCENARIOS`, `BENCH_SAMPLE_S`, `BENCH_OUT`. Refuses to measure if the window is not really visible. |
| `real-app.cjs` | Drives the REAL built app with raw DevTools protocol on the SHELL only; the game page reports its own state to a local server. Needs `pnpm exec electron-vite build`. |
| `real-game.cjs` | A real public idle game, observed with `executeJavaScript` only (`BENCH_URL` to change it). |
| `table.py`, `summarize.py`, `report-tables.py` | Turn `results/*.json` into tables. |

```bash
env -u ELECTRON_RUN_AS_NODE pnpm exec electron bench/run.cjs
env -u ELECTRON_RUN_AS_NODE pnpm exec electron bench/real-game.cjs
pnpm exec electron-vite build && node bench/real-app.cjs
```

Keep the screen unlocked and awake: a locked screen makes macOS report every window as occluded and
every page as hidden. `BENCH_IGNORE_OS_OCCLUSION=1` passes `--disable-backgrounding-occluded-windows`
to get around that when comparing view-level strategies; label such data.

Do not measure page visibility or timers with Playwright: it attaches to every page and changes them
(this is how Phase 7 got a wrong answer).
