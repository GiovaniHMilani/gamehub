import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { startSessionTestSite, type SessionTestSite } from '../fixtures/session-test-site/server'
import { Driver, setIdentity, snapshot, waitReady } from './helpers/driver'
import { removeUserData } from './helpers/launch'
import { accountMenu, accountMenuItems, actionNames, addAccount, addGame, dialog, goTo, manageGame, resizeWindow, row, section, statusOf, toast, topbar, visibleViews } from './helpers/ui'

let site: SessionTestSite
test.beforeEach(async () => {
  site = await startSessionTestSite()
})
test.afterEach(async () => {
  await site.close().catch(() => undefined)
})

const SHELL = 1
const HOST = (): string => new URL(site.url).host

test('first run: an empty library invites adding a game, and the form explains every mistake', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    await expect(shell.getByRole('heading', { name: 'No games yet' })).toBeVisible()
    await expect(shell.getByText('Nothing running')).toBeVisible()

    await topbar(shell).getByRole('button', { name: 'Add game' }).click()
    const dlg = dialog(shell)
    await expect(dlg.getByRole('heading', { name: 'Add a game' })).toBeVisible()
    const submit = dlg.getByRole('button', { name: 'Add game' })

    await submit.click()
    await expect(dlg.getByText('Enter the address of the game.')).toBeVisible()
    await dlg.getByLabel('Address').fill('pokeidle.io')
    await submit.click()
    await expect(dlg.getByText('Enter a full address, like https://example.com/')).toBeVisible()
    await dlg.getByLabel('Address').fill('http://example.com/')
    await submit.click()
    await expect(dlg.getByText('Use an https address. Plain http only works for localhost.')).toBeVisible()
    expect(await shell.evaluate(() => window.gamehub.games.list())).toMatchObject({ ok: true, data: [] }) // nothing was created

    // The name is optional: it falls back to the address, and says so.
    await dlg.getByLabel('Address').fill(site.url)
    await expect(dlg.getByText(`Optional. Defaults to ${HOST()}.`)).toBeVisible()
    await dlg.getByLabel('Description').fill('A fixture game for tests')
    await submit.click()
    await expect(dlg).toHaveCount(0)

    const created = section(shell, HOST())
    await expect(created).toBeVisible()
    await expect(created).toContainText('A fixture game for tests')
    await expect(created).toContainText('No accounts yet')
    await expect(toast(shell)).toContainText('was added to your library')
    expect(await shell.evaluate(() => window.gamehub.games.list())).toMatchObject({ ok: true, data: [{ description: 'A fixture game for tests' }] })
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('two accounts of one game, added in the UI, are independent browsers', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    await addGame(shell, { url: site.url, name: 'Fixture Game' })
    await addAccount(shell, 'Fixture Game', 'Main')
    await expect(row(shell, 'Main')).toBeVisible()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'stopped')

    // A repeated name is refused (case-insensitive): two accounts must be easy to tell apart.
    await section(shell, 'Fixture Game').getByRole('button', { name: 'Add account' }).first().click()
    const dlg = dialog(shell)
    await expect(dlg.getByLabel('Account name')).toHaveValue('Account 2') // a free name is suggested
    await dlg.getByLabel('Account name').fill('main')
    await dlg.getByRole('button', { name: 'Add account', exact: true }).click()
    await expect(dlg.getByText('This game already has an account with that name.')).toBeVisible()
    await dlg.getByLabel('Account name').fill('Alt')
    await dlg.getByRole('button', { name: 'Add and start' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(statusOf(shell, 'Alt')).toHaveAttribute('data-status', 'running')

    await row(shell, 'Main').getByRole('button', { name: 'Start' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'running')

    const nav = shell.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('button', { name: /^Play/ })).toContainText('2')
    await expect(shell.getByRole('region', { name: 'Running accounts' }).getByRole('button')).toHaveCount(2)

    // The same page, two sessions: what one account stores, the other never sees.
    const pages = driver.gamePages(site.url)
    expect(pages).toHaveLength(2)
    for (const page of pages) await waitReady(page)
    const [first, second] = pages
    await setIdentity(first as NonNullable<typeof first>, 'ACCOUNT_ONE')
    await setIdentity(second as NonNullable<typeof second>, 'ACCOUNT_TWO')
    const snapshots = await Promise.all(pages.map((page) => snapshot(page)))
    expect(new Set(snapshots.map((s) => s.localStorage))).toEqual(new Set(['ACCOUNT_ONE', 'ACCOUNT_TWO']))
    expect(new Set(snapshots.map((s) => s.marker)).size).toBe(2)
    expect(JSON.stringify(snapshots[0])).not.toContain(snapshots[1]?.localStorage ?? 'unreachable')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('lifecycle in the UI: each state offers the right buttons; remove asks first', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', site.url)
    await driver.createInstance(game.id, 'Main')
    const main = row(shell, 'Main')
    const buttons = (): Promise<string[]> => actionNames(main)

    // stopped: Start in view, Remove behind the menu
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'stopped')
    expect(await buttons()).toEqual(['Start', 'More for Main'])
    expect(await accountMenuItems(shell, 'Main')).toEqual(['Remove'])

    // running: Open and Stop in view, Restart behind the menu (and no Remove)
    await main.getByRole('button', { name: 'Start' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'running')
    expect(await buttons()).toEqual(['Open', 'Stop', 'More for Main'])
    expect(await accountMenuItems(shell, 'Main')).toEqual(['Restart'])

    await accountMenu(shell, 'Main', 'Restart')
    await expect.poll(async () => (await driver.logEvents()).filter((e) => e === 'instance.starting').length).toBe(2)
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'running')
    expect(await driver.webContentsCount()).toBe(SHELL + 1) // restarting never leaves a second view behind

    await main.getByRole('button', { name: 'Stop' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'stopped')
    expect(await driver.webContentsCount()).toBe(SHELL)

    // remove: nothing is deleted until confirmed, and Cancel is the default
    await accountMenu(shell, 'Main', 'Remove')
    const dlg = dialog(shell)
    await expect(dlg.getByRole('heading', { name: 'Remove Main?' })).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(main).toBeVisible()
    expect(await driver.list()).toHaveLength(1)

    await accountMenu(shell, 'Main', 'Remove')
    await dlg.getByRole('button', { name: 'Remove account' }).click()
    await expect(main).toHaveCount(0)
    await expect(toast(shell)).toContainText('Main was removed.')
    expect(await driver.list()).toHaveLength(0)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a running account can only be removed after stopping, and the confirmation says what will happen', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', site.url)
    await driver.createInstance(game.id, 'Main')
    const main = row(shell, 'Main')
    await main.getByRole('button', { name: 'Start' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'running')
    expect(await accountMenuItems(shell, 'Main')).not.toContain('Remove') // not offered while it runs

    await main.getByRole('button', { name: 'Stop' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'stopped')
    await accountMenu(shell, 'Main', 'Remove')
    await expect(dialog(shell)).toContainText("can't be undone")
    await dialog(shell).getByRole('button', { name: 'Remove account' }).click()
    await expect(main).toHaveCount(0)
    expect(await driver.webContentsCount()).toBe(SHELL) // no view left behind
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('the UI follows events it did not cause, and a dialog about a vanished account closes by itself', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'Alpha')
    const b = await driver.createInstance(game.id, 'Bravo')
    await expect(row(shell, 'Alpha')).toBeVisible()
    await expect(row(shell, 'Bravo')).toBeVisible()

    // Started by the API: no click, yet the row, the sidebar and the Play counter follow.
    await driver.start(a.id)
    await expect(statusOf(shell, 'Alpha')).toHaveAttribute('data-status', 'running')
    await expect(shell.getByRole('region', { name: 'Running accounts' }).getByRole('button', { name: /Alpha/ })).toBeVisible()
    await driver.stop(a.id)
    await expect(statusOf(shell, 'Alpha')).toHaveAttribute('data-status', 'stopped')
    await expect(shell.getByRole('region', { name: 'Running accounts' }).getByRole('button')).toHaveCount(0)

    // A new account appears on its own.
    await driver.createInstance(game.id, 'Charlie')
    await expect(row(shell, 'Charlie')).toBeVisible()

    // A confirmation dialog for an account that is removed elsewhere goes away, without an error.
    await accountMenu(shell, 'Bravo', 'Remove')
    await expect(dialog(shell).getByRole('heading', { name: 'Remove Bravo?' })).toBeVisible()
    await driver.remove(b.id)
    await expect(dialog(shell)).toHaveCount(0)
    await expect(row(shell, 'Bravo')).toHaveCount(0)
    await expect(toast(shell)).not.toContainText(/couldn't/i)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a game that is offline shows why, offers Retry and Remove (never Stop), and recovers', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const port = Number(new URL(site.url).port)
    const game = await driver.createGame('Fixture Game', site.url)
    await driver.createInstance(game.id, 'Main')
    await site.close() // the game goes offline

    const main = row(shell, 'Main')
    await main.getByRole('button', { name: 'Start' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'error')
    await expect(main).toContainText('The game refused the connection.')
    expect(await actionNames(main)).toEqual(['Retry', 'More for Main']) // never Stop
    expect(await accountMenuItems(shell, 'Main')).toEqual(['Remove'])
    expect(await driver.webContentsCount()).toBe(SHELL) // the failed view was torn down
    await expect(shell.getByRole('region', { name: 'Running accounts' }).getByRole('button')).toHaveCount(0)

    // Retrying while it is still offline stays in error: no loop, no stuck "Starting…".
    await main.getByRole('button', { name: 'Retry' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'error')

    site = await startSessionTestSite(port) // back online
    await main.getByRole('button', { name: 'Retry' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'running')
    await expect(main).not.toContainText('refused')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a crashed game says so and can be restarted', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'Main')
    await driver.startAndGetPage(a.id, site.url, [])
    await driver.app.evaluate(({ webContents }, url) => {
      webContents.getAllWebContents().find((w) => w.getURL().startsWith(url))?.forcefullyCrashRenderer()
    }, site.url)

    const main = row(shell, 'Main')
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'crashed')
    await expect(main).toContainText('The game stopped unexpectedly.')
    expect(await actionNames(main)).toEqual(['Restart', 'More for Main'])
    expect(await accountMenuItems(shell, 'Main')).toEqual(['Remove'])
    await main.getByRole('button', { name: 'Restart' }).click()
    await expect(statusOf(shell, 'Main')).toHaveAttribute('data-status', 'running')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('12 accounts stay readable at the smallest window; search and filters narrow the list; one change touches one row', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const alpha = await driver.createGame('Alpha Game', site.url)
    const beta = await driver.createGame('Beta Game', site.url.replace('127.0.0.1', 'localhost'))
    const ids: string[] = []
    for (const label of ['main', 'alt 1', 'alt 2', 'alt 3', 'farm a', 'farm b', 'long account name to check that nothing is clipped here']) {
      ids.push((await driver.createInstance(alpha.id, label)).id)
    }
    for (const label of ['one', 'two', 'three', 'four', 'five']) ids.push((await driver.createInstance(beta.id, label)).id)
    await expect(shell.locator('[data-testid^="instance-"]')).toHaveCount(12)

    // The smallest window the app allows: nothing overflows, every button is reachable.
    await resizeWindow(driver.app, 960, 600)
    await expect.poll(() => shell.evaluate(() => innerWidth)).toBeLessThanOrEqual(960)
    const overflow = await shell.evaluate(() => {
      const screen = document.querySelector('.screen') as HTMLElement
      const edge = innerWidth
      const buttons = [...document.querySelectorAll<HTMLElement>('[data-testid^="instance-"] button, .game-banner button')]
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        screen: screen.scrollWidth - screen.clientWidth,
        clippedButtons: buttons.filter((b) => b.getBoundingClientRect().right > edge).length,
        buttons: buttons.length,
      }
    })
    expect(overflow.page).toBeLessThanOrEqual(0)
    expect(overflow.screen).toBeLessThanOrEqual(0)
    expect(overflow.clippedButtons).toBe(0)
    expect(overflow.buttons).toBeGreaterThanOrEqual(24)

    // Search: by game, by account, and nothing.
    const search = shell.getByRole('searchbox', { name: 'Search games and accounts' })
    await search.fill('beta')
    await expect(shell.locator('[data-testid^="game-"]')).toHaveCount(1)
    await expect(shell.locator('[data-testid^="instance-"]')).toHaveCount(5)
    await search.fill('alt 1')
    await expect(shell.locator('[data-testid^="instance-"]')).toHaveCount(1)
    await expect(row(shell, 'alt 1')).toBeVisible()
    await search.fill('zzz nothing')
    await expect(shell.getByRole('heading', { name: 'Nothing matches' })).toBeVisible()
    await shell.getByRole('button', { name: 'Clear search and filter' }).click()
    await expect(shell.locator('[data-testid^="instance-"]')).toHaveCount(12)
    await expect(search).toHaveValue('')

    // Filters.
    await driver.start(ids[0] as string)
    await driver.start(ids[7] as string)
    await shell.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Running' }).click()
    await expect(shell.locator('[data-testid^="instance-"]')).toHaveCount(2)
    await shell.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Problems' }).click()
    await expect(shell.getByRole('heading', { name: 'Nothing matches' })).toBeVisible()
    await shell.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click()
    await expect(shell.locator('[data-testid^="instance-"]')).toHaveCount(12)

    // One change touches one row: watch the whole list while a single account changes state.
    await shell.evaluate(() => {
      const list = document.querySelector('.game-grid') as HTMLElement
      const touched = new Set<string>()
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const owner = (record.target as Node).parentElement?.closest('[data-testid^="instance-"]')
          touched.add(owner?.getAttribute('data-testid') ?? 'outside-rows')
        }
      })
      observer.observe(list, { subtree: true, childList: true, attributes: true, characterData: true })
      Object.assign(window, { __touched: touched })
    })
    await driver.start(ids[3] as string) // "alt 3"
    await expect(statusOf(shell, 'alt 3')).toHaveAttribute('data-status', 'running')
    const touched = await shell.evaluate(() => [...((window as unknown as { __touched: Set<string> }).__touched)])
    expect(touched).toContain('instance-alt 3')
    const others = touched.filter((id) => id !== 'instance-alt 3' && id !== 'outside-rows')
    expect(others).toEqual([]) // no other account row was re-rendered into a different DOM
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('each game has its own colour, used consistently by its cover, its accounts and the sidebar', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const names = ['Alpha Game', 'Beta Game', 'Gamma Game']
    const created = []
    for (const name of names) created.push(await driver.createGame(name, site.url))
    const accounts = []
    for (const [i, game] of created.entries()) accounts.push(await driver.createInstance(game.id, `acc ${i}`))
    await expect(shell.locator('[data-testid^="game-"]')).toHaveCount(3)
    await driver.start((accounts[0] as { id: string }).id)
    await expect(shell.locator('.party-item')).toHaveCount(1)

    // What is actually PAINTED: a probe that uses the game's colour is put inside each element and its
    // resolved colour is read back. A colour that never reaches an element through the cascade shows up here.
    const colours = await shell.evaluate((gameNames) => {
      const painted = (host: Element | null): string => {
        if (host === null) return ''
        const probe = document.createElement('i')
        probe.style.cssText = 'display:block;width:1px;height:1px;background:var(--game)'
        host.appendChild(probe)
        const colour = getComputedStyle(probe).backgroundColor
        probe.remove()
        return colour
      }
      return gameNames.map((name, i) => {
        const section = document.querySelector(`[data-testid="game-${name}"]`) as HTMLElement
        return {
          cover: painted(section.querySelector('.game-art')),
          account: painted(section.querySelector(`[data-testid="instance-acc ${i}"] .portrait`)),
          panel: painted(section),
        }
      })
    }, names)
    const covers = colours.map((c) => c.cover)
    expect(new Set(covers).size).toBe(3) // three games, three different colours
    for (const c of colours) {
      expect(c.cover).not.toBe('')
      expect(c.account).toBe(c.cover) // its accounts wear its colour
      expect(c.panel).toBe(c.cover)
    }

    // The sidebar portrait of a running account carries the same colour as its game.
    const sidebar = await shell.evaluate(() => {
      const probe = document.createElement('i')
      probe.style.cssText = 'display:block;width:1px;height:1px;background:var(--game)'
      const host = document.querySelector('.party-item') as Element
      host.appendChild(probe)
      const colour = getComputedStyle(probe).backgroundColor
      probe.remove()
      return colour
    })
    expect(sidebar).toBe(covers[0])
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('removing a game removes its accounts too: it says how many, stops the running ones, and leaves other games alone', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gamehub-remove-game-'))
  try {
    const driver = await Driver.launch(userData)
    const { shell } = driver
    const doomed = await driver.createGame('Doomed Game', site.url)
    const other = await driver.createGame('Other Game', site.url.replace('127.0.0.1', 'localhost'))
    const a = await driver.createInstance(doomed.id, 'A')
    await driver.createInstance(doomed.id, 'B')
    const k = await driver.createInstance(other.id, 'K')
    await driver.start(a.id)
    await driver.start(k.id)
    await expect(statusOf(shell, 'A')).toHaveAttribute('data-status', 'running')
    await expect(statusOf(shell, 'K')).toHaveAttribute('data-status', 'running')
    expect(await driver.webContentsCount()).toBe(SHELL + 2)

    await manageGame(shell, 'Doomed Game', 'Remove game')
    const dlg = dialog(shell)
    await expect(dlg.getByRole('heading', { name: 'Remove Doomed Game?' })).toBeVisible()
    await expect(dlg).toContainText('2 accounts')
    await expect(dlg).toContainText('1 running account will be stopped first')
    await expect(dlg).toContainText("can't be undone")
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused()

    // Cancel changes nothing.
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toHaveCount(0)
    expect((await driver.list()).map((i) => i.label).sort()).toEqual(['A', 'B', 'K'])
    await expect(statusOf(shell, 'A')).toHaveAttribute('data-status', 'running')

    // Confirm: the game, both accounts and the running view are gone; the other game is untouched.
    await manageGame(shell, 'Doomed Game', 'Remove game')
    await dlg.getByRole('button', { name: 'Remove game' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(section(shell, 'Doomed Game')).toHaveCount(0)
    await expect(row(shell, 'A')).toHaveCount(0)
    await expect(row(shell, 'B')).toHaveCount(0)
    await expect(toast(shell)).toContainText('Doomed Game was removed.')
    await expect(section(shell, 'Other Game')).toBeVisible()
    await expect(statusOf(shell, 'K')).toHaveAttribute('data-status', 'running')
    expect((await driver.list()).map((i) => i.label)).toEqual(['K'])
    expect(await shell.evaluate(() => window.gamehub.games.list())).toMatchObject({ ok: true, data: [{ name: 'Other Game' }] })
    expect(await driver.webContentsCount()).toBe(SHELL + 1) // only K's view is left
    await expect(shell.getByRole('region', { name: 'Running accounts' }).getByRole('button')).toHaveCount(1)
    await driver.close()

    // Their browser data is deleted from disk at the next start; the other game's session stays.
    const second = await Driver.launch(userData)
    try {
      await expect(row(second.shell, 'K')).toBeVisible()
      await expect(row(second.shell, 'A')).toHaveCount(0)
      const partitions = (await readdir(join(userData, 'Partitions'))).filter((d) => d.startsWith('gh-'))
      expect(partitions).toHaveLength(1)
      const db = new Database(join(userData, 'gamehub.db'), { readonly: true })
      try {
        expect((db.prepare('select count(*) as n from games').get() as { n: number }).n).toBe(1)
        expect((db.prepare('select count(*) as n from game_accounts').get() as { n: number }).n).toBe(1)
        expect((db.prepare('select count(*) as n from partition_tombstones').get() as { n: number }).n).toBe(0)
      } finally {
        db.close()
      }
    } finally {
      await second.close()
    }
  } finally {
    await removeUserData(userData)
  }
})

test('editing a game: name, address and description change; accounts stay; running accounts keep their page until restarted', async () => {
  const siteB = await startSessionTestSite()
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Old Name', site.url, ['https://auth.example.com'])
    const main = await driver.createInstance(game.id, 'Main')
    const alt = await driver.createInstance(game.id, 'Alt')
    const running = await driver.startAndGetPage(main.id, site.url, [])
    const dlg = dialog(shell)
    const edit = (): Promise<void> => manageGame(shell, 'Old Name', 'Edit game')

    // Opens filled in, with no warnings, and saving without a change does not even ask Main.
    await edit()
    await expect(dlg.getByRole('heading', { name: 'Edit Old Name' })).toBeVisible()
    await expect(dlg.getByLabel('Address')).toHaveValue(site.url)
    await expect(dlg.getByLabel('Name')).toHaveValue('Old Name')
    await expect(dlg.getByRole('note')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await expect(dlg).toHaveCount(0)
    expect(await driver.logEvents()).not.toContain('game.updated')

    // A bad address is explained and nothing is saved.
    await edit()
    await dlg.getByLabel('Address').fill('pokeidle')
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await expect(dlg.getByText('Enter a full address, like https://example.com/')).toBeVisible()
    expect(await shell.evaluate(() => window.gamehub.games.list())).toMatchObject({ ok: true, data: [{ name: 'Old Name', startUrl: site.url }] })

    // Another site: the form says what that means, before saving.
    await dlg.getByLabel('Address').fill(siteB.url)
    await expect(dlg.getByRole('note').first()).toContainText('This is a different site')
    await expect(dlg.getByRole('note').first()).toContainText('may need to sign in again')
    await expect(dlg).toContainText('1 running account keeps the current page until you restart it')
    await dlg.getByLabel('Name').fill('New Name')
    await dlg.getByLabel('Description').fill('Now somewhere else')
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await expect(dlg).toHaveCount(0)

    await expect(toast(shell)).toContainText('Saved changes to New Name.')
    await expect(section(shell, 'Old Name')).toHaveCount(0)
    const renamed = section(shell, 'New Name')
    await expect(renamed).toContainText('Now somewhere else')
    await expect(row(shell, 'Main')).toBeVisible() // the accounts did not move
    await expect(row(shell, 'Alt')).toBeVisible()
    expect(await shell.evaluate(() => window.gamehub.games.list())).toMatchObject({
      ok: true,
      data: [{ id: game.id, name: 'New Name', startUrl: siteB.url, description: 'Now somewhere else', allowedOrigins: ['https://auth.example.com'] }],
    })
    const updated = (await driver.logRecords()).find((r) => r['event'] === 'game.updated')
    expect(updated).toMatchObject({ gameId: game.id, originChanged: true })
    expect(JSON.stringify(updated)).not.toContain(siteB.url) // addresses are not logged

    // The running account stays on the page it is on; restarting it loads the new address.
    expect(running.url().startsWith(site.url)).toBe(true)
    await driver.restart(main.id)
    await expect.poll(() => driver.gamePages(siteB.url).length).toBe(1)
    expect(driver.gamePages(site.url)).toHaveLength(0)
    await driver.start(alt.id) // a stopped account simply starts on the new address
    await expect.poll(() => driver.gamePages(siteB.url).length).toBe(2)
  } finally {
    await driver.close()
    await siteB.close()
    await removeUserData(driver.userDataDir)
  }
})

test('editing only what does not change the site warns only as much as needed', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', `${site.url}play`)
    const a = await driver.createInstance(game.id, 'Main')
    await driver.start(a.id)
    await manageGame(shell, 'Fixture Game', 'Edit game')
    const dlg = dialog(shell)

    await dlg.getByLabel('Name').fill('Renamed') // only the name: no warning at all
    await expect(dlg.getByRole('note')).toHaveCount(0)

    await dlg.getByLabel('Address').fill(`${site.url}other`) // same site, another page: only the "restart" note
    await expect(dlg.getByRole('note')).toHaveCount(1)
    await expect(dlg).toContainText('keeps the current page')
    await expect(dlg).not.toContainText('different site')
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(section(shell, 'Renamed')).toBeVisible()
    expect(await driver.logRecords().then((r) => r.find((x) => x['event'] === 'game.updated'))).toMatchObject({ originChanged: false })
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a game without accounts can be removed, and removing the last game brings back the empty state', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    await addGame(shell, { url: site.url, name: 'Lonely Game' })
    await expect(section(shell, 'Lonely Game')).toContainText('No accounts yet')

    await manageGame(shell, 'Lonely Game', 'Remove game')
    await expect(dialog(shell)).toContainText('It has no accounts.')
    await dialog(shell).getByRole('button', { name: 'Remove game' }).click()
    await expect(dialog(shell)).toHaveCount(0)
    await expect(shell.getByRole('heading', { name: 'No games yet' })).toBeVisible()
    expect(await shell.evaluate(() => window.gamehub.games.list())).toMatchObject({ ok: true, data: [] })
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('if removing a game fails, the dialog stays open and says so in plain words', async () => {
  const driver = await Driver.launch()
  try {
    const { shell, app } = driver
    const game = await driver.createGame('Stubborn Game', site.url)
    await driver.createInstance(game.id, 'A')
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('games:remove')
      ipcMain.handle('games:remove', () => ({ ok: false, error: { code: 'INTERNAL', message: 'SQLITE_BUSY /Users/someone/gamehub.db' } }))
    })

    await manageGame(shell, 'Stubborn Game', 'Remove game')
    await dialog(shell).getByRole('button', { name: 'Remove game' }).click()
    const alert = dialog(shell).getByRole('alert')
    await expect(alert).toContainText("Couldn't remove it.")
    expect(await dialog(shell).innerText()).not.toMatch(/SQLITE|INTERNAL|\/Users|gamehub\.db/)
    await expect(dialog(shell).getByRole('button', { name: 'Remove game' })).toBeEnabled() // it can be tried again
    await dialog(shell).getByRole('button', { name: 'Cancel' }).click()
    await expect(section(shell, 'Stubborn Game')).toBeVisible()
    await expect(row(shell, 'A')).toBeVisible() // nothing was removed
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('allowed sites: reviewed, added (normalised and validated) and removed from the game', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', site.url)
    await driver.createInstance(game.id, 'Main')
    // The entry says how many extra sites there are, once there are some.
    await shell.getByRole('button', { name: 'Manage Fixture Game' }).click()
    await expect(shell.getByRole('menuitem', { name: /Allowed sites/ })).toHaveText('Allowed sites')
    await shell.getByRole('menuitem', { name: /Allowed sites/ }).click()

    const dlg = dialog(shell)
    await expect(dlg.getByRole('heading', { name: 'Allowed sites for Fixture Game' })).toBeVisible()
    await expect(dlg.getByText('No extra sites yet.')).toBeVisible()
    const field = dlg.getByLabel('Allow another site')
    const add = dlg.getByRole('button', { name: 'Allow', exact: true })
    const listed = async (): Promise<readonly string[]> => {
      const result = await shell.evaluate(() => window.gamehub.games.list())
      return result.ok ? (result.data[0]?.allowedOrigins ?? []) : []
    }

    await field.fill('login.example.com')
    await add.click()
    await expect(dlg.getByText(/Use just the site/)).toBeVisible()
    await field.fill('http://login.example.com')
    await add.click()
    await expect(dlg.getByText(/Use just the site/)).toBeVisible()
    expect(await listed()).toEqual([])

    await field.fill('  HTTPS://Login.Example.com/  ') // typed the way it was copied
    await add.click()
    await expect(dlg.getByTestId('origin-https://login.example.com')).toBeVisible()
    expect(await listed()).toEqual(['https://login.example.com'])
    await expect(field).toHaveValue('')

    await field.fill('https://login.example.com')
    await add.click()
    await expect(dlg.getByText('That address is already allowed.')).toBeVisible()
    await field.fill('https://*.cdn.example.com')
    await add.click()
    await expect(dlg.getByTestId('origin-https://*.cdn.example.com')).toBeVisible()

    await dlg.getByRole('button', { name: 'Done' }).click()
    await shell.getByRole('button', { name: 'Manage Fixture Game' }).click()
    await expect(shell.getByRole('menuitem', { name: /Allowed sites/ })).toHaveText('Allowed sites (2)')
    await shell.getByRole('menuitem', { name: /Allowed sites/ }).click()
    await dialog(shell).getByRole('button', { name: 'Remove https://login.example.com' }).click()
    await expect(dialog(shell).getByTestId('origin-https://login.example.com')).toHaveCount(0)
    expect(await listed()).toEqual(['https://*.cdn.example.com'])
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('settings shows the library and the sync diagnostics, which move with events', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'Main')
    await goTo(shell, 'Settings')
    await expect(shell.getByRole('heading', { name: 'Your library' })).toBeVisible()
    const seqBefore = Number(await shell.getByTestId('settings-seq').innerText())
    await driver.start(a.id)
    await expect.poll(async () => Number(await shell.getByTestId('settings-seq').innerText())).toBeGreaterThan(seqBefore)
    await expect(shell.getByTestId('settings-resyncs')).toHaveText('0')
    await expect(shell.locator('.stat').filter({ hasText: 'Running' }).locator('dd')).toHaveText('1')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('keyboard: navigation by Tab, dialogs close with Escape and hand focus back, Enter submits', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    await shell.keyboard.press('Tab')
    await expect(shell.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Library' })).toBeFocused()

    const addGameButton = topbar(shell).getByRole('button', { name: 'Add game' })
    await addGameButton.focus()
    await shell.keyboard.press('Enter')
    const dlg = dialog(shell)
    await expect(dlg).toBeVisible()
    await expect(dlg.getByLabel('Address')).toBeFocused() // focus moves into the dialog

    // Tab stays inside the dialog: the page behind is inert.
    for (let i = 0; i < 12; i++) {
      await shell.keyboard.press('Tab')
      expect(await shell.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true)
    }

    await shell.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(addGameButton).toBeFocused() // and focus comes back to what opened it

    await addGameButton.focus()
    await shell.keyboard.press('Enter')
    await dlg.getByLabel('Address').fill(site.url)
    await dlg.getByLabel('Name').fill('Typed Game')
    await shell.keyboard.press('Enter') // submits from a field
    await expect(dlg).toHaveCount(0)
    await expect(section(shell, 'Typed Game')).toBeVisible()
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('after a restart the library is what Main restored: running accounts come back, stopped ones stay stopped', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gamehub-ui-restart-'))
  try {
    const first = await Driver.launch(userData)
    await addGame(first.shell, { url: site.url, name: 'Fixture Game', description: 'kept across restarts' })
    await addAccount(first.shell, 'Fixture Game', 'Alpha', { start: true })
    await addAccount(first.shell, 'Fixture Game', 'Bravo')
    await expect(statusOf(first.shell, 'Alpha')).toHaveAttribute('data-status', 'running')
    await first.close()

    const second = await Driver.launch(userData)
    try {
      const { shell } = second
      await expect(section(shell, 'Fixture Game')).toContainText('kept across restarts')
      await expect(statusOf(shell, 'Alpha')).toHaveAttribute('data-status', 'running') // restored by Main
      await expect(statusOf(shell, 'Bravo')).toHaveAttribute('data-status', 'stopped')
      await expect(shell.getByRole('region', { name: 'Running accounts' }).getByRole('button', { name: /Alpha/ })).toBeVisible()
      expect(await second.webContentsCount()).toBe(SHELL + 1) // one restored view, no phantom ones
    } finally {
      await second.close()
    }
  } finally {
    await removeUserData(userData)
  }
})

test('Play on a game starts its stopped accounts, leaves running ones alone and opens them together', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    await driver.createInstance(game.id, 'B')
    await driver.createInstance(game.id, 'C')
    const panel = section(shell, 'Fixture Game')
    await driver.start(a.id) // A is already running: it must not be restarted

    expect(await actionNames(panel.locator('.game-banner'))).toContain('Open') // something runs: the verb is Open
    await expect(panel.locator('.game-counts')).toHaveText('3 accounts, 1 running')
    await driver.stop(a.id)
    await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeVisible() // nothing runs: the verb is Play

    await driver.start(a.id)
    const startsBefore = (await driver.logEvents()).filter((e) => e === 'instance.starting').length
    await panel.locator('.game-banner').getByRole('button', { name: 'Open' }).click()
    await expect(shell.getByTestId('stage')).toBeVisible()
    await expect(shell.getByRole('group', { name: 'Layout' })).toHaveCount(0) // one account is up: nothing to arrange
    await expect(shell.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Play/ })).toHaveAttribute('aria-current', 'page')
    expect((await driver.logEvents()).filter((e) => e === 'instance.starting').length).toBe(startsBefore) // Open starts nothing

    await goTo(shell, 'Library')
    await panel.locator('.game-banner').getByRole('button', { name: 'Open' }).waitFor()
    await driver.stop(a.id)
    await panel.getByRole('button', { name: 'Play', exact: true }).click()
    // It leaves the library once everything is up: three of this game, so the grid.
    await expect(shell.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect((await driver.list()).map((i) => `${i.label}:${i.status}`).sort()).toEqual(['A:running', 'B:running', 'C:running'])
    await expect.poll(async () => (await visibleViews(driver.app)).length).toBe(3)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('menus: they open on the keyboard, move with the arrows, close with Escape and hand focus back', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const game = await driver.createGame('Fixture Game', site.url)
    await driver.createInstance(game.id, 'Main')

    const trigger = shell.getByRole('button', { name: 'Manage Fixture Game' })
    await trigger.focus()
    await shell.keyboard.press('Enter')
    const menu = shell.getByRole('menu', { name: 'Manage Fixture Game' })
    await expect(menu).toBeVisible()
    expect((await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim())).toEqual(['Allowed sites', 'Edit game', 'Remove game'])
    await expect(menu.getByRole('menuitem').first()).toBeFocused() // opens on its first entry
    await shell.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'Edit game' })).toBeFocused()
    await shell.keyboard.press('ArrowUp')
    await shell.keyboard.press('ArrowUp') // wraps
    await expect(menu.getByRole('menuitem', { name: 'Remove game' })).toBeFocused()

    await shell.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()

    // Choosing an entry closes the menu and does what it says; clicking elsewhere closes it too.
    await trigger.click()
    await shell.getByRole('menuitem', { name: 'Edit game' }).click()
    await expect(dialog(shell).getByRole('heading', { name: 'Edit Fixture Game' })).toBeVisible()
    await shell.keyboard.press('Escape')
    await trigger.click()
    await expect(menu).toBeVisible()
    await shell.getByRole('heading', { name: 'Library' }).click()
    await expect(menu).toBeHidden()
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('state is never told by colour alone: ring style, lamp shape and the word differ for every state', async () => {
  const driver = await Driver.launch()
  try {
    const { shell } = driver
    const port = Number(new URL(site.url).port)
    const game = await driver.createGame('Fixture Game', site.url)
    const off = await driver.createInstance(game.id, 'Off')
    const on = await driver.createInstance(game.id, 'On')
    await driver.start(on.id)
    const dead = await driver.createGame('Dead Game', 'http://127.0.0.1:9/')
    const broken = await driver.createInstance(dead.id, 'Broken')
    await driver.start(broken.id).catch(() => undefined)
    void off
    void port
    await expect(statusOf(shell, 'Broken')).toHaveAttribute('data-status', 'error')

    const shapes = await shell.evaluate(() => {
      const read = (label: string) => {
        const row = document.querySelector(`[data-testid="instance-${label}"]`) as HTMLElement
        const portrait = row.querySelector('.portrait') as HTMLElement
        const lamp = row.querySelector('.lamp') as HTMLElement
        return {
          word: (row.querySelector('[data-status]') as HTMLElement).innerText.trim(),
          ring: getComputedStyle(portrait, '::before').borderTopStyle,
          lampRadius: getComputedStyle(lamp).borderTopLeftRadius,
          lampTurned: getComputedStyle(lamp).transform !== 'none',
          lampHollow: getComputedStyle(lamp).backgroundColor === 'rgba(0, 0, 0, 0)',
        }
      }
      return { stopped: read('Off'), running: read('On'), error: read('Broken') }
    })
    expect(shapes.stopped).toMatchObject({ word: 'Stopped', ring: 'dashed', lampHollow: true })
    expect(shapes.running).toMatchObject({ word: 'Running', ring: 'solid', lampHollow: false, lampTurned: false })
    expect(shapes.error).toMatchObject({ word: 'Error', ring: 'solid', lampTurned: true }) // a diamond
    expect(shapes.error.lampRadius).not.toBe(shapes.running.lampRadius) // square-ish, not round
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})
