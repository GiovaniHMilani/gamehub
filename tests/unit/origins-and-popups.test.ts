import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { matchesAnyOrigin, parseOriginPattern } from '@shared/domain/origin-pattern'
import { createGameSchema } from '@shared/ipc/schemas'
import { allowedOriginsFor, isAllowedTopLevelNavigation } from '../../src/main/navigation/policy'
import {
  canTransitionPopup,
  decidePopup,
  MAX_POPUP_OPENS_PER_WINDOW,
  parsePopupSize,
  POPUP_RATE_WINDOW_MS,
  type PopupRequest,
  type PopupState,
} from '../../src/main/navigation/popup-policy'
import { openDatabase } from '../../src/main/persistence/db'
import { createRepositories } from '../../src/main/persistence/repositories'
import { MIGRATIONS } from './helpers/fakes'

describe('origin patterns', () => {
  it.each([
    ['https://login.example.com', true],
    ['https://login.example.com/', true],
    ['https://login.example.com:8443', true],
    ['http://localhost:4000', true],
    ['http://login.example.com', false], // http only on loopback
    ['https://login.example.com/path', false], // origin only
    ['https://login.example.com?x=1', false],
    ['https://user:pw@login.example.com', false],
    ['https://*.example.com', true],
    ['https://*.example.com:8443', true],
    ['https://*.com', false], // single label
    ['https://*.0.1', false], // cannot match IPs
    ['https://*', false],
    ['http://*.example.com', false], // wildcard is https only
    ['https://*.example.com/path', false],
    ['https://*.example.com:99999', false],
    ['*.example.com', false],
    ['file:///etc/passwd', false],
    ['', false],
  ])('parseOriginPattern(%j) valid=%s', (input, valid) => {
    expect(parseOriginPattern(input) !== null).toBe(valid)
  })

  it('exact patterns match the full origin only', () => {
    const p = ['https://login.example.com']
    expect(matchesAnyOrigin('https://login.example.com/oauth?x=1', p)).toBe(true)
    expect(matchesAnyOrigin('https://login.example.com:444/', p)).toBe(false)
    expect(matchesAnyOrigin('http://login.example.com/', p)).toBe(false)
    expect(matchesAnyOrigin('https://evil.login.example.com/', p)).toBe(false)
    expect(matchesAnyOrigin('https://login.example.com.evil.com/', p)).toBe(false)
  })

  it('wildcards match subdomains, never the bare domain or look-alikes', () => {
    const p = ['https://*.example.com']
    expect(matchesAnyOrigin('https://a.example.com/', p)).toBe(true)
    expect(matchesAnyOrigin('https://a.b.example.com/', p)).toBe(true)
    expect(matchesAnyOrigin('https://example.com/', p)).toBe(false)
    expect(matchesAnyOrigin('https://notexample.com/', p)).toBe(false)
    expect(matchesAnyOrigin('https://a.example.com.evil.com/', p)).toBe(false)
    expect(matchesAnyOrigin('http://a.example.com/', p)).toBe(false)
    expect(matchesAnyOrigin('https://a.example.com:8443/', p)).toBe(false) // port must match
    expect(matchesAnyOrigin('https://a.example.com:8443/', ['https://*.example.com:8443'])).toBe(true)
  })

  it('invalid stored patterns never match anything', () => {
    expect(matchesAnyOrigin('https://a.example.com/', ['garbage', '', 'https://*.com'])).toBe(false)
  })

  it('navigation policy honours extra origins and still blocks everything else', () => {
    const allowed = allowedOriginsFor('https://game.example/play', ['https://auth.provider.test', 'https://game.example'])
    expect(allowed).toEqual(['https://game.example', 'https://auth.provider.test'])
    expect(isAllowedTopLevelNavigation('https://auth.provider.test/authorize', allowed)).toBe(true)
    expect(isAllowedTopLevelNavigation('https://other.test/', allowed)).toBe(false)
    expect(isAllowedTopLevelNavigation('javascript:alert(1)', allowed)).toBe(false)
    expect(isAllowedTopLevelNavigation('https://user:pw@auth.provider.test/', allowed)).toBe(false) // no credentials in URLs
    expect(isAllowedTopLevelNavigation('https://user@game.example/', allowed)).toBe(false)
  })

  it('createGame schema validates allowedOrigins', () => {
    const base = { name: 'G', startUrl: 'https://g.example/' }
    expect(createGameSchema.safeParse({ ...base, allowedOrigins: ['https://auth.example.com', 'https://*.example.org'] }).success).toBe(true)
    expect(createGameSchema.safeParse({ ...base, allowedOrigins: ['http://auth.example.com'] }).success).toBe(false)
    expect(createGameSchema.safeParse({ ...base, allowedOrigins: ['https://*.com'] }).success).toBe(false)
    expect(createGameSchema.safeParse({ ...base, allowedOrigins: Array(21).fill('https://a.example.com') }).success).toBe(false)
    expect(createGameSchema.safeParse(base).success).toBe(true)
  })
})

