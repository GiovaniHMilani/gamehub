import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startOAuthTestSite, type OAuthTestSite } from '../fixtures/oauth-test-site/server'
import { Driver, waitReady } from './helpers/driver'
import { removeUserData } from './helpers/launch'
import { tryOpen } from './helpers/oauth'

let site: OAuthTestSite
test.beforeEach(async () => {
  site = await startOAuthTestSite()
})
test.afterEach(async () => {
  await site.close()
})

const goTo = (page: Page, url: string): void => {
  void page.evaluate((u) => { location.href = u }, url).catch(() => undefined)
}

test('blocked redirect -> notice -> Allow -> the navigation is redone, for every account of the game', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gamehub-notice-'))
  try {
    const driver = await Driver.launch(userData)
    const { shell } = driver
    const game = await driver.createGame('OAuth Game', site.gameUrl) // no extra origins
    const a = await driver.createInstance(game.id, 'A')
    const b = await driver.createInstance(game.id, 'B')
    const pageA = await driver.startAndGetPage(a.id, site.gameUrl, [])
    const pageB = await driver.startAndGetPage(b.id, site.gameUrl, [pageA])

    // The game tries to go to its provider: blocked, and the user is asked.
    goTo(pageA, site.authorizeUrl())
    const notice = shell.getByTestId('notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('“A”')
    await expect(notice).toContainText('OAuth Game')
    await expect(shell.getByTestId('notice-origin')).toHaveText(site.providerOrigin)
    expect(pageA.url().startsWith(site.gameUrl)).toBe(true) // still on the game

    // What the shell shows is the origin only: no path, no OAuth parameters.
    const shellHtml = await shell.content()
    expect(shellHtml).not.toMatch(/client_id|response_type|redirect_uri|state=xyz|\/authorize/)

    // One click: allowed, and the refused navigation is redone by itself.
    await notice.getByRole('button', { name: 'Allow' }).click()
    await expect.poll(() => pageA.url().startsWith(site.providerUrl)).toBe(true)
    await expect(notice).toHaveCount(0)
    await expect(shell.getByRole('status')).toContainText(`Allowed ${site.providerOrigin} for OAuth Game and retried`)
    expect(await driver.logEvents()).toEqual(expect.arrayContaining(['notice.requested', 'notice.allowed', 'view.allowed_origins_updated']))

    // The other account of the same game needs no question any more.
    goTo(pageB, site.authorizeUrl())
    await expect.poll(() => pageB.url().startsWith(site.providerUrl)).toBe(true)
    await expect(notice).toHaveCount(0)

    // The log never carries the destination's path or parameters.
    const log = await driver.readLog()
    expect(log).not.toMatch(/client_id|state=xyz|response_type/)
    await driver.close()

    // The decision is kept: after a restart the origin is still allowed.
    const again = await Driver.launch(userData)
    try {
      await again.waitForStatuses({ A: 'running', B: 'running' })
      // The decision is visible where origins are reviewed: the game's "Allowed sites" dialog.
      await again.shell.getByTestId('game-OAuth Game').getByRole('button', { name: /Allowed sites/ }).click()
      await expect(again.shell.getByRole('dialog').getByTestId(`origin-${site.providerOrigin}`)).toBeVisible()
      await again.shell.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
      const page = again.gamePages(site.gameUrl)[0] as Page
      await waitReady(page)
      goTo(page, site.authorizeUrl())
      await expect.poll(() => page.url().startsWith(site.providerUrl)).toBe(true)
      await expect(again.shell.getByTestId('notice')).toHaveCount(0)
    } finally {
      await again.close()
    }
  } finally {
    await removeUserData(userData)
  }
})

