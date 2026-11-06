import { describe, expect, it } from 'vitest'
import { createGameSchema, createInstanceSchema, gameRefSchema, setAllowedOriginsSchema, updateGameSchema } from '@shared/ipc/schemas'
import {
  describeAddressChange,
  hasErrors,
  MAX_ACCOUNT_LABEL,
  MAX_DESCRIPTION,
  MAX_GAME_NAME,
  MAX_ORIGINS,
  normalizeOrigin,
  suggestedAccountLabel,
  suggestedGameName,
  validateAccountLabel,
  validateGameForm,
  validateOrigin,
} from '../../src/renderer/model/forms'

describe('validateGameForm', () => {
  const valid = { name: 'Poke Idle', url: 'https://pokeidle.io/', description: '' }

  it('accepts a good form, with or without name and description', () => {
    expect(validateGameForm(valid)).toEqual({})
    expect(validateGameForm({ ...valid, name: '' })).toEqual({}) // the name falls back to the host
    expect(validateGameForm({ ...valid, description: 'x'.repeat(MAX_DESCRIPTION) })).toEqual({})
    expect(validateGameForm({ name: '', url: 'http://localhost:4000/', description: '' })).toEqual({}) // loopback http
  })

  it.each([
    ['', /Enter the address/],
    ['   ', /Enter the address/],
    ['pokeidle.io', /full address/],
    ['http://pokeidle.io/', /https/],
    ['ftp://pokeidle.io/', /https/],
    ['javascript:alert(1)', /https/],
    ['file:///etc/passwd', /https/],
    ['https://user:pw@pokeidle.io/', /user name or password/],
  ])('rejects the address %j with a helpful message', (url, expected) => {
    const errors = validateGameForm({ ...valid, url })
    expect(errors.url).toMatch(expected)
  })

  it('checks lengths', () => {
    expect(validateGameForm({ ...valid, name: 'x'.repeat(MAX_GAME_NAME + 1) }).name).toBeDefined()
    expect(validateGameForm({ ...valid, description: 'x'.repeat(MAX_DESCRIPTION + 1) }).description).toBeDefined()
    expect(hasErrors({})).toBe(false)
    expect(hasErrors({ url: 'x' })).toBe(true)
  })

  it('suggests the host as a name', () => {
    expect(suggestedGameName('https://www.pokeidle.io/play')).toBe('pokeidle.io')
    expect(suggestedGameName('https://game.example:8443/')).toBe('game.example:8443')
    expect(suggestedGameName('nonsense')).toBe('')
  })

  it('anything the form accepts, Main accepts too (the form never promises what the IPC refuses)', () => {
    const inputs = [valid, { ...valid, name: '' }, { name: '', url: 'http://127.0.0.1:3000/', description: 'one line' }]
    for (const input of inputs) {
      expect(validateGameForm(input)).toEqual({})
      const name = input.name.trim() === '' ? suggestedGameName(input.url) : input.name.trim()
      expect(createGameSchema.safeParse({ name, startUrl: input.url.trim(), description: input.description.trim() }).success).toBe(true)
    }
  })
})

describe('account labels', () => {
  it('suggests the first free "Account N"', () => {
    expect(suggestedAccountLabel([])).toBe('Account 1')
    expect(suggestedAccountLabel(['Main'])).toBe('Account 2')
    expect(suggestedAccountLabel(['Main', 'Account 3'])).toBe('Account 4') // starts at count + 1, and 3 is taken
    expect(suggestedAccountLabel(['Account 2', 'account 3'])).toBe('Account 4') // case-insensitive, and skips taken numbers
  })
  it('never suggests a name the validator would refuse', () => {
    const labels: string[] = []
    for (let i = 0; i < 30; i++) {
      const suggestion = suggestedAccountLabel(labels)
      expect(validateAccountLabel(suggestion, labels)).toBeNull()
      labels.push(suggestion)
    }
  })
  it('requires a name, bounded, and distinct within the game (case-insensitive)', () => {
    expect(validateAccountLabel('', [])).toMatch(/Give the account a name/)
    expect(validateAccountLabel('   ', [])).toMatch(/Give the account a name/)
    expect(validateAccountLabel('x'.repeat(MAX_ACCOUNT_LABEL + 1), [])).toMatch(/under/)
    expect(validateAccountLabel('Main', ['main'])).toMatch(/already has/)
    expect(validateAccountLabel(' Main ', ['MAIN'])).toMatch(/already has/)
    expect(validateAccountLabel('Alt', ['Main'])).toBeNull()
  })
  it('anything the label validator accepts is accepted by the IPC schema', () => {
    for (const label of ['Main', ' Alt 2 ', 'ñandú', 'x'.repeat(MAX_ACCOUNT_LABEL)]) {
      expect(validateAccountLabel(label, [])).toBeNull()
      expect(createInstanceSchema.safeParse({ gameId: '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b', label }).success).toBe(true)
    }
  })
})

describe('normalizeOrigin', () => {
  it.each([
    ['https://login.example.com', 'https://login.example.com'],
    ['  HTTPS://LOGIN.EXAMPLE.COM/  ', 'https://login.example.com'],
    ['https://login.example.com:443', 'https://login.example.com'],
    ['https://*.Example.COM/', 'https://*.example.com'],
    ['http://LocalHost:4000/', 'http://localhost:4000'],
  ])('%j -> %j', (input, expected) => expect(normalizeOrigin(input)).toBe(expected))
  it.each(['example.com', 'https://login.example.com/path', 'https://login.example.com?x=1', 'https://u:p@login.example.com', 'ftp://x.example', ''])(
    'leaves %j alone so validation can explain it',
    (input) => expect(normalizeOrigin(input)).toBe(input.trim()),
  )
  it('what it returns is exactly what Main accepts', () => {
    for (const typed of ['HTTPS://Login.Example.com/', ' https://*.Example.com ', 'http://LOCALHOST:4000']) {
      const normalized = normalizeOrigin(typed)
      expect(validateOrigin(typed, [])).toBeNull()
      expect(setAllowedOriginsSchema.safeParse({ gameId: '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b', allowedOrigins: [normalized] }).success).toBe(true)
    }
  })
})

