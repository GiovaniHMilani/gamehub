import { expect, test } from '@playwright/test'
import { startSessionTestSite, type SessionTestSite } from '../fixtures/session-test-site/server'
import { Driver } from './helpers/driver'
import { removeUserData } from './helpers/launch'

let site: SessionTestSite
test.beforeEach(async () => {
  site = await startSessionTestSite()
})
test.afterEach(async () => {
  await site.close()
})

test('remote game content has no bridge, no Node and no privileged globals', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.url, [])

    const exposure = await page.evaluate(() => {
      const g = globalThis as unknown as Record<string, unknown>
      return { gamehub: typeof g['gamehub'], require: typeof g['require'], process: typeof g['process'], electron: typeof g['electron'], ipcRenderer: typeof g['ipcRenderer'] }
    })
    expect(exposure).toEqual({ gamehub: 'undefined', require: 'undefined', process: 'undefined', electron: 'undefined', ipcRenderer: 'undefined' })
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('the shell exposes exactly the typed API and nothing raw', async () => {
  const driver = await Driver.launch()
  try {
    const shape = await driver.shell.evaluate(() => {
      const api = window.gamehub as unknown as Record<string, Record<string, unknown>>
      const g = globalThis as unknown as Record<string, unknown>
      return {
        top: Object.keys(api).sort(),
        games: Object.keys(api['games'] ?? {}).sort(),
        instances: Object.keys(api['instances'] ?? {}).sort(),
        notices: Object.keys(api['notices'] ?? {}).sort(),
        raw: [typeof g['ipcRenderer'], typeof g['electron'], typeof g['require'], typeof g['process']],
      }
    })
    expect(shape).toEqual({
      top: ['games', 'instances', 'notices'],
      games: ['create', 'list', 'setAllowedOrigins'],
      instances: ['create', 'get', 'list', 'onChanged', 'remove', 'restart', 'snapshot', 'start', 'stop'],
      notices: ['list', 'onChanged', 'resolve'],
      raw: ['undefined', 'undefined', 'undefined', 'undefined'],
    })
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('Main rejects invalid IPC arguments with deterministic errors', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const unknownId = '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b'

    const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>): Promise<string> => {
      const r = await p
      return r.ok ? 'OK' : (r.error?.code ?? '?')
    }
    expect(await code(driver.raw.start('../../etc/passwd'))).toBe('INVALID_ARGUMENT')
    expect(await code(driver.raw.start({ instanceId: unknownId }))).toBe('INVALID_ARGUMENT') // wrong shape
    expect(await code(driver.raw.start(unknownId))).toBe('NOT_FOUND')
    expect(await code(driver.raw.create({ gameId: game.id, label: 'x', partition: 'persist:evil' }))).toBe('INVALID_ARGUMENT')
    expect(await code(driver.raw.create({ gameId: 'nope', label: 'x' }))).toBe('INVALID_ARGUMENT')
    expect(await code(driver.raw.create({ gameId: unknownId, label: 'x' }))).toBe('NOT_FOUND')

    const badGames = await driver.shell.evaluate(async () => {
      const create = window.gamehub.games.create as (x: unknown) => Promise<{ ok: boolean; error?: { code: string } }>
      return Promise.all(
        ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.com/', 'https://user:pw@example.com/'].map((startUrl) =>
          create({ name: 'x', startUrl }),
        ),
      )
    })
    expect(badGames.map((r) => r.error?.code)).toEqual(['INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'INVALID_ARGUMENT'])
    expect(await driver.list()).toHaveLength(0) // nothing was created by the rejected calls
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('game pages cannot leave their origin, open windows, or obtain permissions', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.url, [])
    const windowsBefore = driver.app.windows().length

    // Cross-origin top-level navigation (different host name = different origin).
    const foreign = site.url.replace('127.0.0.1', 'localhost')
    void page.evaluate((url) => { location.href = url }, foreign).catch(() => undefined)
    await expect.poll(async () => (await driver.logEvents()).includes('navigation.blocked')).toBe(true)
    expect(page.url()).toBe(site.url)

    // window.open to an origin outside the game's allowlist is denied: no window is created.
    // (A popup to the game's own origin is allowed by the explicit popup policy, ADR-0007.)
    const opened = await page.evaluate(() => window.open('https://evil.example/', '_blank'))
    expect(opened).toBeNull()
    await expect.poll(async () => (await driver.logEvents()).includes('popup.denied')).toBe(true)
    expect(driver.app.windows().length).toBe(windowsBefore)

    // Permissions are denied by default.
    const geolocation = await page.evaluate(
      () => new Promise<number | string>((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('granted'), (e) => resolve(e.code))),
    )
    expect(geolocation).toBe(1) // PERMISSION_DENIED
    expect(await page.evaluate(() => Notification.requestPermission())).not.toBe('granted')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('the shell cannot be navigated away by script', async () => {
  const driver = await Driver.launch()
  try {
    const before = driver.shell.url()
    void driver.shell.evaluate(() => { location.href = 'https://example.invalid/' }).catch(() => undefined)
    await expect.poll(async () => (await driver.logEvents()).includes('navigation.shell_blocked')).toBe(true)
    expect(driver.shell.url()).toBe(before)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})
