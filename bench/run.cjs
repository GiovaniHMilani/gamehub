'use strict'
/**
 * Background-performance benchmark (Phase 7.5). Run with:
 *
 *   env -u ELECTRON_RUN_AS_NODE pnpm exec electron bench/run.cjs
 *
 * Environment: BENCH_N="1,2,5,10"  BENCH_SCENARIOS="visible,hidden,..."  BENCH_SAMPLE_S=8
 *              BENCH_OUT=bench/results/<name>.json  BENCH_URL=<real page> (see run-real.cjs)
 *
 * This is NOT part of the app and does not use SessionManager/InstanceManager: it creates plain
 * WebContentsViews with throwaway in-memory partitions so that each strategy can be applied and
 * undone in isolation. Pages are judged by what they DO (timer fires, rAF, saves, heartbeats,
 * websocket traffic seen by the server), never by CPU alone.
 */
const { app, BrowserWindow, WebContentsView } = require('electron')
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const env = (k, d) => process.env[k] ?? d
const NS = env('BENCH_N', '1,2,5,10').split(',').map(Number)
const SAMPLE_S = Number(env('BENCH_SAMPLE_S', '8'))
const WARM_S = 3
const OUT = env('BENCH_OUT', path.join(__dirname, 'results', 'controlled.json'))

// ---- the local site: page + heartbeat + a minimal websocket echo ----------------------------
const server = { port: 0, hb: new Map(), wsMsgs: new Map(), wsConns: new Map() }
const bump = (map, id) => map.set(id, (map.get(id) ?? 0) + 1)
function startSite() {
  const html = fs.readFileSync(path.join(__dirname, 'idle-game.html'))
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/hb') {
      bump(server.hb, url.searchParams.get('id'))
      res.writeHead(204).end()
    } else {
      res.writeHead(200, { 'content-type': 'text/html' }).end(html)
    }
  })
  srv.on('upgrade', (req, socket) => {
    const id = new URL(req.url, 'http://x').searchParams.get('id')
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    bump(server.wsConns, id)
    socket.on('data', (buf) => {
      const op = buf[0] & 0x0f
      if (op === 8) return socket.end()
      if (op === 1) {
        bump(server.wsMsgs, id)
        socket.write(Buffer.from([0x81, 4, 112, 111, 110, 103])) // "pong"
      }
    })
    socket.on('error', () => undefined)
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => ((server.port = srv.address().port), resolve(srv))))
}

