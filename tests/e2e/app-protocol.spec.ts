import { expect, test } from '@playwright/test'
import { startSessionTestSite } from '../fixtures/session-test-site/server'
import { Driver } from './helpers/driver'
import { removeUserData } from './helpers/launch'

test('the shell is served from app://gamehub, never from file://', async () => {
  const driver = await Driver.launch()
  try {
    expect(driver.shell.url()).toBe('app://gamehub/index.html')

    // Static assets load through the protocol (the bundle is the one the page executed).
    const scripts = await driver.shell.evaluate(() => [...document.scripts].map((script) => script.src))
    expect(scripts.length).toBeGreaterThan(0)
    for (const src of scripts) expect(src).toMatch(/^app:\/\/gamehub\/assets\/.+\.js$/)
    await expect(driver.shell.getByTestId('app-title')).toHaveText('GameHub') // React rendered from that bundle

    // The origin really is app://gamehub, so the CSP 'self' applies to it.
    expect(await driver.shell.evaluate(() => location.origin)).toBe('app://gamehub')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('app:// refuses traversal, foreign hosts and anything outside the shell build', async () => {
  const driver = await Driver.launch()
  try {
    const probe = (path: string): Promise<{ status: number; body: string }> =>
      driver.shell.evaluate(async (p) => {
        const response = await fetch(p)
        return { status: response.status, body: (await response.text()).slice(0, 200) }
      }, path)

    // Sanity: the real asset is reachable.
    expect((await probe('app://gamehub/index.html')).status).toBe(200)

    const refused = [
      'app://gamehub/..%2fpackage.json',
      'app://gamehub/..%2f..%2fpackage.json',
      'app://gamehub/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json',
      'app://gamehub/..%5cpackage.json',
      'app://gamehub/%252e%252e%252fpackage.json',
      'app://gamehub/assets/..%2f..%2f..%2fpackage.json',
      'app://gamehub/%00',
      'app://gamehub/.env',
      'app://gamehub/package.json', // exists next to out/, but outside the served root
      'app://gamehub/assets/', // directory without index.html
      'app://gamehub/index.html.map',
    ]
    for (const url of refused) {
      const result = await probe(url)
      expect(result.status, url).toBe(404)
      expect(result.body, url).not.toContain('"name": "gamehub"') // never the repo's package.json
    }

    // A foreign host cannot even be fetched by the page (cross-origin, no CORS)...
    const foreign = await driver.shell.evaluate(() => fetch('app://evil/index.html').then(() => 'ok', () => 'blocked'))
    expect(foreign).toBe('blocked')
    // ...and asked directly, the handler itself answers 404 for any host but gamehub.
    const direct = await driver.app.evaluate(async ({ session }) =>
      Promise.all(['app://evil/index.html', 'app://gamehub.evil.com/index.html'].map(async (u) => (await session.defaultSession.fetch(u)).status)),
    )
    expect(direct).toEqual([404, 404])
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('remote game pages cannot load shell assets through app://', async () => {
  const site = await startSessionTestSite()
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.url, [])

    // no-cors fetch: resolves (opaque) only if some handler in THAT session answers.
    const reachable = await page.evaluate(() =>
      fetch('app://gamehub/index.html', { mode: 'no-cors' }).then(
        (r) => `reachable:${r.type}`,
        () => 'unreachable',
      ),
    )
    expect(reachable).toBe('unreachable')

    // And at the Electron level: the handler exists on the shell's session only.
    const handled = await driver.app.evaluate(async ({ webContents, session }, url) => {
      const game = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url))
      return {
        defaultSession: await session.defaultSession.protocol.isProtocolHandled('app'),
        gameSession: game === undefined ? null : await game.session.protocol.isProtocolHandled('app'),
      }
    }, site.url)
    expect(handled).toEqual({ defaultSession: true, gameSession: false })
  } finally {
    await driver.close()
    await site.close()
    await removeUserData(driver.userDataDir)
  }
})
