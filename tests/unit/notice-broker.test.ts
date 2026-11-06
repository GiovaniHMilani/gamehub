import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Notice } from '@shared/domain/types'
import { DomainError } from '../../src/main/errors'
import { createLogger, MemorySink } from '../../src/main/logging/logger'
import { DISMISS_SUPPRESSION_MS, MAX_PENDING_NOTICES, NoticeBroker } from '../../src/main/notices/notice-broker'
import { makeHarness, type Harness } from './helpers/fakes'

let h: Harness
let broker: NoticeBroker
let published: Notice[][]
let appliedFor: string[]
let clock: number
let sink: MemorySink
let instanceId: string

const GOOGLE = 'https://accounts.google.com'
const url = (origin: string, path = '/o/oauth2/v2/auth?client_id=SECRET&state=XYZ'): string => `${origin}${path}`

beforeEach(() => {
  h = makeHarness('https://game.example/play')
  published = []
  appliedFor = []
  clock = 1_000_000
  sink = new MemorySink()
  broker = new NoticeBroker({
    repos: h.repos,
    applyOrigins: (gameId) => {
      appliedFor.push(gameId)
      h.manager.applyAllowedOrigins(gameId)
    },
    publish: (list) => published.push([...list]),
    log: createLogger('t', sink),
    now: () => clock,
  })
  instanceId = h.manager.createInstance({ gameId: h.gameId, label: 'teste' }).id
})
afterEach(() => h.db.close())

const request = (origin: string, extra: { retry?: () => void; kind?: 'navigation' | 'popup' | 'popup-navigation'; id?: string } = {}): void =>
  broker.request({ instanceId: extra.id ?? instanceId, url: url(origin), kind: extra.kind ?? 'navigation', ...(extra.retry ? { retry: extra.retry } : {}) })

describe('NoticeBroker: what gets asked', () => {
  it('creates a notice naming the instance, the game and ONLY the destination origin', () => {
    request(GOOGLE)
    expect(broker.list()).toEqual([
      { id: expect.any(String), instanceId, instanceLabel: 'teste', gameId: h.gameId, gameName: 'Test Game', origin: GOOGLE, kind: 'navigation' },
    ])
    expect(published).toHaveLength(1)
    // The full URL (client_id, state) is nowhere the renderer or the log can see it.
    expect(JSON.stringify(published)).not.toMatch(/SECRET|XYZ|oauth2/)
    expect(JSON.stringify(sink.records)).not.toMatch(/SECRET|XYZ|oauth2/)
  })

  it.each([
    ['plain http on a public host', 'http://accounts.google.com/auth'],
    ['javascript:', 'javascript:alert(1)'],
    ['file:', 'file:///etc/passwd'],
    ['data:', 'data:text/html,hi'],
    ['garbage', 'not a url'],
    ['credentials in the URL', 'https://user:pw@accounts.google.com/'],
  ])('does not ask about something policy would refuse anyway: %s', (_name, bad) => {
    broker.request({ instanceId, url: bad, kind: 'navigation' })
    expect(broker.list()).toEqual([])
    expect(published).toHaveLength(0)
  })

  it('asks about loopback http (local development games)', () => {
    broker.request({ instanceId, url: 'http://localhost:4000/auth', kind: 'navigation' })
    expect(broker.list()[0]?.origin).toBe('http://localhost:4000')
  })

  it('does not ask about the game\'s own origin or one already allowed', () => {
    request('https://game.example')
    h.repos.games.setAllowedOrigins(h.gameId, [GOOGLE], 1)
    request(GOOGLE)
    expect(broker.list()).toEqual([])
  })

  it('ignores requests from instances that no longer exist', () => {
    broker.request({ instanceId: crypto.randomUUID(), url: url(GOOGLE), kind: 'navigation' })
    expect(broker.list()).toEqual([])
  })

  it('one notice per game and origin; repeated requests do not re-publish', () => {
    request(GOOGLE)
    request(GOOGLE)
    request(GOOGLE)
    expect(broker.list()).toHaveLength(1)
    expect(published).toHaveLength(1)
    request('https://discord.com')
    expect(broker.list().map((n) => n.origin)).toEqual([GOOGLE, 'https://discord.com'])
  })

  it('caps pending notices so a hostile page cannot flood the panel', () => {
    for (let i = 0; i < MAX_PENDING_NOTICES + 10; i++) request(`https://evil${i}.example`)
    expect(broker.list()).toHaveLength(MAX_PENDING_NOTICES)
    expect(sink.events()).toContain('notice.dropped')
  })
})

