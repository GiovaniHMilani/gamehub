import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '../../src/main/errors'
import { makeHarness, type Harness } from './helpers/fakes'

let h: Harness
beforeEach(() => {
  h = makeHarness()
})
afterEach(() => h.db.close())

const create = (label = 'Account') => h.manager.createInstance({ gameId: h.gameId, label })

function statusesOf(id: string): string[] {
  const seen: string[] = []
  h.manager.onChange((s) => {
    if (s.id === id && seen.at(-1) !== s.status) seen.push(s.status)
  })
  return seen
}

describe('create', () => {
  it('creates an instance with its own account, stopped, not restored', () => {
    const a = create('A')
    expect(a).toMatchObject({ gameId: h.gameId, label: 'A', status: 'stopped', errorCode: null, restoreOnLaunch: false })
    expect(h.manager.list()).toHaveLength(1)
    expect(h.sink.events()).toEqual(expect.arrayContaining(['instance.created', 'session.created']))
  })

  it('rejects an unknown game', () => {
    expect(() => h.manager.createInstance({ gameId: crypto.randomUUID(), label: 'x' })).toThrow(DomainError)
  })

  it('gives every instance a distinct account and partition', () => {
    const a = create('A')
    const b = create('B')
    expect(a.accountId).not.toBe(b.accountId)
    expect(h.sessions.identityOf(a.accountId).partitionName).not.toBe(h.sessions.identityOf(b.accountId).partitionName)
  })
})

describe('lifecycle', () => {
  it('walks stopped -> starting -> running -> stopping -> stopped', async () => {
    const a = create()
    const seen = statusesOf(a.id)

    const running = await h.manager.start(a.id)
    expect(running.status).toBe('running')
    expect(h.host.mountedIds.has(a.id)).toBe(true)

    const stopped = await h.manager.stop(a.id)
    expect(stopped.status).toBe('stopped')
    expect(seen).toEqual(['starting', 'running', 'stopping', 'stopped'])
    expect(h.sink.events()).toEqual(
      expect.arrayContaining(['instance.starting', 'instance.running', 'instance.stopping', 'instance.stopped']),
    )
  })

  it('releases everything on stop: no view, no listener, no live runtime', async () => {
    const a = create()
    await h.manager.start(a.id)
    expect(h.host.listenerCount(a.id)).toBe(1)
    await h.manager.stop(a.id)
    expect(h.host.mountedIds.size).toBe(0)
    expect(h.host.listenerCount(a.id)).toBe(0)
    expect(h.manager.liveRuntimeCount).toBe(0)
    expect(h.host.mounts).toBe(h.host.unmounts)
  })

  it('start on a running instance is a no-op; stop on a stopped one too', async () => {
    const a = create()
    await h.manager.start(a.id)
    await h.manager.start(a.id)
    expect(h.host.mounts).toBe(1)
    await h.manager.stop(a.id)
    await expect(h.manager.stop(a.id)).resolves.toMatchObject({ status: 'stopped' })
  })

  it('binds each instance to its own session and the game origin only', async () => {
    const a = create('A')
    const b = create('B')
    await h.manager.start(a.id)
    await h.manager.start(b.id)
    const sa = h.host.sessionsByInstance.get(a.id)
    const sb = h.host.sessionsByInstance.get(b.id)
    expect(sa).toBeDefined()
    expect(sb).toBeDefined()
    expect(sa).not.toBe(sb)
    expect(sa?.partitionName).toBe(h.sessions.identityOf(a.accountId).partitionName)
    expect(h.host.originsByInstance.get(a.id)).toEqual(['https://game.example'])
  })

  it('reuses the same session after stop + start (login survives close)', async () => {
    const a = create()
    await h.manager.start(a.id)
    const first = h.host.sessionsByInstance.get(a.id)
    await h.manager.stop(a.id)
    await h.manager.start(a.id)
    expect(h.host.sessionsByInstance.get(a.id)).toBe(first)
    expect(first?.cleared).toBe(0)
  })

  it('reports a load failure as error and recovers via restart', async () => {
    const a = create()
    h.host.loadMode = { fail: 'ERR_CONNECTION_REFUSED' }
    const failed = await h.manager.start(a.id)
    expect(failed).toMatchObject({ status: 'error', errorCode: 'ERR_CONNECTION_REFUSED' })
    expect(h.host.mountedIds.size).toBe(0) // the failed view was torn down
    expect(h.sink.events()).toContain('instance.error')

    h.host.loadMode = 'ok'
    const recovered = await h.manager.restart(a.id)
    expect(recovered).toMatchObject({ status: 'running', errorCode: null })
  })

  it('moves to crashed when the renderer dies, and restart recovers it', async () => {
    const a = create()
    await h.manager.start(a.id)
    h.host.crash(a.id, 'oom')
    expect(h.manager.get(a.id).status).toBe('crashed')
    expect(h.sink.events()).toContain('instance.crashed')

    const restarted = await h.manager.restart(a.id)
    expect(restarted.status).toBe('running')
    expect(h.host.mounts).toBe(2)
    expect(h.host.mounts - h.host.unmounts).toBe(1) // exactly one live view
  })

  it('persists restore intent: true after start, false after stop', async () => {
    const a = create()
    await h.manager.start(a.id)
    expect(h.manager.get(a.id).restoreOnLaunch).toBe(true)
    await h.manager.stop(a.id)
    expect(h.manager.get(a.id).restoreOnLaunch).toBe(false)
  })
})