// ---- strategies -----------------------------------------------------------------------------
const cdp = async (v, method, params) => v.contents.debugger.sendCommand(method, params)
const attach = (v) => {
  if (!v.contents.debugger.isAttached()) v.contents.debugger.attach('1.3')
}
const STRATEGIES = {
  visible: { desc: 'baseline: nothing changed', apply: async () => undefined, undo: async () => undefined },
  hidden: {
    desc: 'A. view.setVisible(false)',
    apply: async (v) => v.view.setVisible(false),
    undo: async (v) => v.view.setVisible(true),
  },
  'hidden+throttle': {
    desc: 'B. setVisible(false) + contents.setBackgroundThrottling(true)',
    apply: async (v) => (v.contents.setBackgroundThrottling(true), v.view.setVisible(false)),
    undo: async (v) => v.view.setVisible(true),
  },
  'hidden+nothrottle': {
    desc: 'B2. setVisible(false) + setBackgroundThrottling(false) (control)',
    apply: async (v) => (v.contents.setBackgroundThrottling(false), v.view.setVisible(false)),
    undo: async (v) => (v.contents.setBackgroundThrottling(true), v.view.setVisible(true)),
  },
  detach: {
    desc: 'C. removeChildView (detached from the window)',
    apply: async (v, ctx) => ctx.win.contentView.removeChildView(v.view),
    undo: async (v, ctx) => (ctx.win.contentView.addChildView(v.view), v.view.setBounds(v.bounds), v.view.setVisible(true)),
  },
  'zero-bounds': {
    desc: 'D1. bounds 0x0',
    apply: async (v) => v.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }),
    undo: async (v) => v.view.setBounds(v.bounds),
  },
  offscreen: {
    desc: 'D2. bounds moved far outside the window',
    apply: async (v) => v.view.setBounds({ ...v.bounds, x: -20000 }),
    undo: async (v) => v.view.setBounds(v.bounds),
  },
  'css-display-none': {
    desc: 'D3. document display:none inside the page (comparison only)',
    apply: async (v) => v.contents.executeJavaScript("document.documentElement.style.display='none'"),
    undo: async (v) => v.contents.executeJavaScript("document.documentElement.style.display=''"),
  },
  'cpu-throttle-10': {
    desc: 'E1. CDP Emulation.setCPUThrottlingRate 10 (page keeps running, slower)',
    apply: async (v) => (attach(v), cdp(v, 'Emulation.setCPUThrottlingRate', { rate: 10 })),
    undo: async (v) => (await cdp(v, 'Emulation.setCPUThrottlingRate', { rate: 1 }), v.contents.debugger.detach()),
  },
  'hidden+frozen': {
    desc: 'E2. hidden + CDP Page.setWebLifecycleState frozen',
    apply: async (v) => (v.view.setVisible(false), attach(v), cdp(v, 'Page.setWebLifecycleState', { state: 'frozen' })),
    undo: async (v) => (await cdp(v, 'Page.setWebLifecycleState', { state: 'active' }), v.contents.debugger.detach(), v.view.setVisible(true)),
  },
  'detach+frozen': {
    desc: 'E3. detached + CDP frozen',
    apply: async (v, ctx) => (ctx.win.contentView.removeChildView(v.view), attach(v), cdp(v, 'Page.setWebLifecycleState', { state: 'frozen' })),
    undo: async (v, ctx) => {
      await cdp(v, 'Page.setWebLifecycleState', { state: 'active' })
      v.contents.debugger.detach()
      ctx.win.contentView.addChildView(v.view)
      v.view.setBounds(v.bounds)
      v.view.setVisible(true)
    },
  },
  'frame-rate-1': {
    desc: 'E4. contents.setFrameRate(1)',
    apply: async (v) => v.contents.setFrameRate(1),
    undo: async (v) => v.contents.setFrameRate(60),
  },
  'window-minimized': {
    desc: 'F. whole window minimised (all views; what the OS-level case does)',
    scope: 'window',
    apply: async (_v, ctx) => ctx.win.minimize(),
    undo: async (_v, ctx) => ctx.win.restore(),
  },
}

// ---- measurement ----------------------------------------------------------------------------
const probe = (v) =>
  Promise.race([v.contents.executeJavaScript('window.__bench(true)'), sleep(1500).then(() => null)]).catch(() => null)

function grid(n, w, h) {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const tw = Math.floor(w / cols)
  const th = Math.floor(h / rows)
  return Array.from({ length: n }, (_, i) => ({ x: (i % cols) * tw, y: Math.floor(i / cols) * th, width: tw, height: th }))
}

