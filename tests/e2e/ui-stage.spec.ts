import { expect, test } from '@playwright/test'
import { startSessionTestSite, type SessionTestSite } from '../fixtures/session-test-site/server'
import { Driver, snapshot } from './helpers/driver'
import { removeUserData } from './helpers/launch'
import {
  dialog,
  goTo,
  resizeWindow,
  row,
  sameBox,
  stage,
  stageBox,
  topbar,
  viewReports,
  visibleViews,
  type Box,
} from './helpers/ui'

let site: SessionTestSite
test.beforeEach(async () => {
  site = await startSessionTestSite()
})
test.afterEach(async () => {
  await site.close().catch(() => undefined)
})

const SHELL = 1

/** Two running accounts of one game. Their views exist but are NOT shown until the UI places them. */
async function twoRunning(driver: Driver) {
  const game = await driver.createGame('Fixture Game', site.url)
  const a = await driver.createInstance(game.id, 'A')
  const b = await driver.createInstance(game.id, 'B')
  const pageA = await driver.startAndGetPage(a.id, site.url, [])
  const pageB = await driver.startAndGetPage(b.id, site.url, [pageA])
  const markerA = (await snapshot(pageA)).marker as string
  const markerB = (await snapshot(pageB)).marker as string
  return { game, a, b, markerA, markerB }
}

const visibleMarkers = async (driver: Driver): Promise<string[]> =>
  (await visibleViews(driver.app)).map((v) => v.marker as string).sort()