describe('concurrency', () => {
  it('coalesces simultaneous starts into one mount', async () => {
    const a = create()
    const results = await Promise.all([h.manager.start(a.id), h.manager.start(a.id), h.manager.start(a.id)])
    expect(results.every((r) => r.status === 'running')).toBe(true)
    expect(h.host.mounts).toBe(1)
    expect(h.host.listenerCount(a.id)).toBe(1)
  })

  it('coalesces simultaneous starts of a failing instance into one attempt', async () => {
    const a = create()
    h.host.loadMode = { fail: 'ERR_CONNECTION_REFUSED' }
    const results = await Promise.all([h.manager.start(a.id), h.manager.start(a.id), h.manager.start(a.id)])
    expect(results.every((r) => r.status === 'error')).toBe(true)
    expect(h.host.mounts).toBe(1)
  })

  it('start, stop, start ends running with exactly one live view', async () => {
    const a = create()
    const first = h.manager.start(a.id)
    const stop = h.manager.stop(a.id)
    const second = h.manager.start(a.id)
    const settled = await Promise.allSettled([first, stop, second])

    expect(settled[2]).toMatchObject({ status: 'fulfilled', value: { status: 'running' } })
    expect(h.manager.get(a.id).status).toBe('running')
    expect(h.host.mounts - h.host.unmounts).toBe(1)
    expect(h.host.mountedIds.size).toBe(1)
    expect(h.host.listenerCount(a.id)).toBe(1)
  })

  it('stop aborts a start that is stuck loading', async () => {
    const a = create()
    h.host.loadMode = 'hold'
    const start = h.manager.start(a.id)
    const startOutcome = start.catch((e: unknown) => e)
    await Promise.resolve() // let the start reach loadUrl
    await new Promise((r) => setImmediate(r))
    expect(h.manager.get(a.id).status).toBe('starting')

    const stopped = await h.manager.stop(a.id)
    expect(stopped.status).toBe('stopped')
    expect(await startOutcome).toBeInstanceOf(DomainError)
    expect(h.host.mountedIds.size).toBe(0)
    expect(h.manager.liveRuntimeCount).toBe(0)
  })

  it('a stop issued right after start() cancels the queued start', async () => {
    const a = create()
    const start = h.manager.start(a.id).catch((e: unknown) => e)
    const stop = h.manager.stop(a.id)
    await Promise.all([start, stop])
    expect(h.manager.get(a.id).status).toBe('stopped')
    expect(h.host.mounts).toBe(0)
  })

  it('serializes many mixed commands without corrupting state', async () => {
    const a = create()
    const ops: Array<Promise<unknown>> = []
    for (let i = 0; i < 20; i++) {
      ops.push(h.manager.start(a.id).catch(() => undefined))
      ops.push(h.manager.stop(a.id).catch(() => undefined))
      ops.push(h.manager.restart(a.id).catch(() => undefined))
    }
    await Promise.all(ops)
    await h.manager.stop(a.id)
    expect(h.manager.get(a.id).status).toBe('stopped')
    expect(h.host.mountedIds.size).toBe(0)
    expect(h.host.mounts).toBe(h.host.unmounts)
    expect(h.manager.liveRuntimeCount).toBe(0)
  })

  it('different instances start in parallel and stay independent', async () => {
    const a = create('A')
    const b = create('B')
    await Promise.all([h.manager.start(a.id), h.manager.start(b.id)])
    await h.manager.stop(a.id)
    expect(h.manager.get(a.id).status).toBe('stopped')
    expect(h.manager.get(b.id).status).toBe('running')
  })
})