test('Dismiss saves nothing, redoes nothing, and does not nag', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('OAuth Game', site.gameUrl)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])

    goTo(page, site.authorizeUrl())
    await shell.getByTestId('notice').getByRole('button', { name: 'Dismiss' }).click()
    await expect(shell.getByTestId('notice')).toHaveCount(0)

    const games = await shell.evaluate(() => window.gamehub.games.list())
    expect(games).toMatchObject({ ok: true, data: [{ allowedOrigins: [] }] })
    expect(page.url().startsWith(site.gameUrl)).toBe(true)

    // Trying again is blocked again, silently: the user already said no.
    const blockedBefore = (await driver.logRecords()).filter((r) => r['event'] === 'navigation.blocked').length
    goTo(page, site.authorizeUrl())
    await expect.poll(async () => (await driver.logRecords()).filter((r) => r['event'] === 'navigation.blocked').length).toBe(blockedBefore + 1)
    await expect(shell.getByTestId('notice')).toHaveCount(0)
    expect(await driver.logEvents()).toContain('notice.suppressed')
    expect(page.url().startsWith(site.gameUrl)).toBe(true)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a blocked popup asks too; Allow lets the NEXT attempt open', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('OAuth Game', site.gameUrl)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])

    expect(await tryOpen(page, site.authorizeUrl())).toBe(false)
    const notice = shell.getByTestId('notice')
    await expect(notice).toContainText('open a window on')
    await expect(shell.getByTestId('notice-origin')).toHaveText(site.providerOrigin)
    await notice.getByRole('button', { name: 'Allow' }).click()
    await expect(shell.getByRole('status')).toContainText('Click the sign-in button again')

    expect(await tryOpen(page, site.authorizeUrl())).toBe(true)
    await expect.poll(() => driver.app.windows().some((p) => p.url().startsWith(site.providerUrl))).toBe(true)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('nothing is asked about what policy would refuse anyway', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('OAuth Game', site.gameUrl)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])
    const blocked = async (): Promise<number> => (await driver.logRecords()).filter((r) => r['event'] === 'navigation.blocked').length

    // These two reach our guard (and are refused by it)...
    for (const [i, target] of ['http://evil.example/login', 'https://user:pw@accounts.example.com/'].entries()) {
      goTo(page, target)
      await expect.poll(blocked).toBeGreaterThan(i)
    }
    // ...and Chromium itself refuses an http page navigating to file:, before any event reaches us.
    goTo(page, 'file:///etc/passwd')
    await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete')
    expect(await driver.shell.getByTestId('notice').count()).toBe(0) // none of the three produced a question
    expect(page.url().startsWith(site.gameUrl)).toBe(true)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('the renderer cannot allow anything by guessing: unknown or malformed notice ids are rejected', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('OAuth Game', site.gameUrl)
    const a = await driver.createInstance(game.id, 'A')
    await driver.startAndGetPage(a.id, site.gameUrl, [])
    const codes = await driver.shell.evaluate(async () => {
      const resolve = window.gamehub.notices.resolve as (x: unknown) => Promise<{ ok: boolean; error?: { code: string } }>
      const results = await Promise.all([
        resolve({ noticeId: '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b', decision: 'allow' }),
        resolve({ noticeId: 'not-a-uuid', decision: 'allow' }),
        resolve({ noticeId: '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b', decision: 'delete-everything' }),
        resolve({ noticeId: '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b', decision: 'allow', origin: 'https://evil.example' }), // cannot name an origin
      ])
      return results.map((r) => (r.ok ? 'OK' : r.error?.code))
    })
    expect(codes).toEqual(['NOT_FOUND', 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'INVALID_ARGUMENT'])
    const games = await driver.shell.evaluate(() => window.gamehub.games.list())
    expect(games).toMatchObject({ ok: true, data: [{ allowedOrigins: [] }] })
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a notice disappears with its instance, and several can be pending', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('OAuth Game', site.gameUrl)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])

    goTo(page, `${site.providerOrigin}/one`)
    await expect(shell.getByTestId('notice')).toBeVisible()
    goTo(page, `http://localhost:${Number(new URL(site.providerOrigin).port) + 1}/two`) // a second origin
    await expect(shell.getByTestId('notice')).toContainText('1 more waiting')

    await driver.stop(a.id) // its refused navigations cannot be redone any more
    await expect(shell.getByTestId('notice')).toHaveCount(0)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a manual edit of the origins also clears the notice it satisfies', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('OAuth Game', site.gameUrl)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])
    goTo(page, site.authorizeUrl())
    await expect(shell.getByTestId('notice')).toBeVisible()

    await shell.evaluate(([id, origin]) => window.gamehub.games.setAllowedOrigins({ gameId: id as string, allowedOrigins: [origin as string] }), [game.id, site.providerOrigin])
    await expect(shell.getByTestId('notice')).toHaveCount(0)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('removing a game takes its pending notice with it', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('OAuth Game', site.gameUrl)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])
    goTo(page, site.authorizeUrl())
    await expect(shell.getByTestId('notice')).toBeVisible()

    await shell.getByTestId('game-OAuth Game').getByRole('button', { name: 'Remove game' }).click()
    await shell.getByRole('dialog').getByRole('button', { name: 'Remove game' }).click()
    await expect(shell.getByRole('dialog')).toHaveCount(0)
    await expect(shell.getByTestId('notice')).toHaveCount(0) // nothing left to allow for a game that is gone
    expect(await shell.evaluate(() => window.gamehub.notices.list())).toMatchObject({ ok: true, data: [] })
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

