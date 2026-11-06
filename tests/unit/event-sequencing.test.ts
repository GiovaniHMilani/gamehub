import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InstanceSummary } from '@shared/domain/types'
import { applyEvent, fromSnapshot, InstanceSyncEngine, type SyncState, type SyncView } from '@shared/ipc/event-sync'
import type { InstanceEvent, InstancesSnapshot } from '@shared/ipc/instance-events'
import type { Result } from '@shared/ipc/result'
import { InstanceEventPublisher } from '../../src/main/ipc/event-publisher'
import { deferred, makeHarness, type Harness } from './helpers/fakes'

const inst = (id: string, status: InstanceSummary['status'] = 'stopped'): InstanceSummary => ({
  id,
  gameId: 'g',
  accountId: `acc-${id}`,
  label: id,
  status,
  errorCode: null,
  restoreOnLaunch: false,
})
const changed = (seq: number, instance: InstanceSummary): InstanceEvent => ({ seq, type: 'instance.changed', instance })
const removed = (seq: number, instanceId: string): InstanceEvent => ({ seq, type: 'instance.removed', instanceId })

describe('InstanceEventPublisher (Main owns seq)', () => {
  it('starts at 1 and increases by exactly 1 per event, across event types', () => {
    const publisher = new InstanceEventPublisher()
    expect(publisher.currentSeq).toBe(0)
    const seen: InstanceEvent[] = []
    publisher.subscribe((e) => seen.push(e))
    publisher.publish({ type: 'instance.changed', instance: inst('a') })
    publisher.publish({ type: 'instance.removed', instanceId: 'a' })
    publisher.publish({ type: 'instance.changed', instance: inst('b') })
    expect(seen.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(seen.map((e) => e.type)).toEqual(['instance.changed', 'instance.removed', 'instance.changed'])
    expect(publisher.currentSeq).toBe(3)
  })

  it('every subscriber sees the same sequence; unsubscribed ones see nothing', () => {
    const publisher = new InstanceEventPublisher()
    const a: number[] = []
    const b: number[] = []
    publisher.subscribe((e) => a.push(e.seq))
    const off = publisher.subscribe((e) => b.push(e.seq))
    publisher.publish({ type: 'instance.removed', instanceId: 'x' })
    off()
    publisher.publish({ type: 'instance.removed', instanceId: 'x' })
    expect(a).toEqual([1, 2])
    expect(b).toEqual([1])
  })

  it('a throwing subscriber breaks neither the others nor the sequence', () => {
    const publisher = new InstanceEventPublisher()
    const ok: number[] = []
    publisher.subscribe(() => {
      throw new Error('boom')
    })
    publisher.subscribe((e) => ok.push(e.seq))
    publisher.publish({ type: 'instance.removed', instanceId: 'x' })
    publisher.publish({ type: 'instance.removed', instanceId: 'x' })
    expect(ok).toEqual([1, 2])
  })
})

describe('applyEvent', () => {
  const base: SyncState = { seq: 10, instances: [inst('a'), inst('b')] }

  it('applies the next event: upsert and removal', () => {
    const upd = applyEvent(base, changed(11, inst('a', 'running')))
    expect(upd).toMatchObject({ kind: 'applied', state: { seq: 11 } })
    if (upd.kind === 'applied') expect(upd.state.instances.map((i) => `${i.id}:${i.status}`)).toEqual(['a:running', 'b:stopped'])

    const add = applyEvent(base, changed(11, inst('c')))
    if (add.kind === 'applied') expect(add.state.instances.map((i) => i.id)).toEqual(['a', 'b', 'c'])

    const rem = applyEvent(base, removed(11, 'a'))
    if (rem.kind === 'applied') expect(rem.state.instances.map((i) => i.id)).toEqual(['b'])
    expect(applyEvent(base, removed(11, 'ghost'))).toMatchObject({ kind: 'applied' }) // removing the unknown is a no-op
  })

  it('ignores duplicates and events already covered by the snapshot', () => {
    expect(applyEvent(base, changed(10, inst('a', 'running')))).toEqual({ kind: 'ignored' })
    expect(applyEvent(base, changed(3, inst('a', 'running')))).toEqual({ kind: 'ignored' })
    expect(applyEvent(base, removed(10, 'a'))).toEqual({ kind: 'ignored' })
  })

  it('detects a lost event: 42, 44 is a gap', () => {
    const at42: SyncState = { seq: 42, instances: [] }
    expect(applyEvent(at42, changed(43, inst('a')))).toMatchObject({ kind: 'applied' })
    expect(applyEvent(at42, changed(44, inst('a')))).toEqual({ kind: 'gap', expected: 43, got: 44 })
    expect(applyEvent(at42, removed(500, 'a'))).toEqual({ kind: 'gap', expected: 43, got: 500 })
  })

  it('never mutates its input', () => {
    const frozen: SyncState = Object.freeze({ seq: 1, instances: Object.freeze([inst('a')]) })
    expect(() => applyEvent(frozen, changed(2, inst('a', 'running')))).not.toThrow()
    expect(frozen.instances[0]?.status).toBe('stopped')
  })
})

describe('InstanceSyncEngine', () => {
  const ok = (data: InstancesSnapshot): Result<InstancesSnapshot> => ({ ok: true, data })
  let listeners: Set<(e: InstanceEvent) => void>
  let views: SyncView[]
  let snapshots: Array<() => Promise<Result<InstancesSnapshot>>>
  let calls: number

  const make = (): InstanceSyncEngine =>
    new InstanceSyncEngine({
      snapshot: () => {
        calls++
        const next = snapshots.shift()
        if (next === undefined) throw new Error('unexpected snapshot call')
        return next()
      },
      subscribe: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      onChange: (v) => views.push(v),
    })
  const emit = (e: InstanceEvent): void => listeners.forEach((l) => l(e))
  const last = (): SyncView => views.at(-1) as SyncView
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

  beforeEach(() => {
    listeners = new Set()
    views = []
    snapshots = []
    calls = 0
  })

  it('subscribes before the snapshot and replays only newer events', async () => {
    const gate = deferred<Result<InstancesSnapshot>>()
    snapshots.push(() => gate.promise)
    const engine = make()
    engine.start()
    expect(listeners.size).toBe(1) // subscribed while the snapshot is still in flight

    // Arrive during the in-flight snapshot: 5 is older than the snapshot, 6 and 7 are newer.
    emit(changed(5, inst('a', 'starting')))
    emit(changed(6, inst('a', 'running')))
    emit(changed(7, inst('b')))
    expect(views).toHaveLength(0) // nothing applied before the base state exists

    gate.resolve(ok({ seq: 5, instances: [inst('a', 'starting')] }))
    await flush()

    expect(last()).toMatchObject({ seq: 7, resyncs: 0 })
    expect(last().instances.map((i) => `${i.id}:${i.status}`)).toEqual(['a:running', 'b:stopped'])
    engine.stop()
  })

  it('applies live events in order and ignores duplicates', async () => {
    snapshots.push(() => Promise.resolve(ok({ seq: 0, instances: [] })))
    make().start()
    await flush()
    emit(changed(1, inst('a')))
    emit(changed(1, inst('a', 'running'))) // duplicate seq with different content: ignored
    emit(changed(2, inst('a', 'running')))
    expect(last()).toMatchObject({ seq: 2, resyncs: 0 })
    expect(last().instances[0]?.status).toBe('running')
  })

  it('removal arrives as an event and updates the state', async () => {
    snapshots.push(() => Promise.resolve(ok({ seq: 3, instances: [inst('a'), inst('b')] })))
    make().start()
    await flush()
    emit(removed(4, 'a'))
    expect(last().instances.map((i) => i.id)).toEqual(['b'])
    expect(last().seq).toBe(4)
  })

  it('a gap discards the event, takes a new snapshot and counts the resync', async () => {
    snapshots.push(() => Promise.resolve(ok({ seq: 42, instances: [inst('a')] })))
    snapshots.push(() => Promise.resolve(ok({ seq: 44, instances: [inst('a', 'running')] })))
    make().start()
    await flush()
    emit(changed(44, inst('zzz'))) // 43 was lost
    await flush()

    expect(calls).toBe(2)
    expect(last()).toMatchObject({ seq: 44, resyncs: 1 })
    expect(last().instances.map((i) => i.id)).toEqual(['a']) // the out-of-order event was NOT applied
    expect(last().instances[0]?.status).toBe('running')
  })

  it('events that arrive during a gap-triggered resync are buffered, not lost', async () => {
    snapshots.push(() => Promise.resolve(ok({ seq: 1, instances: [] })))
    const gate = deferred<Result<InstancesSnapshot>>()
    snapshots.push(() => gate.promise)
    make().start()
    await flush()
    emit(changed(9, inst('x'))) // gap -> resync starts
    emit(changed(11, inst('b'))) // arrives while resyncing
    gate.resolve(ok({ seq: 10, instances: [inst('a')] }))
    await flush()
    expect(last()).toMatchObject({ seq: 11 })
    expect(last().instances.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('a failed snapshot keeps the previous state; the next gap retries', async () => {
    snapshots.push(() => Promise.resolve(ok({ seq: 1, instances: [inst('a')] })))
    snapshots.push(() => Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'x' } }))
    snapshots.push(() => Promise.resolve(ok({ seq: 8, instances: [inst('a', 'running')] })))
    make().start()
    await flush()
    emit(changed(5, inst('a'))) // gap, resync fails
    await flush()
    expect(last()).toMatchObject({ seq: 1 })
    expect(last().instances.map((i) => i.id)).toEqual(['a'])
    emit(changed(7, inst('a'))) // still a gap -> retried, succeeds
    await flush()
    expect(last()).toMatchObject({ seq: 8 })
  })

  it('stop() removes the listener and ignores later events and snapshots', async () => {
    const gate = deferred<Result<InstancesSnapshot>>()
    snapshots.push(() => gate.promise)
    const engine = make()
    engine.start()
    engine.stop()
    expect(listeners.size).toBe(0)
    gate.resolve(ok({ seq: 1, instances: [inst('a')] }))
    await flush()
    expect(views).toHaveLength(0)
  })

  it('start/stop/start (StrictMode) leaves exactly one listener', async () => {
    snapshots.push(() => Promise.resolve(ok({ seq: 0, instances: [] })))
    snapshots.push(() => Promise.resolve(ok({ seq: 0, instances: [] })))
    const a = make()
    a.start()
    a.stop()
    make().start()
    await flush()
    expect(listeners.size).toBe(1)
  })

  it('fromSnapshot keeps seq and instances', () => {
    expect(fromSnapshot({ seq: 9, instances: [inst('a')] })).toEqual({ seq: 9, instances: [inst('a')] })
  })
})

describe('InstanceManager removal event', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(() => h.db.close())

  it('emits removed (with the id) after the final changed event, and only on success', async () => {
    const a = h.manager.createInstance({ gameId: h.gameId, label: 'A' })
    await h.manager.start(a.id)
    const order: string[] = []
    h.manager.onChange((s) => order.push(`changed:${s.status}`))
    h.manager.onRemoved((id) => order.push(`removed:${id === a.id ? 'A' : '?'}`))

    await h.manager.remove(a.id)
    expect(order.at(-1)).toBe('removed:A')
    expect(order).toEqual(['changed:stopping', 'changed:stopped', 'removed:A'])

    // A failed removal (unknown id) emits nothing.
    const before = order.length
    expect(() => h.manager.remove(a.id)).toThrow()
    expect(order).toHaveLength(before)
  })

  it('sequenced end to end: changed and removed get consecutive seq values', async () => {
    const publisher = new InstanceEventPublisher()
    h.manager.onChange((instance) => publisher.publish({ type: 'instance.changed', instance }))
    h.manager.onRemoved((instanceId) => publisher.publish({ type: 'instance.removed', instanceId }))
    const seen: InstanceEvent[] = []
    publisher.subscribe((e) => seen.push(e))

    const a = h.manager.createInstance({ gameId: h.gameId, label: 'A' })
    await h.manager.start(a.id)
    await h.manager.remove(a.id)

    expect(seen.map((e) => e.seq)).toEqual(seen.map((_, i) => i + 1))
    expect(seen.at(-1)).toMatchObject({ type: 'instance.removed', instanceId: a.id })
    // Replaying the stream on an empty base reproduces the final (empty) state.
    let state: SyncState = { seq: 0, instances: [] }
    for (const e of seen) {
      const outcome = applyEvent(state, e)
      expect(outcome.kind).toBe('applied')
      if (outcome.kind === 'applied') state = outcome.state
    }
    expect(state.instances).toEqual([])
  })
})
