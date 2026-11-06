import { expect, test } from '@playwright/test'
import { startSessionTestSite } from '../fixtures/session-test-site/server'
import { Driver, setIdentity, snapshot } from './helpers/driver'
import { removeUserData } from './helpers/launch'

// The temporary control strip is the only UI in this phase. This test drives it
// with real clicks, so the renderer -> preload -> IPC -> Main path is covered
// through the actual React components, not only through the API.
test('the control strip can create, start, close and remove two accounts', async () => {
  const site = await startSessionTestSite()
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    for (const label of ['A', 'B']) {
      await shell.getByLabel('Game URL').fill(site.url)
      await shell.getByLabel('Account label').fill(label)
      await shell.getByRole('button', { name: 'Add account' }).click()
      await expect(shell.getByTestId(`instance-${label}`)).toBeVisible()
    }
    // Same URL -> a single game, two accounts.
    expect(await shell.evaluate(() => window.gamehub.games.list().then((r) => (r.ok ? r.data.length : -1)))).toBe(1)

    const rowA = shell.getByTestId('instance-A')
    const rowB = shell.getByTestId('instance-B')
    await rowA.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(rowA.locator('[data-status]')).toHaveText('running')
    await rowB.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(rowB.locator('[data-status]')).toHaveText('running')

    const pages = driver.gamePages(site.url)
    expect(pages).toHaveLength(2)
    for (const page of pages) await page.waitForSelector('body[data-ready="true"]')
    await setIdentity(pages[0] as never, 'ACCOUNT_X')
    expect((await snapshot(pages[1] as never)).localStorage).toBeNull()

    await rowA.getByRole('button', { name: 'Close' }).click()
    await expect(rowA.locator('[data-status]')).toHaveText('stopped')
    await expect.poll(() => driver.gamePages(site.url).length).toBe(1)

    await rowA.getByRole('button', { name: 'Remove' }).click()
    await expect(rowA).toHaveCount(0)
    await expect(rowB.locator('[data-status]')).toHaveText('running')
  } finally {
    await driver.close()
    await site.close()
    await removeUserData(driver.userDataDir)
  }
})