function metricsSnapshot(views) {
  const byPid = new Map(views.map((v) => [v.pid, v]))
  const out = { total: 0, browser: 0, gpu: 0, other: 0, renderers: new Map(), mem: { total: 0, renderers: new Map() } }
  for (const m of app.getAppMetrics()) {
    const cpu = m.cpu.percentCPUUsage
    const mem = m.memory.workingSetSize / 1024 // MB
    out.total += cpu
    out.mem.total += mem
    if (m.type === 'Browser') out.browser += cpu
    else if (m.type === 'GPU') out.gpu += cpu
    else if (byPid.has(m.pid)) {
      out.renderers.set(m.pid, cpu)
      out.mem.renderers.set(m.pid, mem)
    } else out.other += cpu
  }
  return out
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function snapshotServer() {
  const hb = {}
  const ws = {}
  for (const [k, v] of server.hb) hb[k] = v
  for (const [k, v] of server.wsMsgs) ws[k] = v
  return { hb: zero(hb), ws: zero(ws) }
}
// ids not seen yet read as 0
const zero = (o) => new Proxy(o, { get: (t, k) => t[k] ?? 0 })

let runCounter = 0
async function runScenario(n, name) {
  const strategy = STRATEGIES[name]
  const step = (m) => process.env.BENCH_DEBUG && console.log('   .', m)
  const win = new BrowserWindow({ width: 1200, height: 800, show: true, webPreferences: { backgroundThrottling: true } })
  win.focus()
  await sleep(300)
  const [cw, ch] = win.getContentSize()
  const bounds = grid(n, cw, ch)
  const runId = ++runCounter
  const views = []
  for (let i = 0; i < n; i++) {
    const partition = `bench-${runId}-${i}` // in-memory, one per view, never shared
    const view = new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true } })
    win.contentView.addChildView(view)
    view.setBounds(bounds[i])
    views.push({ id: `r${runId}v${i}`, view, contents: view.webContents, bounds: bounds[i] })
  }
  step('views created')
  await Promise.all(views.map((v) => v.contents.loadURL(`http://127.0.0.1:${server.port}/?id=${v.id}`)))
  step('loaded')
  views.forEach((v) => (v.pid = v.contents.getOSProcessId()))
  await sleep(WARM_S * 1000)

  const bgIdx = n === 1 ? [0] : Array.from({ length: n - 1 }, (_, i) => i + 1)
  const fgIdx = n === 1 ? [] : [0]
  const targets = strategy.scope === 'window' ? views : bgIdx.map((i) => views[i])
  const ctx = { win }
  const record = { n, scenario: name, desc: strategy.desc, uniquePids: new Set(views.map((v) => v.pid)).size }

  try {
    // Precondition: the window must really be on screen. If the OS occluded it (screen asleep,
    // another window on top) every page reports "hidden" and the whole scenario means nothing.
    const pre = await Promise.all(views.map(probe))
    if (!pre.every((p) => p && p.visibility === 'visible')) {
      record.invalid = 'window not visible before applying the strategy: ' + pre.map((p) => p && p.visibility).join(',')
      throw new Error(record.invalid)
    }
    await strategy.apply(targets[0], ctx) // window scope uses only ctx
    if (strategy.scope !== 'window') for (const t of targets.slice(1)) await strategy.apply(t, ctx)
    step('applied')
    await sleep(2000)
    const during = await sample(views, SAMPLE_S)
    record.fg = fgIdx.map((i) => during.per[i])
    record.bg = bgIdx.map((i) => during.per[i])
    record.system = { cpuTotal: during.cpuTotal, cpuBrowser: during.cpuBrowser, cpuGpu: during.cpuGpu, memTotalMB: during.memTotalMB }

    step('sampled')
    // Recovery: undo and verify that every view is back to normal.
    for (const t of targets) await strategy.undo(t, ctx)
    await sleep(2500)
    const after = await sample(views, 4)
    record.recovered = after.per.map((p, i) => ({
      id: p.id,
      reachable: p.reachable,
      visibility: p.visibility,
      tickRate: p.tickRate,
      rafRate: p.rafRate,
      idbWriteRate: p.idbWriteRate,
      serverWsRate: p.serverWsRate,
      wsState: p.wsState,
      boundsOk: JSON.stringify(views[i].view.getBounds()) === JSON.stringify(views[i].bounds),
    }))
    // Persistence check: the saved counter must exist and be no larger than the live one.
    record.persistence = await Promise.all(
      views.map((v) =>
        v.contents
          .executeJavaScript(
            `new Promise((res)=>{const r=indexedDB.open('bench');r.onsuccess=()=>{const g=r.result.transaction('kv').objectStore('kv').get('ticks');g.onsuccess=()=>res({idb:g.result,ls:Number(localStorage.getItem('ticks')),live:window.__bench(false).ticks})}})`,
          )
          .catch((e) => ({ error: String(e) })),
      ),
    )
  } catch (error) {
    record.error = String(error && error.stack ? error.stack : error)
  }

  for (const v of views) {
    try {
      if (v.contents.debugger.isAttached()) v.contents.debugger.detach()
      win.contentView.removeChildView(v.view)
      v.contents.close()
    } catch {
      /* already gone */
    }
  }
  win.destroy()
  await sleep(1200)
  return record
}