describe('validateOrigin', () => {
  it('accepts a site or an https wildcard', () => {
    expect(validateOrigin('https://login.example.com', [])).toBeNull()
    expect(validateOrigin('https://*.example.com', [])).toBeNull()
    expect(validateOrigin('  https://login.example.com/  ', [])).toBeNull()
    expect(validateOrigin('http://localhost:4000', [])).toBeNull()
  })
  it.each([
    ['', /Enter an address/],
    ['example.com', /just the site/],
    ['http://login.example.com', /just the site/],
    ['https://login.example.com/path', /just the site/],
    ['https://*.com', /just the site/],
    ['javascript:alert(1)', /just the site/],
  ])('rejects %j', (input, expected) => expect(validateOrigin(input, [])).toMatch(expected))
  it('refuses a repeat, with or without the trailing slash, and an overfull list', () => {
    expect(validateOrigin('https://login.example.com/', ['https://login.example.com'])).toMatch(/already allowed/)
    expect(validateOrigin('HTTPS://LOGIN.EXAMPLE.COM', ['https://login.example.com'])).toMatch(/already allowed/)
    const full = Array.from({ length: MAX_ORIGINS }, (_, i) => `https://a${i}.example.com`)
    expect(validateOrigin('https://new.example.com', full)).toMatch(/at most/)
  })
  it('anything accepted here is accepted by the IPC schema', () => {
    for (const origin of ['https://login.example.com', 'https://*.example.com', 'http://localhost:4000']) {
      expect(validateOrigin(origin, [])).toBeNull()
      expect(setAllowedOriginsSchema.safeParse({ gameId: '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b', allowedOrigins: [origin] }).success).toBe(true)
    }
  })
})

describe('gameRefSchema (games.remove)', () => {
  const id = '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b'
  it('accepts exactly one game id', () => expect(gameRefSchema.safeParse({ gameId: id }).success).toBe(true))
  it.each([{}, { gameId: 'x' }, { gameId: '../../etc' }, { gameId: id, cascade: false }, { instanceId: id }, null, 'string', id])(
    'rejects %j',
    (bad) => expect(gameRefSchema.safeParse(bad).success).toBe(false),
  )
})

describe('describeAddressChange', () => {
  it.each([
    ['https://game.example/', 'https://game.example/', 'none'],
    ['https://game.example', 'https://game.example/', 'none'], // a trailing slash is the same address
    ['https://game.example/play', 'https://game.example/play?x=1', 'page'],
    ['https://game.example/play', 'https://game.example/other', 'page'],
    ['https://game.example/', 'https://new.example/', 'site'],
    ['https://game.example/', 'https://www.game.example/', 'site'], // a subdomain is another site
    ['https://game.example/', 'http://game.example/', 'site'],
    ['https://game.example:8443/', 'https://game.example/', 'site'],
    ['https://game.example/', 'not a url', 'none'], // invalid: the form's validation explains it
    ['https://game.example/', '', 'none'],
    ['garbage', 'https://game.example/', 'none'],
  ] as const)('%s -> %s is %s', (saved, edited, expected) => expect(describeAddressChange(saved, edited)).toBe(expected))
})

describe('updateGameSchema (games.update)', () => {
  const id = '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b'
  const ok = { gameId: id, name: 'Poke Idle', startUrl: 'https://pokeidle.io/', description: 'monsters' }
  it('accepts a full replacement, including an empty description', () => {
    expect(updateGameSchema.safeParse(ok).success).toBe(true)
    expect(updateGameSchema.safeParse({ ...ok, description: '' }).success).toBe(true)
    expect(updateGameSchema.safeParse({ ...ok, startUrl: 'http://localhost:4000/' }).success).toBe(true)
  })
  it.each([
    ['empty name', { ...ok, name: '   ' }],
    ['long name', { ...ok, name: 'x'.repeat(101) }],
    ['long description', { ...ok, description: 'x'.repeat(201) }],
    ['http on a public host', { ...ok, startUrl: 'http://pokeidle.io/' }],
    ['credentials in the address', { ...ok, startUrl: 'https://u:p@pokeidle.io/' }],
    ['javascript:', { ...ok, startUrl: 'javascript:alert(1)' }],
    ['not a uuid', { ...ok, gameId: '../x' }],
    ['a missing field', { gameId: id, name: 'x', startUrl: 'https://x.example/' }],
    ['an extra key (cannot touch origins or ids)', { ...ok, allowedOrigins: ['https://evil.example'] }],
  ])('rejects %s', (_name, bad) => expect(updateGameSchema.safeParse(bad).success).toBe(false))
  it('anything the form accepts is accepted by the schema', () => {
    const input = { name: ' Poke Idle ', url: ' https://pokeidle.io/play ', description: ' one line ' }
    expect(validateGameForm(input)).toEqual({})
    expect(updateGameSchema.safeParse({ gameId: id, name: input.name.trim(), startUrl: input.url.trim(), description: input.description.trim() }).success).toBe(true)
  })
})
