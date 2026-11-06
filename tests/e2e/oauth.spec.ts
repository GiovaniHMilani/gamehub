import { basename, join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { startOAuthTestSite, type OAuthTestSite } from '../fixtures/oauth-test-site/server'
import { Driver, sessionInfos, snapshot, waitReady } from './helpers/driver'
import { removeUserData } from './helpers/launch'
import {
  closeProviderPopups,
  EMPTY_PROVIDER,
  openOAuthPopup,
  popupSessionReport,
  providerState,
  signInInPopup,
  storagePathOf,
  tryOpen,
} from './helpers/oauth'

let site: OAuthTestSite
test.beforeEach(async () => {
  site = await startOAuthTestSite()
})
test.afterEach(async () => {
  await site.close()
})

const SHELL = 1

test('OAuth popups run in the session of the instance that opened them; A and B stay isolated', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('OAuth Game', site.gameUrl, [site.providerOrigin])
    const a = await driver.createInstance(game.id, 'A')
    const b = await driver.createInstance(game.id, 'B')
    const pageA = await driver.startAndGetPage(a.id, site.gameUrl, [])
    const pageB = await driver.startAndGetPage(b.id, site.gameUrl, [pageA])
    const markerA = (await snapshot(pageA)).marker as string
    const markerB = (await snapshot(pageB)).marker as string
    expect(markerA).not.toBe(markerB)

    // ---- A: popup -> same session as A, never B's, never the default ----------
    const popupA = await openOAuthPopup(driver, site, pageA)
    const reportA = await popupSessionReport(driver.app, site)
    expect(reportA?.views.find((v) => v.marker === markerA)?.sameSessionAsPopup).toBe(true)
    expect(reportA?.views.find((v) => v.marker === markerB)?.sameSessionAsPopup).toBe(false)
    expect(reportA?.popupStoragePath).toBe(reportA?.views.find((v) => v.marker === markerA)?.storagePath)
    expect(reportA?.popupStoragePath).toMatch(/Partitions[\\/]gh-[0-9a-f-]{36}$/)

    // The popup is a sandboxed remote page: no Node, no bridge.
    const exposure = await popupA.evaluate(() => {
      const g = globalThis as unknown as Record<string, unknown>
      return [typeof g['require'], typeof g['process'], typeof g['gamehub'], typeof g['electron']]
    })
    expect(exposure).toEqual(['undefined', 'undefined', 'undefined', 'undefined'])

    // A's provider-side storage starts empty, then A signs in through the popup.
    expect(await providerState(popupA)).toEqual(EMPTY_PROVIDER)
    await signInInPopup(popupA, pageA, 'ACCOUNT_A')
    expect(await snapshot(pageA)).toMatchObject({ cookie: 'ACCOUNT_A', serverCookie: 'ACCOUNT_A', localStorage: 'ACCOUNT_A', indexedDB: 'ACCOUNT_A' })
    expect(await snapshot(pageB)).toMatchObject({ cookie: null, serverCookie: null, localStorage: null, indexedDB: null }) // B untouched

    // ---- B: its popup sees NOTHING of A's provider login -----------------------
    const popupB = await openOAuthPopup(driver, site, pageB)
    const reportB = await popupSessionReport(driver.app, site)
    expect(reportB?.views.find((v) => v.marker === markerB)?.sameSessionAsPopup).toBe(true)
    expect(reportB?.views.find((v) => v.marker === markerA)?.sameSessionAsPopup).toBe(false)
    expect(await providerState(popupB)).toEqual(EMPTY_PROVIDER)
    await signInInPopup(popupB, pageB, 'ACCOUNT_B')

    // ---- Game-origin state: A is A, B is B -------------------------------------
    const snapA = await snapshot(pageA)
    const snapB = await snapshot(pageB)
    expect(snapA).toMatchObject({ cookie: 'ACCOUNT_A', serverCookie: 'ACCOUNT_A', localStorage: 'ACCOUNT_A', indexedDB: 'ACCOUNT_A' })
    expect(snapB).toMatchObject({ cookie: 'ACCOUNT_B', serverCookie: 'ACCOUNT_B', localStorage: 'ACCOUNT_B', indexedDB: 'ACCOUNT_B' })
    expect(JSON.stringify(snapA)).not.toContain('ACCOUNT_B')
    expect(JSON.stringify(snapB)).not.toContain('ACCOUNT_A')

    // ---- Provider-origin state, read back through fresh popups ----------------
    const popupA2 = await openOAuthPopup(driver, site, pageA)
    expect(await providerState(popupA2)).toEqual({ cookie: 'ACCOUNT_A', serverCookie: 'ACCOUNT_A', localStorage: 'ACCOUNT_A', indexedDB: 'ACCOUNT_A' })
    await closeProviderPopups(driver.app, site)
    await popupA2.waitForEvent('close')
    const popupB2 = await openOAuthPopup(driver, site, pageB)
    expect(await providerState(popupB2)).toEqual({ cookie: 'ACCOUNT_B', serverCookie: 'ACCOUNT_B', localStorage: 'ACCOUNT_B', indexedDB: 'ACCOUNT_B' })
    await closeProviderPopups(driver.app, site)
    await popupB2.waitForEvent('close')

    // ---- Cookie jars (Electron level): each session holds its own pair only ----
    const jars = (await sessionInfos(driver.app, site.gameUrl)).map((info) => ({
      game: info.cookies.find((c) => c.name === 'identity')?.value,
      provider: info.cookies.find((c) => c.name === 'provider_user')?.value,
    }))
    expect(jars).toHaveLength(2)
    for (const jar of jars) expect(jar.game).toBe(jar.provider) // the provider login lives next to ITS account's game login
    expect(new Set(jars.map((j) => j.game))).toEqual(new Set(['ACCOUNT_A', 'ACCOUNT_B']))

    // The default session never saw any of it.
    const defaults = await driver.app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({})).map((c) => c.name))
    expect(defaults).not.toContain('provider_user')
    expect(defaults).not.toContain('identity')

    // Nothing left behind: shell + 2 game views, and every created popup was closed.
    expect(await driver.webContentsCount()).toBe(SHELL + 2)
    const events = await driver.logEvents()
    expect(events.filter((e) => e === 'popup.created')).toHaveLength(4)
    expect(events.filter((e) => e === 'popup.closed')).toHaveLength(4)
    expect(await driver.readLog()).not.toContain('ACCOUNT_') // no credentials in logs
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('a login made through the popup survives restarting GameHub, per account', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gamehub-oauth-'))
  try {
    const first = await Driver.launch(userData)
    const game = await first.createGame('OAuth Game', site.gameUrl, [site.providerOrigin])
    const a = await first.createInstance(game.id, 'A')
    const b = await first.createInstance(game.id, 'B')
    const pageA = await first.startAndGetPage(a.id, site.gameUrl, [])
    const pageB = await first.startAndGetPage(b.id, site.gameUrl, [pageA])
    const markers = [(await snapshot(pageA)).marker, (await snapshot(pageB)).marker]
    await signInInPopup(await openOAuthPopup(first, site, pageA), pageA, 'ACCOUNT_A')
    await signInInPopup(await openOAuthPopup(first, site, pageB), pageB, 'ACCOUNT_B')
    await first.close()

    const second = await Driver.launch(userData)
    try {
      await second.waitForStatuses({ A: 'running', B: 'running' })
      const pages = second.gamePages(site.gameUrl)
      expect(pages).toHaveLength(2)
      const pairs: string[] = []
      for (const page of pages) {
        await waitReady(page)
        const snap = await snapshot(page)
        const popup = await openOAuthPopup(second, site, page)
        const provider = await providerState(popup)
        await closeProviderPopups(second.app, site)
        await popup.waitForEvent('close')
        // Game login and provider login both survived, and belong together.
        expect(provider).toEqual({ cookie: snap.localStorage, serverCookie: snap.localStorage, localStorage: snap.localStorage, indexedDB: snap.localStorage })
        pairs.push(`${snap.marker}|${snap.localStorage}`)
      }
      expect(new Set(pairs)).toEqual(new Set([`${markers[0]}|ACCOUNT_A`, `${markers[1]}|ACCOUNT_B`]))
    } finally {
      await second.close()
    }
  } finally {
    await removeUserData(userData)
  }
})

