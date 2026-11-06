import { beforeEach, describe, expect, it } from 'vitest'
import type { GameSummary, InstanceSummary } from '@shared/domain/types'
import { useDomainStore } from '../../src/renderer/stores/domain-store'
import { useNoticeStore } from '../../src/renderer/stores/notice-store'
import { useUiStore } from '../../src/renderer/stores/ui-store'

const game = (id: string, name: string, createdAt = 1): GameSummary => ({ id, name, startUrl: `https://${id}.example/`, description: '', createdAt, allowedOrigins: [] })
const inst = (id: string, gameId: string, label: string, status: InstanceSummary['status'] = 'stopped'): InstanceSummary => ({
  id,
  gameId,
  accountId: `acc-${id}`,
  label,
  status,
  errorCode: null,
  restoreOnLaunch: false,
})
const view = (seq: number, instances: InstanceSummary[], resyncs = 0) => ({ seq, instances, resyncs })

const domain = () => useDomainStore.getState()
const ui = () => useUiStore.getState()

beforeEach(() => {
  useDomainStore.getState().reset()
  useUiStore.getState().reset()
  useNoticeStore.getState().setNotices([])
})

describe('domain store: loading states', () => {
  it('starts loading, and needs BOTH the snapshot and the games before it is ready', () => {
    expect(domain().status).toBe('loading')
    domain().applySync(view(3, [inst('i1', 'g1', 'a')]))
    expect(domain().status).toBe('loading') // games not here yet
    domain().setGames([game('g1', 'One')])
    expect(domain().status).toBe('ready')
    expect(domain().seq).toBe(3)
  })
  it('the other order works too', () => {
    domain().setGames([game('g1', 'One')])
    expect(domain().status).toBe('loading') // snapshot not here yet
    domain().applySync(view(0, []))
    expect(domain().status).toBe('ready')
  })
  it('a failure before anything is shown becomes the error state', () => {
    domain().failLoading()
    expect(domain().status).toBe('error')
  })
  it('a failure after the library is on screen does NOT replace it with an error page', () => {
    domain().setGames([game('g1', 'One')])
    domain().applySync(view(1, []))
    domain().failLoading()
    expect(domain().status).toBe('ready')
  })
  it('recovers from the error state when data finally arrives', () => {
    domain().failLoading()
    domain().setGames([game('g1', 'One')])
    domain().applySync(view(1, []))
    expect(domain().status).toBe('ready')
  })
  it('exposes the sync diagnostics', () => {
    domain().applySync(view(42, [], 2))
    expect(domain().seq).toBe(42)
    expect(domain().resyncs).toBe(2)
  })
})

describe('domain store: identity is preserved so rows re-render only when their own data changes', () => {
  const games = [game('g1', 'One'), game('g2', 'Two')]
  const a1 = inst('i1', 'g1', 'a', 'running')
  const a2 = inst('i2', 'g1', 'b')
  const b1 = inst('i3', 'g2', 'c', 'running')

  beforeEach(() => {
    domain().setGames(games)
    domain().applySync(view(1, [a1, a2, b1]))
  })

  it('an identical sync changes no reference at all', () => {
    const before = domain()
    domain().applySync(view(1, [a1, a2, b1]))
    const after = domain()
    expect(after.instancesById).toBe(before.instancesById)
    expect(after.accountIdsByGame).toBe(before.accountIdsByGame)
    expect(after.runningIds).toBe(before.runningIds)
    expect(after.gameById).toBe(before.gameById)
  })

  it('changing one instance keeps every other instance object and every unaffected list', () => {
    const before = domain()
    const changed = { ...a2, status: 'starting' as const }
    domain().applySync(view(2, [a1, changed, b1]))
    const after = domain()
    expect(after.instancesById['i2']).toBe(changed)
    expect(after.instancesById['i1']).toBe(before.instancesById['i1']) // untouched rows keep their reference
    expect(after.instancesById['i3']).toBe(before.instancesById['i3'])
    expect(after.accountIdsByGame['g1']).toBe(before.accountIdsByGame['g1']) // same ids, same array
    expect(after.accountIdsByGame['g2']).toBe(before.accountIdsByGame['g2'])
    expect(after.runningIds).toBe(before.runningIds) // running set did not change
  })

  it('a status change that alters the running set updates only that list', () => {
    const before = domain()
    domain().applySync(view(2, [a1, { ...a2, status: 'running' }, b1]))
    const after = domain()
    expect(after.runningIds).toEqual(['i1', 'i2', 'i3'])
    expect(after.runningIds).not.toBe(before.runningIds)
    expect(after.accountIdsByGame['g1']).toBe(before.accountIdsByGame['g1'])
  })

  it('removing an instance drops it everywhere and leaves the rest', () => {
    domain().applySync(view(2, [a1, b1]))
    expect(domain().instancesById['i2']).toBeUndefined()
    expect(domain().accountIdsByGame['g1']).toEqual(['i1'])
    expect(domain().accountIdsByGame['g2']).toEqual(['i3'])
  })

  it('empty lists share ONE frozen array', () => {
    domain().applySync(view(2, []))
    expect(domain().accountIdsByGame['g1']).toBe(domain().accountIdsByGame['g2'])
    expect(domain().runningIds).toHaveLength(0)
  })

  it('an instance of a game not in the list yet is kept (and ordered last among running)', () => {
    domain().applySync(view(2, [a1, inst('i9', 'newgame', 'z', 'running')]))
    expect(domain().instancesById['i9']).toBeDefined()
    expect(domain().accountIdsByGame['newgame']).toEqual(['i9'])
    expect(domain().runningIds).toEqual(['i1', 'i9'])
    domain().setGames([...games, game('newgame', 'Aardvark')]) // arrives later; ordering updates
    expect(domain().runningIds).toEqual(['i9', 'i1'])
  })

  it('setGames with the same content keeps references too', () => {
    const before = domain()
    domain().setGames([...games])
    expect(domain().instancesById).toBe(before.instancesById)
    expect(domain().accountIdsByGame).toBe(before.accountIdsByGame)
  })
})