async function sample(views, seconds) {
  const startServer = snapshotServer()
  const probesStart = await Promise.all(views.map(probe))
  const t0 = Date.now()
  const cpuSamples = []
  metricsSnapshot(views)
  for (let i = 0; i < seconds; i++) {
    await sleep(1000)
    cpuSamples.push(metricsSnapshot(views))
  }
  const elapsed = (Date.now() - t0) / 1000
  const probesEnd = await Promise.all(views.map(probe))
  const endServer = snapshotServer()
  const per = views.map((v, i) => {
    const a = probesStart[i]
    const b = probesEnd[i]
    const rate = (k) => (a && b ? (b[k] - a[k]) / elapsed : null)
    return {
      id: v.id,
      reachable: Boolean(a && b),
      visibility: b ? b.visibility : null,
      tickRate: rate('ticks'),
      progressPerS: rate('progress'),
      rafRate: rate('raf'),
      idbWriteRate: rate('idbWrites'),
      maxGapMs: b ? Math.round(b.maxGap) : null,
      wsState: b ? b.wsState : null,
      wsReconnects: a && b ? b.wsOpen - a.wsOpen : null,
      serverHbRate: (endServer.hb[v.id] - startServer.hb[v.id]) / elapsed,
      serverWsRate: (endServer.ws[v.id] - startServer.ws[v.id]) / elapsed,
      cpu: avg(cpuSamples.map((s) => s.renderers.get(v.pid) ?? 0)),
      memMB: avg(cpuSamples.map((s) => s.mem.renderers.get(v.pid) ?? 0)),
      pid: v.pid,
    }
  })
  return {
    elapsed,
    per,
    cpuTotal: avg(cpuSamples.map((s) => s.total)),
    cpuBrowser: avg(cpuSamples.map((s) => s.browser)),
    cpuGpu: avg(cpuSamples.map((s) => s.gpu)),
    memTotalMB: avg(cpuSamples.map((s) => s.mem.total)),
  }
}

module.exports = { STRATEGIES, grid, metricsSnapshot, avg, sleep, probe }

if (!process.env.BENCH_IMPORT) {
  if (process.env.BENCH_IGNORE_OS_OCCLUSION) {
    // Used only when the screen is locked/asleep: removes the "window is covered" path so that
    // view-level hiding can still be compared. Results are labelled in the report.
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
    app.commandLine.appendSwitch('disable-renderer-backgrounding')
  }
  app.on('window-all-closed', () => undefined) // each scenario closes its window; quit only at the end
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'gamehub-bench-')))
  app.whenReady().then(async () => {
    const srv = await startSite()
    const names = env('BENCH_SCENARIOS', Object.keys(STRATEGIES).join(',')).split(',')
    const results = {
      meta: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        platform: `${process.platform} ${process.arch}`,
        cpus: os.cpus().length,
        sampleSeconds: SAMPLE_S,
        ignoreOsOcclusion: Boolean(process.env.BENCH_IGNORE_OS_OCCLUSION),
        date: new Date().toISOString(),
      },
      runs: [],
    }
    for (const n of NS) {
      for (const name of names) {
        process.stdout.write(`N=${n} ${name} ... `)
        let r = await runScenario(n, name)
        for (let attempt = 0; r.invalid && attempt < 3; attempt++) {
          process.stdout.write('(window not visible, retrying) ')
          await sleep(5000)
          r = await runScenario(n, name)
        }
        results.runs.push(r)
        fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
        process.stdout.write(r.error ? `ERROR ${r.error.split('\n')[0]}\n` : `cpu=${r.system.cpuTotal.toFixed(0)}% mem=${r.system.memTotalMB.toFixed(0)}MB\n`)
      }
    }
    srv.close()
    app.quit()
  })
}