test('popup policy: only allowed origins open; everything else is denied and creates no window', async () => {
  const driver = await Driver.launch()
  try {
    const strict = await driver.createGame('Strict Game', site.gameUrl) // no extra origins
    const open = await driver.createGame('OAuth Game', site.gameUrl, [site.providerOrigin])
    const s = await driver.createInstance(strict.id, 'S')
    const a = await driver.createInstance(open.id, 'A')
    const b = await driver.createInstance(open.id, 'B')
    const pageS = await driver.startAndGetPage(s.id, site.gameUrl, [])
    const pageA = await driver.startAndGetPage(a.id, site.gameUrl, [pageS])
    const pageB = await driver.startAndGetPage(b.id, site.gameUrl, [pageS, pageA])
    const baseline = driver.app.windows().length
    const baselineContents = await driver.webContentsCount()
    const denials = async (): Promise<Array<Record<string, unknown>>> =>
      (await driver.logRecords()).filter((r) => r['event'] === 'popup.denied')

    // 1. A game that never allowed the provider cannot open it.
    expect(await tryOpen(pageS, site.authorizeUrl())).toBe(false)
    expect((await denials()).at(-1)).toMatchObject({ reason: 'origin_not_allowed' })

    // 2. Even a game that allows the provider cannot open anything else.
    const forbidden = [
      'https://evil.example/',
      'http://evil.example/', // not https
      `${site.providerOrigin.replace('localhost', '127.0.0.1')}/authorize`, // same port, different host
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,hi',
      'about:blank',
    ]
    for (const url of forbidden) expect(await tryOpen(pageA, url), url).toBe(false)
    expect(await tryOpen(pageA, '')).toBe(false)
    expect(driver.app.windows().length).toBe(baseline)
    expect(await driver.webContentsCount()).toBe(baselineContents)

    // 3. The allowed popup opens; while it is open no second popup and no chain.
    const popup = await openOAuthPopup(driver, site, pageA)
    expect(await tryOpen(pageA, site.authorizeUrl())).toBe(false) // second popup from the game
    expect((await denials()).at(-1)).toMatchObject({ reason: 'too_many_open' })
    const nested = await popup.evaluate((url) => window.open(url) === null, site.authorizeUrl())
    expect(nested).toBe(true) // denied: window.open returned null
    expect((await denials()).at(-1)).toMatchObject({ reason: 'nested_popup' })
    expect(driver.app.windows().length).toBe(baseline + 1) // only the one popup exists

    // 4. The popup cannot navigate to a forbidden origin.
    void popup.evaluate(() => { location.href = 'https://evil.example/' }).catch(() => undefined)
    await expect.poll(async () => (await driver.logEvents()).includes('popup.navigation_blocked')).toBe(true)
    expect(popup.url().startsWith(site.providerUrl)).toBe(true)
    await closeProviderPopups(driver.app, site)
    await popup.waitForEvent('close')

    // 5. A page cannot steer the popup into another account's session or weaken it via `features`.
    const markerB = (await snapshot(pageB)).marker as string
    const partitionB = `persist:${basename(await storagePathOf(driver.app, site, markerB))}`
    expect(partitionB).toMatch(/^persist:gh-[0-9a-f-]{36}$/)
    const attackFeatures = `width=480,height=640,nodeIntegration=yes,contextIsolation=no,sandbox=no,webviewTag=yes,partition=${partitionB}`
    expect(await tryOpen(pageA, site.authorizeUrl(), attackFeatures)).toBe(true) // the origin is allowed, the extras are not honoured
    let attacked: (typeof popup) | undefined
    await expect.poll(() => (attacked = driver.app.windows().find((p) => p.url().startsWith(site.providerUrl))) !== undefined).toBe(true)
    if (attacked !== undefined) await waitReady(attacked)
    const attackReport = await popupSessionReport(driver.app, site)
    const markerA = (await snapshot(pageA)).marker
    expect(attackReport?.views.find((v) => v.marker === markerA)?.sameSessionAsPopup).toBe(true)
    expect(attackReport?.views.find((v) => v.marker === markerB)?.sameSessionAsPopup).toBe(false)
    expect(attackReport?.popupStoragePath).not.toContain(basename(partitionB.replace('persist:', '')))
    const powers = await attacked?.evaluate(() => {
      const g = globalThis as unknown as Record<string, unknown>
      return [typeof g['require'], typeof g['process'], typeof g['gamehub']]
    })
    expect(powers).toEqual(['undefined', 'undefined', 'undefined'])
    await closeProviderPopups(driver.app, site)
    await attacked?.waitForEvent('close')

    // Nothing leaked from any of this.
    expect(driver.app.windows().length).toBe(baseline)
    expect(await driver.webContentsCount()).toBe(baselineContents)
    const records = await driver.logRecords()
    expect(records.filter((r) => r['event'] === 'popup.session_mismatch' || r['event'] === 'popup.insecure_preferences')).toHaveLength(0)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('popup policy: a burst of popups is limited to 5 per minute', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('OAuth Game', site.gameUrl, [site.providerOrigin])
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])

    const results: boolean[] = []
    for (let i = 0; i < 7; i++) {
      const opened = await tryOpen(page, site.authorizeUrl())
      results.push(opened)
      if (opened) {
        await expect.poll(() => driver.app.windows().some((p) => p.url().startsWith(site.providerUrl))).toBe(true)
        await closeProviderPopups(driver.app, site)
        await expect.poll(() => driver.app.windows().some((p) => p.url().startsWith(site.providerUrl))).toBe(false)
      }
    }
    expect(results).toEqual([true, true, true, true, true, false, false]) // 5 per minute, then denied
    expect((await driver.logRecords()).filter((r) => r['event'] === 'popup.denied' && r['reason'] === 'rate_limited')).toHaveLength(2)
    expect(await driver.webContentsCount()).toBe(SHELL + 1)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})