describe('domain store: a distinct colour per game', () => {
  it('exposes a hue for every game, by creation order, and keeps it as games are added', () => {
    domain().setGames([game('b', 'Beta', 2), game('a', 'Alpha', 1)])
    const first = domain().hueByGameId
    expect(Object.keys(first).sort()).toEqual(['a', 'b'])
    expect(first['a']).not.toBe(first['b'])

    domain().setGames([game('b', 'Beta', 2), game('a', 'Alpha', 1), game('c', 'Gamma', 3)])
    const second = domain().hueByGameId
    expect(second['a']).toBe(first['a']) // earlier games keep their colour
    expect(second['b']).toBe(first['b'])
    expect(second['c']).not.toBe(first['a'])
    expect(second['c']).not.toBe(first['b'])
  })
  it('keeps the same object when nothing about the colours changed', () => {
    domain().setGames([game('a', 'Alpha', 1)])
    const before = domain().hueByGameId
    domain().applySync(view(1, [inst('i1', 'a', 'x', 'running')]))
    domain().setGames([game('a', 'Alpha', 1)])
    expect(domain().hueByGameId).toBe(before)
  })
})

describe('UI store', () => {
  it('starts on the library with nothing open', () => {
    expect(ui()).toMatchObject({ screen: 'library', dialog: null, focusedInstanceId: null, search: '', filter: 'all', toasts: [], pending: {} })
  })
  it('opening an instance goes to Play, focus mode, with that instance requested', () => {
    ui().setPlayMode('grid')
    ui().openInstance('i1')
    expect(ui()).toMatchObject({ screen: 'play', playMode: 'focus', focusedInstanceId: 'i1' })
  })
  it('navigation keeps the other state', () => {
    ui().setSearch('poke')
    ui().setFilter('running')
    ui().navigate('settings')
    ui().navigate('library')
    expect(ui()).toMatchObject({ screen: 'library', search: 'poke', filter: 'running' })
  })
  it('opens and closes one dialog at a time', () => {
    ui().openDialog({ kind: 'addGame' })
    ui().openDialog({ kind: 'confirmRemove', instanceId: 'i1' })
    expect(ui().dialog).toEqual({ kind: 'confirmRemove', instanceId: 'i1' })
    ui().closeDialog()
    expect(ui().dialog).toBeNull()
  })
  it('keeps only the latest toasts and can dismiss one', () => {
    for (let i = 1; i <= 5; i++) ui().pushToast('info', `t${i}`)
    expect(ui().toasts.map((t) => t.text)).toEqual(['t3', 't4', 't5'])
    const [first, second] = ui().toasts
    ui().dismissToast((first as NonNullable<typeof first>).id)
    expect(ui().toasts.map((t) => t.id)).toEqual([(second as NonNullable<typeof second>).id, ui().toasts[1]?.id])
    expect(new Set(ui().toasts.map((t) => t.id)).size).toBe(ui().toasts.length)
  })
  it('tracks in-flight actions per instance', () => {
    ui().setPending('i1', 'start')
    ui().setPending('i2', 'stop')
    expect(ui().pending).toEqual({ i1: 'start', i2: 'stop' })
    ui().setPending('i1', null)
    expect(ui().pending).toEqual({ i2: 'stop' })
  })
})
