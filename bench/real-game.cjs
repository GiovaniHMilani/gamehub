'use strict'
/**
 * A real idle game (Cookie Clicker static mirror, no login) under hide/show. Observation only:
 * executeJavaScript, no CDP, nothing injected into the page. `Game.T` is the game's own logic-loop
 * counter, so "does the game keep running?" is answered by the game itself.
 *   env -u ELECTRON_RUN_AS_NODE pnpm exec electron bench/real-game.cjs
 */
process.env.BENCH_IMPORT = '1'
const { app, BrowserWindow, WebContentsView } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { grid, metricsSnapshot, avg, sleep } = require('./run.cjs')

const URL_ = process.env.BENCH_URL ?? 'https://ozh.github.io/cookieclicker/'
const NS = (process.env.BENCH_N ?? '1,5').split(',').map(Number)
const OUT = path.join(__dirname, 'results', 'real-game.json')
// Always ignore OS occlusion: the screen may be locked; view-level hiding is what is being tested.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'gamehub-realgame-')))
app.on('window-all-closed', () => undefined)

const read = (v) =>
  Promise.race([
    v.contents.executeJavaScript(
      `({vis: document.visibilityState, T: typeof Game==='object' ? Game.T : null, ready: typeof Game==='object' && !!Game.ready, cookies: typeof Game==='object' ? Game.cookiesEarned : null, now: performance.now()})`,
    ),
    sleep(2000).then(() => null),
  ]).catch(() => null)

async function window_(views, seconds) {
  const a = await Promise.all(views.map(read))
  const cpu = []
  metricsSnapshot(views)
  for (let i = 0; i < seconds; i++) {
    await sleep(1000)
    cpu.push(metricsSnapshot(views))
  }
  const b = await Promise.all(views.map(read))
  return {
    vis: [...new Set(b.map((x) => x && x.vis))],
    logicTicksPerS: avg(views.map((_, i) => (a[i] && b[i] && a[i].T != null ? (b[i].T - a[i].T) / ((b[i].now - a[i].now) / 1000) : null)).filter((x) => x != null)),
    cpuPerRenderer: avg(cpu.map((s) => avg(views.map((v) => s.renderers.get(v.pid) ?? 0)))),
    cpuTotal: avg(cpu.map((s) => s.total)),
    gpu: avg(cpu.map((s) => s.gpu)),
    memTotalMB: avg(cpu.map((s) => s.mem.total)),
    memPerRendererMB: avg(cpu.map((s) => avg(views.map((v) => s.mem.renderers.get(v.pid) ?? 0)))),
  }
}

app.whenReady().then(async () => {
  const results = { url: URL_, electron: process.versions.electron, date: new Date().toISOString(), runs: [] }
  for (const n of NS) {
    const win = new BrowserWindow({ width: 1200, height: 800, show: true })
    await sleep(300)
    const [cw, ch] = win.getContentSize()
    const b = grid(n, cw, ch)
    const views = []
    for (let i = 0; i < n; i++) {
      const view = new WebContentsView({ webPreferences: { partition: `realgame-${n}-${i}`, sandbox: true, contextIsolation: true } })
      win.contentView.addChildView(view)
      view.setBounds(b[i])
      views.push({ view, contents: view.webContents, bounds: b[i] })
    }
    await Promise.all(views.map((v) => v.contents.loadURL(URL_).catch((e) => console.log('load error', String(e)))))
    views.forEach((v) => (v.pid = v.contents.getOSProcessId()))
    // wait for the game's own ready flag (it asks for a language first, which stays idle: Game exists)
    for (let i = 0; i < 60; i++) {
      const s = await Promise.all(views.map(read))
      if (s.every((x) => x && x.T != null)) break
      await sleep(1000)
    }
    await sleep(5000)
    const run = { n, ready: (await Promise.all(views.map(read))).map((x) => !!(x && x.T != null)) }
    run.visible = await window_(views, 10)
    const bg = n === 1 ? views : views.slice(1)
    bg.forEach((v) => v.view.setVisible(false))
    await sleep(2000)
    run.hidden = await window_(bg, 10)
    run.hiddenSystem = { cpuTotal: run.hidden.cpuTotal, memTotalMB: run.hidden.memTotalMB }
    bg.forEach((v) => v.view.setVisible(true))
    await sleep(2500)
    run.recovered = await window_(views, 5)
    results.runs.push(run)
    console.log(JSON.stringify({ n, ready: run.ready, visible: run.visible, hidden: run.hidden, recovered: run.recovered }))
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
    for (const v of views) {
      win.contentView.removeChildView(v.view)
      v.contents.close()
    }
    win.destroy()
    await sleep(1500)
  }
  app.quit()
})
