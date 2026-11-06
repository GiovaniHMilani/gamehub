import { expect, test } from '@playwright/test'
import { startSessionTestSite, type SessionTestSite } from '../fixtures/session-test-site/server'
import { Driver } from './helpers/driver'
import { removeUserData } from './helpers/launch'

let site: SessionTestSite
test.beforeEach(async () => {
  site = await startSessionTestSite()
})
test.afterEach(async () => {
  await site.close().catch(() => undefined)
})

const SHELL_ONLY = 1

test('start/stop cycles leave no orphan webContents, and logs explain each step', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    expect(await driver.webContentsCount()).toBe(SHELL_ONLY)

    for (let i = 0; i < 5; i++) {
      expect((await driver.start(a.id)).status).toBe('running')
      expect(await driver.webContentsCount()).toBe(SHELL_ONLY + 1)
      expect((await driver.stop(a.id)).status).toBe('stopped')
      expect(await driver.webContentsCount()).toBe(SHELL_ONLY)
    }

    await driver.remove(a.id)
    expect(await driver.webContentsCount()).toBe(SHELL_ONLY)

    expect(await driver.logEvents()).toEqual(
      expect.arrayContaining([
        'instance.created',
        'session.created',
        'session.loaded',
        'instance.starting',
        'view.created',
        'navigation.started',
        'navigation.completed',
        'instance.running',
        'instance.stopping',
        'view.destroyed',
        'instance.stopped',
        'instance.removed',
        'session.destroyed',
      ]),
    )
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('concurrent commands never corrupt the lifecycle or duplicate views', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')

    // start x3 at once -> one view
    const results = await Promise.all([driver.start(a.id), driver.start(a.id), driver.start(a.id)])
    expect(results.map((r) => r.status)).toEqual(['running', 'running', 'running'])
    expect(await driver.webContentsCount()).toBe(SHELL_ONLY + 1)
    expect(driver.gamePages(site.url)).toHaveLength(1)

    // start, stop, start, issued together -> ends running with exactly one view
    await driver.stop(a.id)
    const mixed = await driver.shell.evaluate(async (id) => {
      const api = window.gamehub.instances
      return Promise.all([api.start(id), api.stop(id), api.start(id), api.restart(id)])
    }, a.id)
    expect(mixed.at(-1)).toMatchObject({ ok: true, data: { status: 'running' } })
    expect((await driver.list())[0]?.status).toBe('running')
    expect(await driver.webContentsCount()).toBe(SHELL_ONLY + 1)

    // a burst of mixed commands, then settle
    await driver.shell.evaluate(async (id) => {
      const api = window.gamehub.instances
      const ops: Array<Promise<unknown>> = []
      for (let i = 0; i < 10; i++) ops.push(api.start(id), api.stop(id), api.restart(id))
      await Promise.all(ops)
    }, a.id)
    await driver.stop(a.id)
    expect((await driver.list())[0]?.status).toBe('stopped')
    expect(await driver.webContentsCount()).toBe(SHELL_ONLY)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a failing game ends in error, tears its view down, and recovers via restart', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    const port = new URL(site.url).port
    await site.close() // the game goes offline

    const failed = await driver.start(a.id)
    expect(failed).toMatchObject({ status: 'error', errorCode: 'ERR_CONNECTION_REFUSED' })
    expect(await driver.webContentsCount()).toBe(SHELL_ONLY)
    expect(await driver.logEvents()).toContain('instance.error')

    site = await startSessionTestSite(Number(port)) // back online on the same origin
    const recovered = await driver.restart(a.id)
    expect(recovered).toMatchObject({ status: 'running', errorCode: null })
    expect(await driver.webContentsCount()).toBe(SHELL_ONLY + 1)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a crashed renderer becomes crashed, and restart recovers it without duplicates', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.url, [])
    await page.evaluate(() => localStorage.setItem('probe', 'kept'))

    await driver.app.evaluate(({ webContents }, url) => {
      webContents.getAllWebContents().find((w) => w.getURL().startsWith(url))?.forcefullyCrashRenderer()
    }, site.url)

    await expect.poll(async () => (await driver.list())[0]?.status).toBe('crashed')
    expect(await driver.logEvents()).toContain('instance.crashed')

    const restarted = await driver.restart(a.id)
    expect(restarted.status).toBe('running')
    expect(await driver.webContentsCount()).toBe(SHELL_ONLY + 1)

    // Same account, same session: the data written before the crash is still there.
    const reopened = driver.gamePages(site.url)
    expect(reopened).toHaveLength(1)
    await reopened[0]?.waitForSelector('body[data-ready="true"]')
    expect(await reopened[0]?.evaluate(() => localStorage.getItem('probe'))).toBe('kept')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})