describe('popup policy', () => {
  const allowedOrigins = ['https://game.example', 'https://auth.provider.test']
  const request = (over: Partial<PopupRequest> = {}): PopupRequest => ({
    url: 'https://auth.provider.test/authorize?client_id=x&response_type=code',
    disposition: 'new-window',
    allowedOrigins,
    fromPopup: false,
    openCount: 0,
    recentOpens: [],
    now: 1_000_000,
    ...over,
  })
  const reason = (over: Partial<PopupRequest>): string => {
    const d = decidePopup(request(over))
    return d.action === 'allow' ? 'allow' : d.reason
  }

  it('allows an https popup on an allowed origin, regardless of provider', () => {
    expect(reason({})).toBe('allow')
    expect(reason({ url: 'https://game.example/callback', disposition: 'foreground-tab' })).toBe('allow')
    expect(reason({ allowedOrigins: ['https://*.idp.test'], url: 'https://login.idp.test/x' })).toBe('allow')
  })

  it.each([
    [{ url: 'https://evil.example/' }, 'origin_not_allowed'],
    [{ url: 'https://auth.provider.test.evil.com/' }, 'origin_not_allowed'],
    [{ url: 'http://auth.provider.test/' }, 'insecure_url'],
    [{ url: 'file:///etc/passwd' }, 'insecure_url'],
    [{ url: 'javascript:alert(1)' }, 'insecure_url'],
    [{ url: 'data:text/html,hi' }, 'insecure_url'],
    [{ url: 'https://u:p@auth.provider.test/' }, 'insecure_url'],
    [{ url: '' }, 'invalid_url'],
    [{ url: 'not a url' }, 'invalid_url'],
    [{ url: 'about:blank' }, 'insecure_url'],
    [{ disposition: 'save-to-disk' }, 'disposition'],
    [{ disposition: 'background-tab' }, 'disposition'],
    [{ fromPopup: true }, 'nested_popup'],
    [{ openCount: 1 }, 'too_many_open'],
  ] as Array<[Partial<PopupRequest>, string]>)('denies %j -> %s', (over, expected) => {
    expect(reason(over)).toBe(expected)
  })

  it('rate limits per window and recovers once the window passes', () => {
    const now = 1_000_000
    const full = Array.from({ length: MAX_POPUP_OPENS_PER_WINDOW }, (_, i) => now - 1000 * (i + 1))
    expect(reason({ recentOpens: full, now })).toBe('rate_limited')
    expect(reason({ recentOpens: full, now: now + POPUP_RATE_WINDOW_MS })).toBe('allow')
    expect(reason({ recentOpens: full.slice(1), now })).toBe('allow')
  })

  it('a nested popup is denied even for an allowed origin', () => {
    expect(reason({ fromPopup: true, url: 'https://game.example/' })).toBe('nested_popup')
  })

  it('clamps popup sizes and defaults them', () => {
    expect(parsePopupSize('')).toEqual({ width: 500, height: 650 })
    expect(parsePopupSize('width=480,height=640')).toEqual({ width: 480, height: 640 })
    expect(parsePopupSize('width=99999, height=1')).toEqual({ width: 1000, height: 400 })
    expect(parsePopupSize('popup,top=10,left=5')).toEqual({ width: 500, height: 650 })
    expect(parsePopupSize('nodeIntegration=yes,width=abc')).toEqual({ width: 500, height: 650 })
  })

  it('popup lifecycle only moves forward and closed is terminal', () => {
    const order: PopupState[] = ['requested', 'validated', 'created', 'navigating', 'running', 'closed']
    for (let i = 0; i < order.length - 1; i++) {
      const from = order[i] as PopupState
      const next = order[i + 1] as PopupState
      if (from !== 'created' && from !== 'navigating') expect(canTransitionPopup(from, next)).toBe(true)
    }
    expect(canTransitionPopup('created', 'running')).toBe(true)
    expect(canTransitionPopup('running', 'navigating')).toBe(true) // redirect after load
    expect(canTransitionPopup('requested', 'created')).toBe(false)
    expect(canTransitionPopup('validated', 'running')).toBe(false)
    expect(canTransitionPopup('requested', 'closed')).toBe(false)
    for (const to of order) expect(canTransitionPopup('closed', to)).toBe(false)
  })
})

