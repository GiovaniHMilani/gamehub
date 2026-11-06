import { expect, test } from '@playwright/test'
import { EVENTS } from '../../src/shared/ipc/channels'
import type { InstanceEvent } from '../../src/shared/ipc/instance-events'
import { startSessionTestSite } from '../fixtures/session-test-site/server'
import { Driver } from './helpers/driver'
import { removeUserData } from './helpers/launch'

declare global {
  interface Window {
    __events?: InstanceEvent[]
  }
}

test('the renderer receives sequenced events: contiguous, monotonic, removal included', async () => {
  const site = await startSessionTestSite()
  const driver = await Driver.launch()
  try {
    // A second, independent subscriber in the shell page records everything it receives.
    await driver.shell.evaluate(() => {
      window.__events = []
      window.gamehub.instances.onChanged((event) => window.__events?.push(event))
    })
    const snapshot = await driver.shell.evaluate(() => window.gamehub.instances.snapshot())
    expect(snapshot.ok && typeof snapshot.data.seq === 'number').toBe(true)
    const base = snapshot.ok ? snapshot.data.seq : -1

    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A')
    await driver.start(a.id)
    await driver.stop(a.id)
    await driver.remove(a.id)

    const events = (await driver.shell.evaluate(() => window.__events ?? [])) as InstanceEvent[]
    expect(events).toHaveLength(6) // created, starting, running, stopping, stopped, removed
    // Every event carries seq; they continue exactly where the snapshot ended, with no holes.
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => base + 1 + i))
    expect(events.map((e) => e.type)).toContain('instance.changed')

    const last = events.at(-1)
    expect(last).toMatchObject({ type: 'instance.removed', instanceId: a.id })
    const statuses = events.filter((e) => e.type === 'instance.changed').map((e) => (e.type === 'instance.changed' ? e.instance.status : ''))
    expect(statuses).toEqual(['stopped', 'starting', 'running', 'stopping', 'stopped'])

    // The snapshot after the removal agrees with where the stream ended.
    const after = await driver.shell.evaluate(() => window.gamehub.instances.snapshot())
    expect(after).toMatchObject({ ok: true, data: { seq: last?.seq, instances: [] } })
  } finally {
    await driver.close()
    await site.close()
    await removeUserData(driver.userDataDir)
  }
})

test('the panel learns about a removal from the event alone', async () => {
  const site = await startSessionTestSite()
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    const a = await driver.createInstance(game.id, 'A') // created through the API, not through the panel
    await expect(driver.shell.getByTestId('instance-A')).toBeVisible() // arrived as an event

    await driver.remove(a.id)
    await expect(driver.shell.getByTestId('instance-A')).toHaveCount(0) // no click, no manual refresh
  } finally {
    await driver.close()
    await site.close()
    await removeUserData(driver.userDataDir)
  }
})

test('the real renderer detects a lost event, ignores duplicates and recovers by snapshot', async () => {
  const site = await startSessionTestSite()
  const driver = await Driver.launch()
  try {
    const game = await driver.createGame('Fixture Game', site.url)
    await driver.createInstance(game.id, 'A')
    const status = driver.shell.getByTestId('sync-status')
    await expect(driver.shell.getByTestId('instance-A')).toBeVisible()
    await expect(status).toContainText('resyncs 0')

    const current = async (): Promise<number> => {
      const snap = await driver.shell.evaluate(() => window.gamehub.instances.snapshot())
      return snap.ok ? snap.data.seq : -1
    }
    const forge = (event: InstanceEvent): Promise<void> =>
      driver.app.evaluate(({ BrowserWindow }, { channel, payload }) => {
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().startsWith('app://gamehub'))
          ?.webContents.send(channel, payload)
      }, { channel: EVENTS.instancesEvent, payload: event })

    const seq = await current()
    const bogus = { id: 'forged', gameId: 'g', accountId: 'a', label: 'Forged', status: 'running', errorCode: null, restoreOnLaunch: false } as const

    // Duplicate/old seq: ignored. Nothing changes, no resync.
    await forge({ seq: 1, type: 'instance.changed', instance: bogus })
    await expect(driver.shell.getByTestId('instance-Forged')).toHaveCount(0)
    await expect(status).toContainText('resyncs 0')

    // A hole in the sequence: the event is NOT applied, the renderer resyncs from Main.
    await forge({ seq: seq + 50, type: 'instance.changed', instance: bogus })
    await expect(status).toContainText('resyncs 1')
    await expect(status).toContainText(`seq ${seq}`)
    await expect(driver.shell.getByTestId('instance-Forged')).toHaveCount(0)
    await expect(driver.shell.getByTestId('instance-A')).toBeVisible()

    // And live updates keep working after the resync.
    await driver.start((await driver.list())[0]?.id as string)
    await expect(driver.shell.getByTestId('instance-A').locator('[data-status]')).toHaveText('running')
    await expect(status).toContainText('resyncs 1')
  } finally {
    await driver.close()
    await site.close()
    await removeUserData(driver.userDataDir)
  }
})