describe('NoticeBroker: deciding', () => {
  it('allow: persists exactly that origin, applies it live, THEN redoes the navigation', () => {
    const order: string[] = []
    const origApply = h.manager.applyAllowedOrigins.bind(h.manager)
    broker = new NoticeBroker({
      repos: h.repos,
      applyOrigins: (id) => {
        order.push('applied')
        origApply(id)
      },
      publish: () => undefined,
      log: createLogger('t', sink),
      now: () => clock,
    })
    request(GOOGLE, { retry: () => order.push('retried') })
    const id = broker.list()[0]?.id as string
    broker.resolve(id, 'allow')

    expect(h.repos.games.get(h.gameId)?.allowedOrigins).toEqual([GOOGLE])
    expect(order).toEqual(['applied', 'retried']) // retried only after the list was live
    expect(broker.list()).toEqual([])
    expect(sink.events()).toContain('notice.allowed')
  })

  it('allow pushes the new list to the game\'s running views', async () => {
    await h.manager.start(instanceId)
    request(GOOGLE)
    broker.resolve(broker.list()[0]?.id as string, 'allow')
    expect(h.host.originUpdates.at(-1)).toEqual({ instanceId, origins: ['https://game.example', GOOGLE] })
  })

  it('allow keeps existing origins and never duplicates', () => {
    h.repos.games.setAllowedOrigins(h.gameId, ['https://discord.com'], 1)
    request(GOOGLE)
    broker.resolve(broker.list()[0]?.id as string, 'allow')
    expect(h.repos.games.get(h.gameId)?.allowedOrigins).toEqual(['https://discord.com', GOOGLE])
  })

  it('redoes the latest refused navigation of EACH instance of the game', () => {
    const second = h.manager.createInstance({ gameId: h.gameId, label: 'teste 2' }).id
    const calls: string[] = []
    request(GOOGLE, { retry: () => calls.push('first-old') })
    request(GOOGLE, { retry: () => calls.push('first-new') })
    request(GOOGLE, { retry: () => calls.push('second'), id: second })
    broker.resolve(broker.list()[0]?.id as string, 'allow')
    expect(calls).toEqual(['first-new', 'second'])
  })

  it('a failing retry does not stop the others or the decision', () => {
    const second = h.manager.createInstance({ gameId: h.gameId, label: 'teste 2' }).id
    let ran = false
    request(GOOGLE, { retry: () => { throw new Error('boom') } })
    request(GOOGLE, { retry: () => { ran = true }, id: second })
    broker.resolve(broker.list()[0]?.id as string, 'allow')
    expect(ran).toBe(true)
    expect(h.repos.games.get(h.gameId)?.allowedOrigins).toEqual([GOOGLE])
  })

  it('a popup request is allowed without any retry (it cannot be redone)', () => {
    request(GOOGLE, { kind: 'popup' })
    expect(() => broker.resolve(broker.list()[0]?.id as string, 'allow')).not.toThrow()
    expect(h.repos.games.get(h.gameId)?.allowedOrigins).toEqual([GOOGLE])
  })

  it('dismiss: nothing is saved, nothing is retried, and the same origin stays quiet for a while', () => {
    let retried = false
    request(GOOGLE, { retry: () => { retried = true } })
    broker.resolve(broker.list()[0]?.id as string, 'dismiss')
    expect(h.repos.games.get(h.gameId)?.allowedOrigins).toEqual([])
    expect(retried).toBe(false)

    request(GOOGLE)
    expect(broker.list()).toEqual([]) // suppressed
    expect(sink.events()).toContain('notice.suppressed')
    clock += DISMISS_SUPPRESSION_MS
    request(GOOGLE)
    expect(broker.list()).toHaveLength(1) // asked again once the quiet period is over
  })

  it('dismissing one origin does not silence another, or the same origin of another game', () => {
    const other = h.repos.games.create({ id: crypto.randomUUID(), name: 'Other', startUrl: 'https://other.example/' }, 1)
    const otherInstance = h.manager.createInstance({ gameId: other.id, label: 'o' }).id
    request(GOOGLE)
    broker.resolve(broker.list()[0]?.id as string, 'dismiss')
    request('https://discord.com')
    request(GOOGLE, { id: otherInstance })
    expect(broker.list().map((n) => `${n.gameName}:${n.origin}`)).toEqual(['Test Game:https://discord.com', `Other:${GOOGLE}`])
  })

  it('rejects unknown or already resolved ids', () => {
    expect(() => broker.resolve(crypto.randomUUID(), 'allow')).toThrow(DomainError)
    request(GOOGLE)
    const id = broker.list()[0]?.id as string
    broker.resolve(id, 'dismiss')
    expect(() => broker.resolve(id, 'allow')).toThrow(/not found/i)
    expect(h.repos.games.get(h.gameId)?.allowedOrigins).toEqual([]) // a stale "allow" changed nothing
  })

  it('refuses to grow a game past the origin limit', () => {
    h.repos.games.setAllowedOrigins(h.gameId, Array.from({ length: 20 }, (_, i) => `https://a${i}.example`), 1)
    request(GOOGLE)
    expect(() => broker.resolve(broker.list()[0]?.id as string, 'allow')).toThrow(/Too many/)
    expect(h.repos.games.get(h.gameId)?.allowedOrigins).toHaveLength(20)
  })
})

