import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameSummary, InstanceSummary, Notice } from '@shared/domain/types'
import type { InstanceEvent } from '@shared/ipc/instance-events'
import type { Result } from '@shared/ipc/result'
import {
  updateGame,
  confirmRemoveGame,
  confirmRemoveInstance,
  createAccount,
  createGame,
  focusInstance,
  performInstanceAction,
  resolveNotice,
  setGameOrigins,
} from '../../src/renderer/stores/actions'
import { useDomainStore } from '../../src/renderer/stores/domain-store'
import { useNoticeStore } from '../../src/renderer/stores/notice-store'
import { startSync, type SyncApi } from '../../src/renderer/stores/sync'
import { useUiStore } from '../../src/renderer/stores/ui-store'
import { deferred } from './helpers/fakes'

const game = (id: string, name = 'Game'): GameSummary => ({ id, name, startUrl: `https://${id}.example/`, description: '', createdAt: 1, allowedOrigins: [] })
const inst = (id: string, gameId = 'g1', label = id, status: InstanceSummary['status'] = 'stopped'): InstanceSummary => ({
  id,
  gameId,
  accountId: `acc-${id}`,
  label,
  status,
  errorCode: null,
  restoreOnLaunch: false,
})
const ok = <T,>(data: T): Result<T> => ({ ok: true, data })
const fail = (code: 'NOT_FOUND' | 'INVALID_STATE' | 'INVALID_ARGUMENT' | 'INTERNAL', message = 'raw internal detail /Users/x/secret.db'): Result<never> => ({
  ok: false,
  error: { code, message },
})