test('popup cleanup: stopping the instance, or quitting the app, closes its popups', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gamehub-popup-clean-'))
  try {
    const driver = await Driver.launch(userData)
    const game = await driver.createGame('OAuth Game', site.gameUrl, [site.providerOrigin])
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])

    // The user closing the popup frees its webContents, and a new one can open afterwards.
    const first = await openOAuthPopup(driver, site, page)
    expect(await driver.webContentsCount()).toBe(SHELL + 2)
    await closeProviderPopups(driver.app, site)
    await first.waitForEvent('close')
    await expect.poll(() => driver.webContentsCount()).toBe(SHELL + 1)

    // Stopping the instance while a popup is open destroys the popup with it.
    const second = await openOAuthPopup(driver, site, page)
    expect(await driver.webContentsCount()).toBe(SHELL + 2)
    const closed = second.waitForEvent('close')
    await driver.stop(a.id)
    await closed
    expect(await driver.webContentsCount()).toBe(SHELL)
    const events = await driver.logEvents()
    expect(events.filter((e) => e === 'popup.created')).toHaveLength(2)
    expect(events.filter((e) => e === 'popup.closed')).toHaveLength(2)

    // After a restart the instance gets a fresh controller: popups work again.
    await driver.start(a.id)
    const page2 = driver.gamePages(site.gameUrl)[0]
    if (page2 !== undefined) await waitReady(page2)
    const third = await openOAuthPopup(driver, site, page2 as typeof page)
    expect(third.url().startsWith(site.providerUrl)).toBe(true)

    // Quitting with a popup open must neither hang nor leave the database inconsistent.
    await driver.close()
    const again = await Driver.launch(userData)
    try {
      await again.waitForStatuses({ A: 'running' })
      expect((await again.list())[0]?.restoreOnLaunch).toBe(true)
    } finally {
      await again.close()
    }
  } finally {
    await removeUserData(userData)
  }
})

