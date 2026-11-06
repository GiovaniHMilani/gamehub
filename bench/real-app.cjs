'use strict'
/**
 * Verifies, in the REAL GameHub app, what a hidden account does -- without Playwright.
 *
 * Playwright attaches CDP to every page (game views included) and applies focus/visibility
 * emulation, which can change what a page reports. Here only the SHELL page is controlled (raw CDP),
 * the game page has no client attached; what the game does is observed from the SERVER: the page
 * reports visibilityState and its tick/frame counters in a heartbeat once a second.
 *
 *   node bench/real-app.cjs            (needs `pnpm exec electron-vite build` first)
 *
 * Phases: visible (Play) -> hidden (Library) -> visible -> hidden. Output: rates per phase.
 */
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PHASE_S = Number(process.env.PHASE_S ?? 8)
const root = path.resolve(__dirname, '..')
const series = [] // {t(server ms), vis, ticks, raf, pageT}

const html = fs.readFileSync(path.join(__dirname, 'idle-game.html'))
const site = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/hb') {
    series.push({
      at: Date.now(),
      vis: url.searchParams.get('vis'),
      ticks: Number(url.searchParams.get('ticks')),
      raf: Number(url.searchParams.get('raf')),
      pageT: Number(url.searchParams.get('t')),
    })
    res.writeHead(204).end()
  } else res.writeHead(200, { 'content-type': 'text/html' }).end(html)
})

async function cdpShell(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const shell = list.find((t) => t.type === 'page' && t.url.startsWith('app://gamehub'))
      if (shell) return shell.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(200)
  }
  throw new Error('shell target not found')
}

async function main() {
  await new Promise((r) => site.listen(0, '127.0.0.1', r))
  const gameUrl = `http://127.0.0.1:${site.address().port}/?id=real`
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gamehub-real-'))
  const env = { ...process.env, GAMEHUB_USER_DATA_DIR: userData }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const electronBin = require(path.join(root, 'node_modules/electron'))
  const child = spawn(electronBin, [path.join(root, 'out/main/index.js'), '--remote-debugging-port=9339', ...(process.env.BENCH_IGNORE_OS_OCCLUSION ? ['--disable-backgrounding-occluded-windows'] : [])], { env, stdio: 'ignore' })
  try {
    const ws = new WebSocket(await cdpShell(9339))
    await new Promise((r) => ws.addEventListener('open', r))
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', (m) => {
      const d = JSON.parse(m.data)
      if (d.id && pending.has(d.id)) pending.get(d.id)(d)
    })
    const evalShell = (expression) =>
      new Promise((resolve, reject) => {
        const n = ++id
        pending.set(n, (d) => (d.result?.exceptionDetails ? reject(new Error(JSON.stringify(d.result.exceptionDetails))) : resolve(d.result?.result?.value)))
        ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      })

    for (let i = 0; i < 100 && (await evalShell("typeof window.gamehub === 'object'")) !== true; i++) await sleep(200)
    const game = await evalShell(`window.gamehub.games.create({ name: 'Idle', startUrl: ${JSON.stringify(gameUrl)} })`)
    if (!game.ok) throw new Error('games.create failed: ' + JSON.stringify(game))
    const gameId = game.data.id
    const inst = await evalShell(`window.gamehub.instances.create({ gameId: ${JSON.stringify(gameId)}, label: 'A' })`)
    if (!inst.ok) throw new Error('instances.create failed: ' + JSON.stringify(inst))
    const instId = inst.data.id
    const started = await evalShell(`window.gamehub.instances.start(${JSON.stringify(instId)})`)
    if (!started.ok) throw new Error('start failed: ' + JSON.stringify(started))
    await sleep(3000)

    const show = () => evalShell(`window.gamehub.stage.setLayout([{ instanceId: ${JSON.stringify(instId)}, x: 200, y: 80, width: 600, height: 400 }])`)
    const hide = () => evalShell(`window.gamehub.stage.setLayout([])`)
    const phases = []
    for (const [name, apply] of [['visible', show], ['hidden', hide], ['visible again', show], ['hidden again', hide]]) {
      await apply()
      await sleep(2500) // settle
      const from = series.length
      await sleep(PHASE_S * 1000)
      phases.push({ name, points: series.slice(from) })
    }
    for (const p of phases) {
      const pts = p.points
      if (pts.length < 2) {
        console.log(p.name.padEnd(14), 'heartbeats:', pts.length, pts.map((x) => x.vis))
        continue
      }
      const a = pts[0]
      const b = pts[pts.length - 1]
      const sec = (b.pageT - a.pageT) / 1000
      console.log(
        p.name.padEnd(14),
        `vis=${[...new Set(pts.map((x) => x.vis))].join('/')}`,
        `ticks/s=${((b.ticks - a.ticks) / sec).toFixed(1)}`,
        `raf/s=${((b.raf - a.raf) / sec).toFixed(1)}`,
        `heartbeats=${pts.length}`,
      )
    }
    ws.close()
  } finally {
    child.kill('SIGTERM')
    await sleep(800)
    site.close()
    fs.rmSync(userData, { recursive: true, force: true })
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