/** A fake of the typed preload API. Every method is a spy; the defaults succeed. */
function makeApi(over: { start?: () => Promise<Result<InstanceSummary>>; stop?: () => Promise<Result<InstanceSummary>> } = {}) {
  const listeners = new Set<(e: InstanceEvent) => void>()
  const noticeListeners = new Set<(n: readonly Notice[]) => void>()
  const api = {
    games: {
      list: vi.fn(async () => ok([game('g1', 'Poke Idle')] as readonly GameSummary[])),
      create: vi.fn(async (input: { name: string }) => ok({ ...game('gnew', input.name) })),
      setAllowedOrigins: vi.fn(async (input: { gameId: string }) => ok(game(input.gameId))),
      remove: vi.fn(async () => ok(null)),
      update: vi.fn(async (input: { gameId: string; name: string }) => ok(game(input.gameId, input.name))),
    },
    instances: {
      snapshot: vi.fn(async () => ok({ seq: 0, instances: [] as readonly InstanceSummary[] })),
      onChanged: vi.fn((l: (e: InstanceEvent) => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      }),
      start: vi.fn(over.start ?? (async () => ok(inst('i1', 'g1', 'a', 'running')))),
      stop: vi.fn(over.stop ?? (async () => ok(inst('i1', 'g1', 'a', 'stopped')))),
      restart: vi.fn(async () => ok(inst('i1', 'g1', 'a', 'running'))),
      focus: vi.fn(async () => ok(inst('i1', 'g1', 'a', 'running'))),
      create: vi.fn(async (input: { label: string }) => ok(inst('inew', 'g1', input.label))),
      remove: vi.fn(async () => ok(null)),
    },
    notices: {
      list: vi.fn(async () => ok([] as readonly Notice[])),
      resolve: vi.fn(async () => ok(null)),
      onChanged: vi.fn((l: (n: readonly Notice[]) => void) => {
        noticeListeners.add(l)
        return () => noticeListeners.delete(l)
      }),
    },
  }
  return {
    api: api as unknown as SyncApi & typeof api & Parameters<typeof performInstanceAction>[0],
    spies: api,
    emit: (event: InstanceEvent) => listeners.forEach((l) => l(event)),
    pushNotices: (list: readonly Notice[]) => noticeListeners.forEach((l) => l(list)),
    listenerCount: () => listeners.size + noticeListeners.size,
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const ui = () => useUiStore.getState()
const texts = (): string[] => ui().toasts.map((t) => t.text)

beforeEach(() => {
  useDomainStore.getState().reset()
  useUiStore.getState().reset()
  useNoticeStore.getState().setNotices([])
})

describe('performInstanceAction', () => {
  it('open navigates to Play and calls nothing', async () => {
    const { api, spies } = makeApi()
    await performInstanceAction(api, 'i1', 'open')
    expect(ui()).toMatchObject({ screen: 'play', focusedInstanceId: 'i1' })
    expect(spies.instances.start).not.toHaveBeenCalled()
  })

  it('remove only opens the confirmation: nothing is deleted without it', async () => {
    const { api, spies } = makeApi()
    await performInstanceAction(api, 'i1', 'remove')
    expect(ui().dialog).toEqual({ kind: 'confirmRemove', instanceId: 'i1' })
    expect(spies.instances.remove).not.toHaveBeenCalled()
  })

  it.each(['start', 'stop', 'restart'] as const)('%s calls the API once and leaves no pending state', async (action) => {
    const { api, spies } = makeApi()
    await performInstanceAction(api, 'i1', action)
    expect(spies.instances[action]).toHaveBeenCalledWith('i1')
    expect(spies.instances[action]).toHaveBeenCalledTimes(1)
    expect(ui().pending).toEqual({})
    expect(ui().toasts).toEqual([]) // success is shown by the row changing state, not by a toast
  })

  it('a double click on the same action is ignored while it is in flight', async () => {
    const gate = deferred<Result<InstanceSummary>>()
    const { api, spies } = makeApi({ start: () => gate.promise })
    const first = performInstanceAction(api, 'i1', 'start')
    await performInstanceAction(api, 'i1', 'start')
    await performInstanceAction(api, 'i1', 'start')
    expect(spies.instances.start).toHaveBeenCalledTimes(1)
    expect(ui().pending).toEqual({ i1: 'start' })
    gate.resolve(ok(inst('i1', 'g1', 'a', 'running')))
    await first
    expect(ui().pending).toEqual({})
    await performInstanceAction(api, 'i1', 'start') // possible again afterwards
    expect(spies.instances.start).toHaveBeenCalledTimes(2)
  })

  it('Cancel (stop) still works while a start is in flight', async () => {
    const gate = deferred<Result<InstanceSummary>>()
    const { api, spies } = makeApi({ start: () => gate.promise })
    const starting = performInstanceAction(api, 'i1', 'start')
    await performInstanceAction(api, 'i1', 'stop')
    expect(spies.instances.stop).toHaveBeenCalledTimes(1)
    gate.resolve(fail('INVALID_STATE'))
    await starting
  })

  it('different instances do not block each other', async () => {
    const gate = deferred<Result<InstanceSummary>>()
    const { api, spies } = makeApi({ start: () => gate.promise })
    const first = performInstanceAction(api, 'i1', 'start')
    const second = performInstanceAction(api, 'i2', 'start')
    expect(spies.instances.start).toHaveBeenCalledTimes(2) // both went out; neither waited for the other
    expect(ui().pending).toEqual({ i1: 'start', i2: 'start' })
    gate.resolve(ok(inst('i1')))
    await Promise.all([first, second])
    expect(ui().pending).toEqual({})
  })

  it('a failure becomes a short sentence: no code, no raw message, no path', async () => {
    const { api } = makeApi({ start: async () => fail('INVALID_STATE') })
    await performInstanceAction(api, 'i1', 'start')
    expect(ui().toasts).toHaveLength(1)
    expect(ui().toasts[0]?.tone).toBe('error')
    const text = texts()[0] ?? ''
    expect(text).toMatch(/start it/)
    expect(text).not.toMatch(/INVALID_STATE|secret|\/Users|\.db/)
    expect(ui().pending).toEqual({}) // and the button is usable again
  })

  it('a rejected IPC call (not a Result) is also handled', async () => {
    const { api } = makeApi({
      stop: async () => {
        throw new Error('Error invoking remote method: No handler registered')
      },
    })
    await performInstanceAction(api, 'i1', 'stop')
    expect(texts()[0]).toMatch(/stop it/)
    expect(texts()[0]).not.toMatch(/handler|invoking/i)
    expect(ui().pending).toEqual({})
  })
})

describe('confirmRemoveInstance', () => {
  it('removes, confirms by name, and reports success', async () => {
    useDomainStore.getState().setGames([game('g1')])
    useDomainStore.getState().applySync({ seq: 1, instances: [inst('i1', 'g1', 'main')], resyncs: 0 })
    const { api, spies } = makeApi()
    expect(await confirmRemoveInstance(api, 'i1')).toBe(true)
    expect(spies.instances.remove).toHaveBeenCalledWith('i1')
    expect(texts()).toEqual(['main was removed.'])
  })
  it('an instance that is already gone counts as removed, without an error', async () => {
    const { api } = makeApi()
    api.instances.remove.mockResolvedValueOnce(fail('NOT_FOUND'))
    expect(await confirmRemoveInstance(api, 'i1')).toBe(true)
    expect(ui().toasts).toEqual([])
  })
  it('a real failure keeps the dialog open (returns false) and explains', async () => {
    const { api } = makeApi()
    api.instances.remove.mockResolvedValueOnce(fail('INTERNAL'))
    expect(await confirmRemoveInstance(api, 'i1')).toBe(false)
    expect(texts()[0]).toMatch(/remove it/)
    api.instances.remove.mockRejectedValueOnce(new Error('boom'))
    expect(await confirmRemoveInstance(api, 'i1')).toBe(false)
  })
})

describe('updateGame', () => {
  const input = { gameId: 'g1', name: 'New Name', startUrl: 'https://new.example/', description: '' }
  it('saves through the API, refreshes the library and confirms by name', async () => {
    const { api, spies } = makeApi()
    const result = await updateGame(api, input)
    expect(result.ok).toBe(true)
    expect(spies.games.update).toHaveBeenCalledWith(input)
    expect(spies.games.list).toHaveBeenCalledTimes(1)
    expect(texts()).toEqual(['Saved changes to New Name.'])
  })
  it('hands a failure back to the form, with no toast and no refresh', async () => {
    const { api, spies } = makeApi()
    api.games.update.mockResolvedValueOnce(fail('INVALID_ARGUMENT'))
    const result = await updateGame(api, input)
    expect(result.ok).toBe(false)
    expect(ui().toasts).toEqual([])
    expect(spies.games.list).not.toHaveBeenCalled()
  })
})

describe('confirmRemoveGame', () => {
  beforeEach(() => useDomainStore.getState().setGames([game('g1', 'Poke Idle')]))

  it('removes through the API, refreshes the library and confirms by name', async () => {
    const { api, spies } = makeApi()
    expect(await confirmRemoveGame(api, 'g1')).toBeNull()
    expect(spies.games.remove).toHaveBeenCalledWith('g1')
    expect(spies.games.list).toHaveBeenCalledTimes(1)
    expect(texts()).toEqual(['Poke Idle was removed.'])
  })
  it('a game that is already gone counts as removed, silently', async () => {
    const { api } = makeApi()
    api.games.remove.mockResolvedValueOnce(fail('NOT_FOUND'))
    expect(await confirmRemoveGame(api, 'g1')).toBeNull()
    expect(ui().toasts).toEqual([])
  })
  it('a failure returns a plain sentence for the dialog, with no code or detail, and still refreshes', async () => {
    const { api, spies } = makeApi()
    api.games.remove.mockResolvedValueOnce(fail('INTERNAL', 'SQLITE_CONSTRAINT /Users/x/gamehub.db'))
    const message = await confirmRemoveGame(api, 'g1')
    expect(message).toMatch(/remove it/)
    expect(message).not.toMatch(/SQLITE|INTERNAL|\/Users|\.db/)
    expect(spies.games.list).toHaveBeenCalled() // some accounts may already be gone
    expect(ui().toasts).toEqual([]) // the dialog shows it, not a toast behind the backdrop
  })
  it('INVALID_STATE (an account appeared meanwhile) is explained too', async () => {
    const { api } = makeApi()
    api.games.remove.mockResolvedValueOnce(fail('INVALID_STATE'))
    expect(await confirmRemoveGame(api, 'g1')).toMatch(/Wait for the current step/)
  })
  it('a rejected IPC call is handled', async () => {
    const { api } = makeApi()
    api.games.remove.mockRejectedValueOnce(new Error('No handler registered'))
    const message = await confirmRemoveGame(api, 'g1')
    expect(message).toMatch(/remove it/)
    expect(message).not.toMatch(/handler/i)
  })
})

describe('creating', () => {
  it('createGame refreshes the library and confirms', async () => {
    const { api, spies } = makeApi()
    const result = await createGame(api, { name: 'New Game', startUrl: 'https://x.example/' })
    expect(result.ok).toBe(true)
    expect(spies.games.list).toHaveBeenCalledTimes(1)
    expect(useDomainStore.getState().gamesLoaded).toBe(true)
    expect(texts()).toEqual(['New Game was added to your library.'])
  })
  it('createGame returns the failure for the form to show, and shows no toast', async () => {
    const { api } = makeApi()
    api.games.create.mockResolvedValueOnce(fail('INVALID_ARGUMENT'))
    const result = await createGame(api, { name: 'x', startUrl: 'file:///etc/passwd' })
    expect(result.ok).toBe(false)
    expect(ui().toasts).toEqual([])
  })
  it('createAccount confirms, and starts it only when asked', async () => {
    useDomainStore.getState().setGames([game('g1', 'Poke Idle')])
    const { api, spies } = makeApi()
    await createAccount(api, { gameId: 'g1', label: 'alt' }, { startAfter: false })
    expect(texts()).toEqual(['alt was added to Poke Idle.'])
    expect(spies.instances.start).not.toHaveBeenCalled()
    await createAccount(api, { gameId: 'g1', label: 'alt2' }, { startAfter: true })
    await flush()
    expect(spies.instances.start).toHaveBeenCalledWith('inew')
  })
  it('createAccount does not start or confirm when creation fails', async () => {
    const { api, spies } = makeApi()
    api.instances.create.mockResolvedValueOnce(fail('NOT_FOUND'))
    const result = await createAccount(api, { gameId: 'gone', label: 'x' }, { startAfter: true })
    expect(result.ok).toBe(false)
    expect(spies.instances.start).not.toHaveBeenCalled()
    expect(ui().toasts).toEqual([])
  })
  it('setGameOrigins goes through the validated IPC and refreshes', async () => {
    const { api, spies } = makeApi()
    await setGameOrigins(api, 'g1', ['https://discord.com'])
    expect(spies.games.setAllowedOrigins).toHaveBeenCalledWith({ gameId: 'g1', allowedOrigins: ['https://discord.com'] })
    expect(spies.games.list).toHaveBeenCalled()
  })
})

describe('resolveNotice and focus', () => {
  const notice = (kind: Notice['kind']): Notice => ({
    id: 'n1',
    instanceId: 'i1',
    instanceLabel: 'teste',
    gameId: 'g1',
    gameName: 'Poke Idle',
    origin: 'https://discord.com',
    kind,
  })
  it('allow: says what happened (and, for a popup, what to do next) and refreshes games', async () => {
    const { api, spies } = makeApi()
    await resolveNotice(api, notice('navigation'), 'allow')
    expect(texts()).toEqual(['Allowed https://discord.com for Poke Idle and retried.'])
    await resolveNotice(api, notice('popup'), 'allow')
    expect(texts()[1]).toBe('Allowed https://discord.com. Click the sign-in button again.')
    expect(spies.games.list).toHaveBeenCalledTimes(2)
    expect(spies.notices.resolve).toHaveBeenCalledWith({ noticeId: 'n1', decision: 'allow' })
  })
  it('dismiss is silent', async () => {
    const { api } = makeApi()
    await resolveNotice(api, notice('navigation'), 'dismiss')
    expect(ui().toasts).toEqual([])
  })
  it('a failure (stale notice) is explained, not hidden', async () => {
    const { api } = makeApi()
    api.notices.resolve.mockResolvedValueOnce(fail('NOT_FOUND'))
    await resolveNotice(api, notice('navigation'), 'allow')
    expect(texts()).toHaveLength(1)
    expect(texts()[0]).not.toMatch(/Allowed/)
  })
  it('focusInstance never throws, even when the IPC call rejects', async () => {
    const { api } = makeApi()
    api.instances.focus.mockRejectedValueOnce(new Error('x'))
    await expect(focusInstance(api, 'i1')).resolves.toBeUndefined()
  })
})

describe('startSync: loading, events, errors and recovery', () => {
  it('goes loading -> ready once snapshot AND games have arrived', async () => {
    const { api } = makeApi()
    const handle = startSync(api)
    expect(useDomainStore.getState().status).toBe('loading')
    await flush()
    expect(useDomainStore.getState()).toMatchObject({ status: 'ready', seq: 0 })
    handle.stop()
  })

  it('applies events from Main, including removal', async () => {
    const { api, emit } = makeApi()
    const handle = startSync(api)
    await flush()
    emit({ seq: 1, type: 'instance.changed', instance: inst('i1', 'g1', 'main', 'starting') })
    emit({ seq: 2, type: 'instance.changed', instance: inst('i1', 'g1', 'main', 'running') })
    expect(useDomainStore.getState().instancesById['i1']?.status).toBe('running')
    expect(useDomainStore.getState().runningIds).toEqual(['i1'])
    emit({ seq: 3, type: 'instance.removed', instanceId: 'i1' })
    expect(useDomainStore.getState().instancesById['i1']).toBeUndefined()
    expect(useDomainStore.getState().seq).toBe(3)
    handle.stop()
  })

  it('a lost event triggers a resync and the store converges on the snapshot', async () => {
    const { api, emit, spies } = makeApi()
    const handle = startSync(api)
    await flush()
    spies.instances.snapshot.mockResolvedValueOnce(ok({ seq: 9, instances: [inst('i1', 'g1', 'main', 'running')] }))
    emit({ seq: 5, type: 'instance.changed', instance: inst('zz', 'g1', 'forged', 'running') }) // 1-4 never arrived
    await flush()
    expect(spies.instances.snapshot).toHaveBeenCalledTimes(2)
    expect(useDomainStore.getState().instancesById['zz']).toBeUndefined() // the out-of-order event was not applied
    expect(useDomainStore.getState()).toMatchObject({ seq: 9, resyncs: 1 })
    handle.stop()
  })

  it('events arriving while the first snapshot is in flight are not lost or applied twice', async () => {
    const gate = deferred<Result<{ seq: number; instances: readonly InstanceSummary[] }>>()
    const { api, emit, spies } = makeApi()
    spies.instances.snapshot.mockReturnValueOnce(gate.promise)
    const handle = startSync(api)
    emit({ seq: 5, type: 'instance.changed', instance: inst('i1', 'g1', 'main', 'starting') }) // older than the snapshot
    emit({ seq: 6, type: 'instance.changed', instance: inst('i1', 'g1', 'main', 'running') })
    gate.resolve(ok({ seq: 5, instances: [inst('i1', 'g1', 'main', 'starting')] }))
    await flush()
    expect(useDomainStore.getState().instancesById['i1']?.status).toBe('running')
    expect(useDomainStore.getState().seq).toBe(6)
    handle.stop()
  })

  it('a failing first snapshot shows the error state, and retry recovers', async () => {
    const { api, spies } = makeApi()
    spies.instances.snapshot.mockResolvedValueOnce(fail('INTERNAL'))
    const handle = startSync(api)
    await flush()
    expect(useDomainStore.getState().status).toBe('error')
    handle.retry()
    expect(useDomainStore.getState().status).toBe('loading')
    await flush()
    expect(useDomainStore.getState().status).toBe('ready')
    handle.stop()
  })

  it('a REJECTED snapshot call is the same error state, not an unhandled rejection', async () => {
    const { api, spies } = makeApi()
    spies.instances.snapshot.mockRejectedValueOnce(new Error('No handler registered'))
    const handle = startSync(api)
    await flush()
    expect(useDomainStore.getState().status).toBe('error')
    handle.stop()
  })

  it('a failing games list shows the error state before the library exists', async () => {
    const { api, spies } = makeApi()
    spies.games.list.mockResolvedValueOnce(fail('INTERNAL'))
    const handle = startSync(api)
    await flush()
    expect(useDomainStore.getState().status).toBe('error')
    handle.stop()
  })

  it('a failing refresh later keeps the library and only tells the user', async () => {
    const { api, spies } = makeApi()
    const handle = startSync(api)
    await flush()
    spies.games.list.mockResolvedValueOnce(fail('INTERNAL'))
    await createGame(api, { name: 'x', startUrl: 'https://x.example/' })
    expect(useDomainStore.getState().status).toBe('ready')
    expect(texts().some((t) => /refresh/.test(t))).toBe(true)
    handle.stop()
  })

  it('an instance of an unknown game triggers ONE games refresh', async () => {
    const { api, emit, spies } = makeApi()
    const handle = startSync(api)
    await flush()
    const before = spies.games.list.mock.calls.length
    spies.games.list.mockResolvedValue(ok([game('g1'), game('brandnew')] as readonly GameSummary[]))
    emit({ seq: 1, type: 'instance.changed', instance: inst('i1', 'brandnew', 'a') })
    emit({ seq: 2, type: 'instance.changed', instance: inst('i1', 'brandnew', 'a', 'starting') })
    await flush()
    expect(spies.games.list.mock.calls.length).toBe(before + 1)
    expect(useDomainStore.getState().gameById['brandnew']).toBeDefined()
    handle.stop()
  })

  it('notices: a pushed list is never overwritten by an older fetch', async () => {
    const gate = deferred<Result<readonly Notice[]>>()
    const { api, pushNotices, spies } = makeApi()
    spies.notices.list.mockReturnValueOnce(gate.promise)
    const handle = startSync(api)
    const pushed: Notice = { id: 'n', instanceId: 'i', instanceLabel: 'l', gameId: 'g', gameName: 'G', origin: 'https://a.example', kind: 'navigation' }
    pushNotices([pushed])
    gate.resolve(ok([])) // the older answer arrives last
    await flush()
    expect(useNoticeStore.getState().notices).toEqual([pushed])
    handle.stop()
  })

  it('stop() removes every listener: nothing leaks and later events do nothing', async () => {
    const { api, emit, listenerCount } = makeApi()
    const handle = startSync(api)
    await flush()
    expect(listenerCount()).toBe(2)
    handle.stop()
    expect(listenerCount()).toBe(0)
    emit({ seq: 1, type: 'instance.changed', instance: inst('i1') })
    expect(useDomainStore.getState().instancesById['i1']).toBeUndefined()
  })

  it('start, stop, start (React StrictMode) leaves exactly one live subscription', async () => {
    const { api, listenerCount } = makeApi()
    startSync(api).stop()
    const handle = startSync(api)
    await flush()
    expect(listenerCount()).toBe(2)
    handle.stop()
  })
})