describe('games.allowed_origins migration', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

  it('upgrades an existing database: old games keep their data and get an empty allowlist', () => {
    const root = mkdtempSync(join(tmpdir(), 'gh-mig-'))
    dirs.push(root)
    // A migrations folder that only knows the first migration = "the previous app version".
    const v0 = join(root, 'v0')
    mkdirSync(join(v0, 'meta'), { recursive: true })
    copyFileSync(join(MIGRATIONS, '0000_init.sql'), join(v0, '0000_init.sql'))
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number }> }
    writeFileSync(join(v0, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx === 0) }))

    const file = join(root, 'db.sqlite')
    const old = openDatabase(file, v0)
    old.close()
    const raw = new Database(file)
    raw.prepare('insert into games (id, name, start_url, created_at, updated_at) values (?, ?, ?, 1, 1)').run('g1', 'Old Game', 'https://old.example/')
    raw.close()

    const upgraded = openDatabase(file, MIGRATIONS)
    try {
      const game = createRepositories(upgraded.db).games.get('g1')
      expect(game).toMatchObject({ name: 'Old Game', startUrl: 'https://old.example/', allowedOrigins: [] })
    } finally {
      upgraded.close()
    }
  })

  it('update replaces name, address and description, and nothing else', () => {
    const db = openDatabase(':memory:', MIGRATIONS)
    try {
      const repos = createRepositories(db.db)
      const game = repos.games.create({ id: 'g1', name: 'Old', startUrl: 'https://old.example/', description: 'old text', allowedOrigins: ['https://auth.example.com'] }, 10)
      const updated = repos.games.update(game.id, { name: 'New', startUrl: 'https://new.example/', description: '' }, 20)
      expect(updated).toMatchObject({ id: 'g1', name: 'New', startUrl: 'https://new.example/', description: '', updatedAt: 20 })
      expect(updated?.createdAt).toBe(10) // history is kept
      expect(updated?.allowedOrigins).toEqual(['https://auth.example.com']) // approved sites are not touched
      expect(repos.games.update('missing', { name: 'x', startUrl: 'https://x.example/', description: '' }, 30)).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('round-trips allowed origins through SQLite', () => {
    const db = openDatabase(':memory:', MIGRATIONS)
    try {
      const repos = createRepositories(db.db)
      const created = repos.games.create({ id: 'g', name: 'G', startUrl: 'https://g.example/', allowedOrigins: ['https://auth.example.com'] }, 1)
      expect(repos.games.get(created.id)?.allowedOrigins).toEqual(['https://auth.example.com'])
    } finally {
      db.close()
    }
  })
})

describe('setting a game\'s allowed origins', () => {
  const uuid = '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b'

  it('accepts a valid replacement and rejects malformed input', async () => {
    const { setAllowedOriginsSchema } = await import('@shared/ipc/schemas')
    expect(setAllowedOriginsSchema.safeParse({ gameId: uuid, allowedOrigins: ['https://accounts.google.com', 'https://discord.com'] }).success).toBe(true)
    expect(setAllowedOriginsSchema.safeParse({ gameId: uuid, allowedOrigins: [] }).success).toBe(true) // clearing is allowed
    for (const bad of [
      { gameId: 'x', allowedOrigins: [] },
      { gameId: uuid, allowedOrigins: ['http://accounts.google.com'] },
      { gameId: uuid, allowedOrigins: ['https://*.com'] },
      { gameId: uuid, allowedOrigins: ['https://discord.com/oauth2/authorize'] }, // origin only, no path
      { gameId: uuid, allowedOrigins: [] , extra: 1 },
      { gameId: uuid },
    ]) expect(setAllowedOriginsSchema.safeParse(bad).success).toBe(false)
  })

  it('replaces (not appends) and reports an unknown game', () => {
    const db = openDatabase(':memory:', MIGRATIONS)
    try {
      const repos = createRepositories(db.db)
      const game = repos.games.create({ id: 'g1', name: 'G', startUrl: 'https://g.example/', allowedOrigins: ['https://old.example'] }, 1)
      expect(repos.games.setAllowedOrigins(game.id, ['https://accounts.google.com', 'https://discord.com'], 2)).toMatchObject({
        allowedOrigins: ['https://accounts.google.com', 'https://discord.com'],
        updatedAt: 2,
      })
      expect(repos.games.setAllowedOrigins(game.id, [], 3)?.allowedOrigins).toEqual([])
      expect(repos.games.setAllowedOrigins('missing', ['https://a.example'], 4)).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('the real provider origins from a Google/Discord flow are matched, look-alikes are not', () => {
    const allowed = allowedOriginsFor('https://game.example/', ['https://accounts.google.com', 'https://discord.com'])
    expect(isAllowedTopLevelNavigation('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', allowed)).toBe(true)
    expect(isAllowedTopLevelNavigation('https://discord.com/oauth2/authorize?client_id=x', allowed)).toBe(true)
    expect(isAllowedTopLevelNavigation('https://accounts.google.com.evil.com/', allowed)).toBe(false)
    expect(isAllowedTopLevelNavigation('https://discord.com.evil.com/', allowed)).toBe(false)
    expect(isAllowedTopLevelNavigation('https://evil.com/?https://discord.com', allowed)).toBe(false)
    expect(isAllowedTopLevelNavigation('https://www.discord.com/', allowed)).toBe(false) // subdomains need a wildcard
  })
})