describe('remove', () => {
  it('removes only the target: rows, view and session data', async () => {
    const a = create('A')
    const b = create('B')
    await h.manager.start(a.id)
    await h.manager.start(b.id)
    const identityA = h.sessions.identityOf(a.accountId)
    const sessionA = h.host.sessionsByInstance.get(a.id)

    await h.manager.remove(a.id)

    expect(h.manager.list().map((i) => i.id)).toEqual([b.id])
    expect(h.manager.get(b.id).status).toBe('running')
    expect(sessionA?.cleared).toBe(1)
    expect(h.host.mountedIds.has(a.id)).toBe(false)
    expect(h.host.mountedIds.has(b.id)).toBe(true)
    expect(h.repos.tombstones.list()).toEqual([identityA.partitionId])
    expect(h.repos.instances.getPartitionId(a.accountId)).toBeUndefined()
    expect(() => h.manager.get(a.id)).toThrow(DomainError)
    expect(h.sessions.loadedCount).toBe(1)
  })

  it('removes a running instance that never finished loading', async () => {
    const a = create()
    h.host.loadMode = 'hold'
    const start = h.manager.start(a.id).catch(() => undefined)
    await new Promise((r) => setImmediate(r))
    await h.manager.remove(a.id)
    await start
    expect(h.manager.list()).toHaveLength(0)
    expect(h.host.mountedIds.size).toBe(0)
    expect(h.manager.liveRuntimeCount).toBe(0)
  })

  it('a new instance never inherits a removed instance session', async () => {
    const a = create('A')
    await h.manager.start(a.id)
    const removedPartition = h.sessions.identityOf(a.accountId).partitionName
    await h.manager.remove(a.id)

    const c = create('C')
    await h.manager.start(c.id)
    expect(h.sessions.identityOf(c.accountId).partitionName).not.toBe(removedPartition)
    expect(h.host.sessionsByInstance.get(c.id)?.partitionName).not.toBe(removedPartition)
  })

  it('commands on a removed instance fail with NOT_FOUND', async () => {
    const a = create()
    await h.manager.remove(a.id)
    expect(() => h.manager.start(a.id)).toThrow(DomainError)
    expect(() => h.manager.stop(a.id)).toThrow(DomainError)
  })
})

describe('restore and shutdown', () => {
  it('restore starts only instances flagged restoreOnLaunch', async () => {
    const a = create('A')
    const b = create('B')
    const c = create('C')
    await h.manager.start(a.id)
    await h.manager.start(b.id)
    await h.manager.stop(b.id) // user closed B: not restored
    await h.manager.shutdown()

    // "new process": fresh manager over the same database
    const second = makeHarnessOver(h)
    await second.restore()
    expect(second.get(a.id).status).toBe('running')
    expect(second.get(b.id).status).toBe('stopped')
    expect(second.get(c.id).status).toBe('stopped')
  })

  it('shutdown stops every view but keeps restore intent', async () => {
    const a = create('A')
    await h.manager.start(a.id)
    await h.manager.shutdown()
    expect(h.host.mountedIds.size).toBe(0)
    expect(h.manager.liveRuntimeCount).toBe(0)
    expect(h.repos.instances.getRecord(a.id)?.instance.restoreOnLaunch).toBe(true)
    expect(() => h.manager.start(a.id)).toThrow(DomainError) // closed for business
  })

  it('a failing instance does not block restoring the others', async () => {
    const a = create('A')
    const b = create('B')
    await h.manager.start(a.id)
    await h.manager.start(b.id)
    await h.manager.shutdown()

    const second = makeHarnessOver(h)
    h.host.loadMode = { fail: 'ERR_NAME_NOT_RESOLVED' }
    await second.restore()
    expect(second.get(a.id).status).toBe('error')
    expect(second.get(b.id).status).toBe('error')
    expect(second.get(a.id).restoreOnLaunch).toBe(true) // retried next launch
  })
})

import { InstanceManager } from '../../src/main/instances/instance-manager'
import type { FakeSession } from './helpers/fakes'

/** A second InstanceManager over the same DB/sessions, simulating an app restart. */
function makeHarnessOver(base: Harness): InstanceManager<FakeSession> {
  base.host.mountedIds.clear()
  return new InstanceManager<FakeSession>({
    repos: base.repos,
    sessions: base.sessions,
    host: base.host,
    log: { debug() {}, info() {}, warn() {}, error() {}, child() { return this } },
  })
}
