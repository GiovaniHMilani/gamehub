import { expect, test } from '@playwright/test'
import { startSessionTestSite, type SessionTestSite } from '../fixtures/session-test-site/server'
import { Driver, sessionInfos, setIdentity, snapshot } from './helpers/driver'
import { removeUserData } from './helpers/launch'

let site: SessionTestSite
test.beforeEach(async () => {
  site = await startSessionTestSite()
})
test.afterEach(async () => {
  await site.close()
})

test('two instances of the same game have fully independent browser sessions', async () => {
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    const b = await driver.createInstance(game.id, 'B')

    // Both load exactly the same URL.
    const pageA = await driver.startAndGetPage(a.id, site.url, [])
    const pageB = await driver.startAndGetPage(b.id, site.url, [pageA])
    expect(pageA.url()).toBe(pageB.url())

    // Fresh profiles start empty and distinct.
    const freshA = await snapshot(pageA)
    const freshB = await snapshot(pageB)
    expect(freshA).toMatchObject({ cookie: null, localStorage: null, indexedDB: null, serverCookie: null })
    expect(freshB).toMatchObject({ cookie: null, localStorage: null, indexedDB: null, serverCookie: null })
    expect(freshA.marker).not.toBeNull()
    expect(freshA.marker).not.toBe(freshB.marker)

    // A writes; B must see none of it.
    await setIdentity(pageA, 'ACCOUNT_A')
    const bAfterAWrote = await snapshot(pageB)
    expect(bAfterAWrote).toMatchObject({ cookie: null, sessionCookie: null, serverCookie: null, localStorage: null, indexedDB: null })

    // B writes its own identity.
    await setIdentity(pageB, 'ACCOUNT_B')

    const snapA = await snapshot(pageA)
    const snapB = await snapshot(pageB)

    // A reads ACCOUNT_A in every storage mechanism, including what the server received.
    expect(snapA).toMatchObject({
      cookie: 'ACCOUNT_A',
      sessionCookie: 'ACCOUNT_A',
      serverCookie: 'ACCOUNT_A',
      localStorage: 'ACCOUNT_A',
      indexedDB: 'ACCOUNT_A',
    })
    // B reads ACCOUNT_B.
    expect(snapB).toMatchObject({
      cookie: 'ACCOUNT_B',
      sessionCookie: 'ACCOUNT_B',
      serverCookie: 'ACCOUNT_B',
      localStorage: 'ACCOUNT_B',
      indexedDB: 'ACCOUNT_B',
    })
    // Neither can see the other's data anywhere.
    expect(JSON.stringify(snapA)).not.toContain('ACCOUNT_B')
    expect(JSON.stringify(snapB)).not.toContain('ACCOUNT_A')

    // Independent check from the server: it only ever received null, A or B per request,
    // and it received both (each profile sent its own cookie).
    expect(new Set(site.seenIdentities)).toEqual(new Set([null, 'ACCOUNT_A', 'ACCOUNT_B']))

    // Electron level: two different persistent partitions, neither is the default session.
    const infos = await sessionInfos(driver.app, site.url)
    expect(infos).toHaveLength(2)
    const [first, second] = infos
    expect(first?.storagePath).not.toBe(second?.storagePath)
    for (const info of infos) {
      expect(info.isDefaultSession).toBe(false)
      expect(info.storagePath).toMatch(/Partitions[\\/]gh-[0-9a-f-]{36}$/)
    }
    // Each cookie jar holds exactly one identity, and the two differ.
    const jars = infos.map((i) => i.cookies.filter((c) => c.name === 'identity').map((c) => c.value))
    expect(jars.map((j) => j.length)).toEqual([1, 1])
    expect(new Set(jars.flat())).toEqual(new Set(['ACCOUNT_A', 'ACCOUNT_B']))

    // Cookie values must never reach the logs.
    expect(await driver.readLog()).not.toContain('ACCOUNT_')
  } finally {
    await driver.close()
    await removeUserData(driver.userDataDir)
  }
})