describe('NoticeBroker: housekeeping', () => {
  it('drops a notice, and its retries, when its instance goes away', () => {
    let retried = false
    request(GOOGLE, { retry: () => { retried = true } })
    broker.clearForInstance(instanceId)
    expect(broker.list()).toEqual([])
    expect(published.at(-1)).toEqual([])
    expect(retried).toBe(false)
  })

  it('keeps a shared notice while another instance can still redo its navigation', () => {
    const second = h.manager.createInstance({ gameId: h.gameId, label: 'teste 2' }).id
    let secondRetried = false
    request(GOOGLE, { retry: () => undefined })
    request(GOOGLE, { retry: () => { secondRetried = true }, id: second })
    broker.clearForInstance(instanceId)
    expect(broker.list()).toHaveLength(1)
    broker.resolve(broker.list()[0]?.id as string, 'allow')
    expect(secondRetried).toBe(true)
  })

  it('clearForGame forgets a removed game: its notices and its "do not ask again" memory', () => {
    const other = h.repos.games.create({ id: crypto.randomUUID(), name: 'Other', startUrl: 'https://other.example/' }, 1)
    const otherInstance = h.manager.createInstance({ gameId: other.id, label: 'o' }).id
    request(GOOGLE)
    request('https://discord.com')
    request(GOOGLE, { id: otherInstance })
    broker.resolve(broker.list()[1]?.id as string, 'dismiss') // discord, dismissed for the first game

    broker.clearForGame(h.gameId)
    expect(broker.list().map((n) => n.gameName)).toEqual(['Other'])
    expect(published.at(-1)?.map((n) => n.gameName)).toEqual(['Other'])
    request('https://discord.com') // the quiet period went with the game
    expect(broker.list().map((n) => n.origin)).toContain('https://discord.com')
  })

  it('reconcile drops notices that a manual edit already satisfied', () => {
    request(GOOGLE)
    request('https://discord.com')
    h.repos.games.setAllowedOrigins(h.gameId, [GOOGLE], 1)
    broker.reconcile(h.gameId)
    expect(broker.list().map((n) => n.origin)).toEqual(['https://discord.com'])
  })
})
