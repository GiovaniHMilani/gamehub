import Database from 'better-sqlite3'
import { expect, test, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startSessionTestSite, type SessionTestSite } from '../fixtures/session-test-site/server'
import { Driver, sessionInfos, setIdentity, snapshot, type Snap, waitReady } from './helpers/driver'
import { removeUserData } from './helpers/launch'

let site: SessionTestSite
test.beforeEach(async () => {
  site = await startSessionTestSite()
})
test.afterEach(async () => {
  await site.close()
})

/** (marker, identity) identifies a browser profile and what it stored. */
const profileOf = (s: Snap): string => `${s.marker}|${s.localStorage}`

async function allSnapshots(driver: Driver): Promise<Snap[]> {
  const pages: Page[] = driver.gamePages(site.url)
  for (const page of pages) await waitReady(page)
  return Promise.all(pages.map((page) => snapshot(page)))
}

test('sessions of A and B survive closing and reopening GameHub', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gamehub-persist-'))
  try {
    // ---- first run: create A and B, give each its own identity ------------
    const first = await Driver.launch(userData)
    const game = await first.createGame('Fixture Game', site.url)
    const a = await first.createInstance(game.id, 'A')
    const b = await first.createInstance(game.id, 'B')
    const pageA = await first.startAndGetPage(a.id, site.url, [])
    const pageB = await first.startAndGetPage(b.id, site.url, [pageA])
    const writtenA = await setIdentity(pageA, 'ACCOUNT_A')
    const writtenB = await setIdentity(pageB, 'ACCOUNT_B')
    expect(profileOf(writtenA)).not.toBe(profileOf(writtenB))
    const before = new Set([profileOf(writtenA), profileOf(writtenB)])
    await first.close() // graceful quit: views stopped, sessions flushed

    // The sessions are on disk, one directory per account.
    const partitions = (await readdir(join(userData, 'Partitions'))).filter((d) => d.startsWith('gh-'))
    expect(partitions).toHaveLength(2)

    // ---- second run: same userData, nothing is created by the test --------
    const second = await Driver.launch(userData)
    try {
      await second.waitForStatuses({ A: 'running', B: 'running' }) // restored automatically
      expect(await second.list()).toHaveLength(2)

      const after = await allSnapshots(second)
      expect(after).toHaveLength(2)

      // Each restored profile still has its own marker AND its own identity in all stores.
      expect(new Set(after.map(profileOf))).toEqual(before)
      for (const snap of after) {
        expect(['ACCOUNT_A', 'ACCOUNT_B']).toContain(snap.localStorage)
        expect(snap).toMatchObject({
          cookie: snap.localStorage,
          serverCookie: snap.localStorage,
          indexedDB: snap.localStorage,
        })
      }
      expect(new Set(after.map((s) => s.indexedDB))).toEqual(new Set(['ACCOUNT_A', 'ACCOUNT_B']))

      // Still two different partitions after restart.
      const infos = await sessionInfos(second.app, site.url)
      expect(new Set(infos.map((i) => i.storagePath)).size).toBe(2)

      // Session cookies (no expiry) are NOT persisted by Chromium across restarts.
      // Recorded rather than asserted: it is browser behavior, relevant for real games.
      test.info().annotations.push({
        type: 'session-cookie-after-restart',
        description: JSON.stringify(after.map((s) => s.sessionCookie)),
      })

      const events = await second.logEvents()
      expect(events).toEqual(expect.arrayContaining(['restore.begin', 'session.loaded', 'instance.running']))
    } finally {
      await second.close()
    }
  } finally {
    await removeUserData(userData)
  }
})

test('a closed instance is not restored, but keeps its login', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gamehub-closed-'))
  try {
    const first = await Driver.launch(userData)
    const game = await first.createGame('Fixture Game', site.url)
    const a = await first.createInstance(game.id, 'A')
    const b = await first.createInstance(game.id, 'B')
    const pageA = await first.startAndGetPage(a.id, site.url, [])
    await first.startAndGetPage(b.id, site.url, [pageA])
    await setIdentity(pageA, 'ACCOUNT_A')
    await first.stop(a.id) // user closes A
    await first.close()

    const second = await Driver.launch(userData)
    try {
      await second.waitForStatuses({ A: 'stopped', B: 'running' })
      // Re-opening A later shows the login is still there.
      const page = await second.startAndGetPage(a.id, site.url, second.gamePages(site.url))
      expect(await snapshot(page)).toMatchObject({ cookie: 'ACCOUNT_A', localStorage: 'ACCOUNT_A', indexedDB: 'ACCOUNT_A' })
    } finally {
      await second.close()
    }
  } finally {
    await removeUserData(userData)
  }
})

test('removing A deletes A everywhere and leaves B untouched', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gamehub-remove-'))
  try {
    const first = await Driver.launch(userData)
    const game = await first.createGame('Fixture Game', site.url)
    const a = await first.createInstance(game.id, 'A')
    const b = await first.createInstance(game.id, 'B')
    const pageA = await first.startAndGetPage(a.id, site.url, [])
    const pageB = await first.startAndGetPage(b.id, site.url, [pageA])
    await setIdentity(pageA, 'ACCOUNT_A')
    await setIdentity(pageB, 'ACCOUNT_B')

    // Locate A's partition directory by the identity in its cookie jar.
    const infos = await sessionInfos(first.app, site.url)
    const dirA = infos.find((i) => i.cookies.some((c) => c.name === 'identity' && c.value === 'ACCOUNT_A'))?.storagePath
    expect(dirA).toMatch(/gh-[0-9a-f-]{36}$/)

    await first.remove(a.id)

    expect((await first.list()).map((i) => i.label)).toEqual(['B'])
    await expect.poll(() => first.gamePages(site.url).length).toBe(1)
    expect(await snapshot(pageB)).toMatchObject({ cookie: 'ACCOUNT_B', localStorage: 'ACCOUNT_B', indexedDB: 'ACCOUNT_B' })

    // A brand-new account of the same game gets a clean, different session.
    const c = await first.createInstance(game.id, 'C')
    const pageC = await first.startAndGetPage(c.id, site.url, [pageB])
    expect(await snapshot(pageC)).toMatchObject({ cookie: null, localStorage: null, indexedDB: null, serverCookie: null })
    const afterInfos = await sessionInfos(first.app, site.url)
    expect(afterInfos.map((i) => i.storagePath)).not.toContain(dirA)
    await first.close()

    // ---- next boot: the tombstone is processed before any session loads -----
    const second = await Driver.launch(userData)
    try {
      await second.waitForStatuses({ B: 'running', C: 'running' })
      expect(existsSync(dirA as string)).toBe(false)

      const db = new Database(join(userData, 'gamehub.db'), { readonly: true })
      try {
        const accounts = db.prepare('select label from game_accounts order by label').all()
        const instances = db.prepare('select count(*) as n from game_instances').get() as { n: number }
        const tombstones = db.prepare('select count(*) as n from partition_tombstones').get() as { n: number }
        expect(accounts).toEqual([{ label: 'B' }, { label: 'C' }])
        expect(instances.n).toBe(2) // no orphan instance rows
        expect(tombstones.n).toBe(0)
      } finally {
        db.close()
      }

      // B is intact after the removal and the restart; C is still empty; A's data is nowhere.
      const identities = (await allSnapshots(second)).map((s) => s.localStorage)
      expect(identities).toHaveLength(2)
      expect(identities).toContain('ACCOUNT_B')
      expect(identities).toContain(null)
      expect(identities).not.toContain('ACCOUNT_A')
    } finally {
      await second.close()
    }
  } finally {
    await removeUserData(userData)
  }
})