test('the UI places game views where it asks: one, all, switching, dialogs, leaving, and falling back', async () => {
  const driver = await Driver.launch()
  try {
    const { shell, app } = driver
    const { a, b, markerA, markerB } = await twoRunning(driver)

    // On the library nothing may cover the UI: both views exist, none is shown.
    await expect(shell.getByRole('heading', { name: 'Fixture Game' })).toBeVisible()
    expect((await viewReports(app)).map((v) => v.visible)).toEqual([false, false])

    // Open A: Play, one view, exactly in the stage rectangle, and keyboard focus moved into it.
    await row(shell, 'A').getByRole('button', { name: 'Open' }).click()
    await expect(shell.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Play/ })).toHaveAttribute('aria-current', 'page')
    await expect(stage(shell)).toBeVisible()
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerA])
    await expect.poll(async () => sameBox((await visibleViews(app))[0]?.bounds as Box, await stageBox(shell))).toBe(true)
    await expect.poll(async () => (await visibleViews(app))[0]?.focused).toBe(true)

    // Resizing the window: the view follows the stage.
    await resizeWindow(app, 1100, 700)
    await expect.poll(async () => sameBox((await visibleViews(app))[0]?.bounds as Box, await stageBox(shell))).toBe(true)

    // All: both views, each directly under its own header, inside the stage, not overlapping.
    await shell.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'All' }).click()
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerA, markerB].sort())
    const box = await stageBox(shell)
    const views = await visibleViews(app)
    for (const view of views) {
      const label = view.marker === markerA ? 'A' : 'B'
      const header = await shell.getByTestId(`tile-${label}`).boundingBox()
      expect(header).not.toBeNull()
      expect(Math.abs(view.bounds.y - (Math.round(header?.y ?? 0) + Math.round(header?.height ?? 0)))).toBeLessThanOrEqual(1)
      expect(Math.abs(view.bounds.x - Math.round(header?.x ?? 0))).toBeLessThanOrEqual(1)
      expect(view.bounds.x).toBeGreaterThanOrEqual(box.x - 1)
      expect(view.bounds.y).toBeGreaterThanOrEqual(box.y - 1)
      expect(view.bounds.x + view.bounds.width).toBeLessThanOrEqual(box.x + box.width + 1)
      expect(view.bounds.y + view.bounds.height).toBeLessThanOrEqual(box.y + box.height + 1)
    }
    const [v1, v2] = views as [(typeof views)[number], (typeof views)[number]]
    const apart = v1.bounds.x + v1.bounds.width <= v2.bounds.x || v2.bounds.x + v2.bounds.width <= v1.bounds.x || v1.bounds.y + v1.bounds.height <= v2.bounds.y || v2.bounds.y + v2.bounds.height <= v1.bounds.y
    expect(apart).toBe(true)

    // Back to one, then switch with the sidebar: only the chosen one is shown.
    await shell.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'One' }).click()
    await expect.poll(() => visibleMarkers(driver)).toHaveLength(1)
    await shell.getByRole('region', { name: 'Running accounts' }).getByRole('button', { name: /^B/ }).click()
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerB])
    await expect(shell.getByRole('region', { name: 'Running accounts' }).getByRole('button', { name: /^B/ })).toHaveAttribute('aria-current', 'true')

    // A dialog is drawn by the page, and native views are drawn above the page: so the view steps aside.
    await topbar(shell).getByRole('button', { name: 'Add game' }).click()
    await expect.poll(() => visibleMarkers(driver)).toEqual([])
    await expect(shell.getByText('Paused behind the open dialog')).toBeVisible()
    await shell.keyboard.press('Escape')
    await expect(dialog(shell)).toHaveCount(0)
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerB])

    // Leaving the screen hides everything; coming back shows what was being watched.
    await goTo(shell, 'Library')
    await expect.poll(() => visibleMarkers(driver)).toEqual([])
    await goTo(shell, 'Settings')
    await expect.poll(() => visibleMarkers(driver)).toEqual([])
    await goTo(shell, 'Play')
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerB])

    // Stop what is on screen: Play falls back to the other running account instead of pointing at nothing.
    await shell.locator('.topbar-play').getByRole('button', { name: 'Stop' }).click()
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerA])
    await shell.locator('.topbar-play').getByRole('button', { name: 'Stop' }).click()
    await expect(shell.getByRole('heading', { name: 'Nothing is running' })).toBeVisible()
    await expect.poll(() => visibleMarkers(driver)).toEqual([])
    expect(await driver.webContentsCount()).toBe(SHELL)

    // Starting again (from outside the UI) shows up on Play by itself, in place.
    await driver.start(a.id)
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerA])
    await expect.poll(async () => sameBox((await visibleViews(app))[0]?.bounds as Box, await stageBox(shell))).toBe(true)
    void b
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('an account that is removed while on screen is replaced by another, never by an empty frame', async () => {
  const driver = await Driver.launch()
  try {
    const { shell, app } = driver
    const { a, b, markerA, markerB } = await twoRunning(driver)
    await row(shell, 'B').getByRole('button', { name: 'Open' }).click()
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerB])

    await driver.stop(b.id)
    await driver.remove(b.id) // gone from under the Play screen
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerA])
    await expect.poll(async () => sameBox((await visibleViews(app))[0]?.bounds as Box, await stageBox(shell))).toBe(true)
    expect((await driver.list()).map((i) => i.label)).toEqual(['A'])
    void a
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a restarted account gets its view back in the same place', async () => {
  const driver = await Driver.launch()
  try {
    const { shell, app } = driver
    const { markerA } = await twoRunning(driver)
    await row(shell, 'A').getByRole('button', { name: 'Open' }).click()
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerA])

    await shell.locator('.topbar-play').getByRole('button', { name: 'Restart' }).click()
    await expect.poll(async () => (await driver.logEvents()).filter((e) => e === 'instance.starting').length).toBe(3) // 2 initial + 1
    await expect.poll(() => visibleMarkers(driver)).toEqual([markerA]) // same profile, new view, placed again
    await expect.poll(async () => sameBox((await visibleViews(app))[0]?.bounds as Box, await stageBox(shell))).toBe(true)
    expect(await driver.webContentsCount()).toBe(SHELL + 2) // A (new) + B; no leftovers
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('Main does not trust layout requests: it clamps, ignores strangers and rejects malformed ones', async () => {
  const driver = await Driver.launch()
  try {
    const { shell, app } = driver
    const { a, markerA, markerB } = await twoRunning(driver)
    const content = (): Promise<{ width: number; height: number }> =>
      app.evaluate(({ BrowserWindow }) => {
        const [width, height] = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('app://gamehub'))?.getContentSize() ?? [0, 0]
        return { width: width ?? 0, height: height ?? 0 }
      })
    const place = (slots: unknown[]): Promise<void> => shell.evaluate((s) => (window.gamehub.stage.setLayout as (x: unknown) => void)(s), slots)
    const slot = (instanceId: string, over: Record<string, number> = {}): Record<string, unknown> => ({ instanceId, x: 100, y: 100, width: 300, height: 200, ...over })

    // A valid request is applied exactly.
    await place([slot(a.id)])
    await expect.poll(async () => (await visibleViews(app))[0]?.bounds).toEqual({ x: 100, y: 100, width: 300, height: 200 })
    expect(await visibleMarkers(driver)).toEqual([markerA])

    // Bigger than the window: clamped inside the content area, never outside it.
    const size = await content()
    await place([slot(a.id, { width: 5000, height: 5000 })])
    await expect.poll(async () => (await visibleViews(app))[0]?.bounds).toEqual({ x: 100, y: 100, width: size.width - 100, height: size.height - 100 })

    // Malformed (negative, fractional, extra keys, wrong ids): the WHOLE message is rejected and the last layout stays.
    await place([slot(a.id)])
    await expect.poll(async () => (await visibleViews(app))[0]?.bounds).toEqual({ x: 100, y: 100, width: 300, height: 200 })
    await place([slot(a.id, { x: -5 })])
    await place([slot(a.id, { width: 10.5 })])
    await place([{ ...slot(a.id), partition: 'persist:gh-other' }])
    await place([slot('../../etc/passwd')])
    await expect.poll(async () => (await driver.logRecords()).filter((r) => r['event'] === 'ipc.invalid_argument' && r['channel'] === 'stage:setLayout').length).toBe(4)
    expect((await visibleViews(app))[0]?.bounds).toEqual({ x: 100, y: 100, width: 300, height: 200 })
    expect(await visibleMarkers(driver)).toEqual([markerA])

    // An id that is not mounted is ignored; whatever is not listed is hidden. Duplicates: the first wins.
    await place([slot('7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b')])
    await expect.poll(() => visibleMarkers(driver)).toEqual([])
    await place([slot(a.id), slot(a.id, { x: 500, y: 400 })])
    await expect.poll(async () => (await visibleViews(app))[0]?.bounds).toEqual({ x: 100, y: 100, width: 300, height: 200 })
    expect(await visibleMarkers(driver)).toEqual([markerA])
    expect(markerB).not.toBe(markerA)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('while the library loads there is a loading state; if it cannot load there is an error with Try again', async () => {
  const driver = await Driver.launch()
  try {
    const { shell, app } = driver

    // Loading: the first snapshot is slow.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('instances:snapshot')
      ipcMain.handle('instances:snapshot', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200))
        return { ok: true, data: { seq: 0, instances: [] } }
      })
    })
    await shell.reload()
    await expect(shell.locator('[aria-busy="true"]')).toBeVisible()
    await expect(shell.getByRole('heading', { name: 'No games yet' })).toBeVisible()

    // Error: the snapshot cannot be had at all (no handler: the call rejects).
    await app.evaluate(({ ipcMain }) => ipcMain.removeHandler('instances:snapshot'))
    await shell.reload()
    const heading = shell.getByRole('heading', { name: "Couldn't load your library" })
    await expect(heading).toBeVisible()
    await expect(shell.getByText('Your data is not affected.')).toBeVisible()
    expect(await shell.locator('body').innerText()).not.toMatch(/handler|invoke|IPC|INTERNAL|Error:/i) // no internals shown

    // Try again while it is still broken: still an error, not a spinner that never ends.
    await shell.getByRole('button', { name: 'Try again' }).click()
    await expect(heading).toBeVisible()

    // It recovers as soon as the app can answer.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.handle('instances:snapshot', () => ({ ok: true, data: { seq: 0, instances: [] } }))
    })
    await shell.getByRole('button', { name: 'Try again' }).click()
    await expect(shell.getByRole('heading', { name: 'No games yet' })).toBeVisible()
    await expect(shell.getByTestId('sync-status')).toHaveAttribute('data-live', 'true')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('every state the UI can show for an account is legible: labels and shapes differ, not only colours', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const port = Number(new URL(site.url).port)
    const game = await driver.createGame('Fixture Game', site.url)
    const okAccount = await driver.createInstance(game.id, 'Fine')
    await driver.createInstance(game.id, 'Idle')
    await driver.start(okAccount.id)
    await site.close()
    const broken = await driver.createInstance(game.id, 'Broken')
    await driver.start(broken.id)
    site = await startSessionTestSite(port)

    await expect(shell.getByTestId('instance-Fine').locator('[data-status]')).toHaveAttribute('data-status', 'running')
    await expect(shell.getByTestId('instance-Broken').locator('[data-status]')).toHaveAttribute('data-status', 'error')

    const looks = await shell.evaluate(() => {
      const lamp = (label: string): { state: string | null; text: string; shape: string } => {
        const element = document.querySelector(`[data-testid="instance-${label}"]`) as HTMLElement
        const dot = element.querySelector('.lamp') as HTMLElement
        const style = getComputedStyle(dot)
        return {
          state: dot.getAttribute('data-state'),
          text: (element.querySelector('[data-status]') as HTMLElement).innerText,
          shape: `${style.borderRadius}|${style.borderTopWidth}|${style.transform}`,
        }
      }
      return { fine: lamp('Fine'), idle: lamp('Idle'), broken: lamp('Broken') }
    })
    expect(looks.fine).toMatchObject({ state: 'running', text: 'Running' })
    expect(looks.idle).toMatchObject({ state: 'stopped', text: 'Stopped' })
    expect(looks.broken).toMatchObject({ state: 'error', text: 'Error' })
    expect(new Set([looks.fine.shape, looks.idle.shape, looks.broken.shape]).size).toBe(3) // three different shapes
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