test('a top-level redirect to a provider is blocked until its origin is allowed, then works at once', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Redirect Game', site.gameUrl) // no provider origin yet
    const a = await driver.createInstance(game.id, 'A')
    const page = await driver.startAndGetPage(a.id, site.gameUrl, [])

    // The game itself navigates to the provider (redirect flow, no popup): blocked, as seen in the field.
    void page.evaluate((url) => { location.href = url }, site.authorizeUrl()).catch(() => undefined)
    await expect.poll(async () => (await driver.logRecords()).some((r) => r['event'] === 'navigation.blocked')).toBe(true)
    expect(page.url().startsWith(site.gameUrl)).toBe(true)
    const blocked = (await driver.logRecords()).filter((r) => r['event'] === 'navigation.blocked').at(-1)
    expect(blocked?.['url']).toBe(`${site.providerOrigin}/authorize`) // origin + path only: no query, no token

    // Invalid origins are rejected and change nothing.
    const bad = await driver.shell.evaluate(
      (id) => window.gamehub.games.setAllowedOrigins({ gameId: id, allowedOrigins: ['http://accounts.google.com'] }),
      game.id,
    )
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })

    // Allow the provider. It applies to the RUNNING instance: no restart needed.
    const updated = await driver.shell.evaluate(
      ([id, origin]) => window.gamehub.games.setAllowedOrigins({ gameId: id as string, allowedOrigins: [origin as string] }),
      [game.id, site.providerOrigin],
    )
    expect(updated).toMatchObject({ ok: true, data: { allowedOrigins: [site.providerOrigin] } })
    expect((await driver.logEvents())).toContain('view.allowed_origins_updated')

    const blockedBefore = (await driver.logRecords()).filter((r) => r['event'] === 'navigation.blocked').length
    void page.evaluate((url) => { location.href = url }, site.authorizeUrl()).catch(() => undefined)
    await expect.poll(() => page.url().startsWith(site.providerUrl)).toBe(true) // same view, now allowed
    expect((await driver.logRecords()).filter((r) => r['event'] === 'navigation.blocked').length).toBe(blockedBefore)
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})
