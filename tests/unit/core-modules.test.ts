import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseGameUrl } from '@shared/domain/game-url'
import { createGameSchema, createInstanceSchema, instanceRefSchema } from '@shared/ipc/schemas'
import { SessionManager } from '../../src/main/browser-sessions/session-manager'
import { KeyedSerialQueue } from '../../src/main/instances/keyed-queue'
import { nextStatus, type InstanceEvent } from '../../src/main/instances/state-machine'
import { createLogger, MemorySink, redactFields, sanitizeUrl } from '../../src/main/logging/logger'
import { allowedOriginsFor, isAllowedTopLevelNavigation } from '../../src/main/navigation/policy'
import { partitionDirectory, processTombstones } from '../../src/main/persistence/tombstones'
import { INSTANCE_STATUSES } from '@shared/domain/types'
import { FakeSession, deferred, makeDb } from './helpers/fakes'
import { createRepositories } from '../../src/main/persistence/repositories'

describe('state machine', () => {
  const valid: Array<[string, InstanceEvent, string]> = [
    ['stopped', 'START', 'starting'],
    ['starting', 'LOADED', 'running'],
    ['starting', 'LOAD_FAILED', 'error'],
    ['starting', 'PROCESS_GONE', 'crashed'],
    ['starting', 'STOP', 'stopping'],
    ['running', 'PROCESS_GONE', 'crashed'],
    ['running', 'STOP', 'stopping'],
    ['stopping', 'STOPPED', 'stopped'],
    ['crashed', 'START', 'starting'],
    ['crashed', 'STOP', 'stopping'],
    ['error', 'START', 'starting'],
    ['error', 'STOP', 'stopping'],
  ]
  it.each(valid)('%s --%s--> %s', (from, event, to) => {
    expect(nextStatus(from as never, event)).toBe(to)
  })

  it('rejects every transition not in the table', () => {
    const events: InstanceEvent[] = ['START', 'LOADED', 'LOAD_FAILED', 'PROCESS_GONE', 'STOP', 'STOPPED']
    const allowed = new Set(valid.map(([from, event]) => `${from}:${event}`))
    for (const status of INSTANCE_STATUSES) {
      for (const event of events) {
        if (!allowed.has(`${status}:${event}`)) expect(nextStatus(status, event)).toBeNull()
      }
    }
  })

  it('cannot start twice or leave stopping except to stopped', () => {
    expect(nextStatus('starting', 'START')).toBeNull()
    expect(nextStatus('running', 'START')).toBeNull()
    expect(nextStatus('stopping', 'START')).toBeNull()
    expect(nextStatus('stopping', 'STOP')).toBeNull()
  })
})

describe('KeyedSerialQueue', () => {
  it('runs tasks of one key strictly in order, never overlapping', async () => {
    const queue = new KeyedSerialQueue()
    const log: string[] = []
    let running = 0
    let maxRunning = 0
    const task = (name: string, gate: Promise<void>) => async (): Promise<string> => {
      running++
      maxRunning = Math.max(maxRunning, running)
      log.push(`start ${name}`)
      await gate
      log.push(`end ${name}`)
      running--
      return name
    }
    const g1 = deferred()
    const g2 = deferred()
    const p1 = queue.run('k', task('1', g1.promise))
    const p2 = queue.run('k', task('2', g2.promise))
    await new Promise((r) => setImmediate(r))
    expect(log).toEqual(['start 1'])
    g1.resolve()
    await p1
    g2.resolve()
    await p2
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2'])
    expect(maxRunning).toBe(1)
  })

  it('runs different keys concurrently', async () => {
    const queue = new KeyedSerialQueue()
    const gate = deferred()
    const started: string[] = []
    const mk = (k: string) =>
      queue.run(k, async () => {
        started.push(k)
        await gate.promise
      })
    const all = Promise.all([mk('a'), mk('b')])
    await new Promise((r) => setImmediate(r))
    expect(started.sort()).toEqual(['a', 'b'])
    gate.resolve()
    await all
  })

  it('a failing task does not block the next, and idle keys are released', async () => {
    const queue = new KeyedSerialQueue()
    const failing = queue.run('k', () => Promise.reject(new Error('boom')))
    const next = queue.run('k', () => Promise.resolve('ok'))
    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
    await new Promise((r) => setImmediate(r))
    expect(queue.activeKeys).toBe(0)
  })
})

describe('SessionManager', () => {
  const ID_A = '11111111-1111-4111-8111-111111111111'
  const ID_B = '22222222-2222-4222-8222-222222222222'

  function make(partitions: Record<string, string>) {
    const created: FakeSession[] = []
    let configured = 0
    const manager = new SessionManager<FakeSession>({
      resolvePartitionId: (accountId) => partitions[accountId],
      fromPartition: (name) => {
        const session = new FakeSession(name)
        created.push(session)
        return session
      },
      configure: () => {
        configured++
      },
      log: createLogger('t', new MemorySink()),
    })
    return { manager, created, configured: () => configured }
  }

  it('gives each account its own persistent partition', () => {
    const { manager } = make({ a: ID_A, b: ID_B })
    const a = manager.get('a')
    const b = manager.get('b')
    expect(a).not.toBe(b)
    expect(a.partitionName).toBe(`persist:gh-${ID_A}`)
    expect(b.partitionName).toBe(`persist:gh-${ID_B}`)
    expect(a.partitionName.startsWith('persist:')).toBe(true) // never in-memory
  })

  it('returns the same session for the same account and configures it once', () => {
    const { manager, created, configured } = make({ a: ID_A })
    expect(manager.get('a')).toBe(manager.get('a'))
    expect(created).toHaveLength(1)
    expect(configured()).toBe(1)
  })

  it('refuses two accounts that claim one partition', () => {
    const { manager } = make({ a: ID_A, b: ID_A })
    manager.get('a')
    expect(() => manager.get('b')).toThrow(/already owned/)
  })

  it('rejects unknown accounts and malformed stored ids', () => {
    const { manager } = make({ evil: '../../etc', a: ID_A })
    expect(() => manager.get('missing')).toThrow(/not found/i)
    expect(() => manager.get('evil')).toThrow(/malformed/i)
  })

  it('purge wipes the session and releases the reference', async () => {
    const { manager, created } = make({ a: ID_A })
    manager.get('a')
    await manager.purge(manager.identityOf('a'))
    expect(created[0]?.cleared).toBe(1)
    expect(manager.loadedCount).toBe(0)
  })
})

describe('repositories', () => {
  const open: Array<{ close(): void }> = []
  afterEach(() => open.splice(0).forEach((db) => db.close()))

  function setup() {
    const opened = makeDb()
    open.push(opened)
    const repos = createRepositories(opened.db)
    const game = repos.games.create({ id: crypto.randomUUID(), name: 'G', startUrl: 'https://g.example/' }, 1)
    const mk = (label: string, partitionId: string = crypto.randomUUID()) =>
      repos.instances.createAccountWithInstance(
        { gameId: game.id, label, accountId: crypto.randomUUID(), instanceId: crypto.randomUUID(), partitionId, restoreOnLaunch: false },
        1,
      )
    return { repos, game, mk }
  }

  it('creates account and instance together; two accounts of one game get different partitions', () => {
    const { repos, mk } = setup()
    const a = mk('A')
    const b = mk('B')
    expect(a.account.partitionId).not.toBe(b.account.partitionId)
    expect(repos.instances.listRecords()).toHaveLength(2)
  })

  it('enforces a unique partition per account at the database level', () => {
    const { mk } = setup()
    const first = mk('A')
    expect(() => mk('B', first.account.partitionId)).toThrow(/UNIQUE/i)
  })

  it('does not leave a half-created account when the instance insert fails', () => {
    const { repos, game } = setup()
    const id = crypto.randomUUID()
    const base = { gameId: game.id, label: 'x', accountId: crypto.randomUUID(), partitionId: crypto.randomUUID(), restoreOnLaunch: false }
    repos.instances.createAccountWithInstance({ ...base, instanceId: id }, 1)
    expect(() =>
      repos.instances.createAccountWithInstance(
        { ...base, accountId: crypto.randomUUID(), partitionId: crypto.randomUUID(), instanceId: id },
        1,
      ),
    ).toThrow()
    expect(repos.instances.listRecords()).toHaveLength(1)
  })

  it('removeAccount deletes account + instance (cascade) and records a tombstone, sparing others', () => {
    const { repos, mk } = setup()
    const a = mk('A')
    const b = mk('B')
    repos.instances.removeAccount(a.account.id, a.account.partitionId, 2)
    expect(repos.instances.getRecord(a.instance.id)).toBeUndefined()
    expect(repos.instances.getRecord(b.instance.id)).toBeDefined()
    expect(repos.tombstones.list()).toEqual([a.account.partitionId])
  })

  it('stores metadata only: no column can hold cookies or storage', () => {
    const { repos, mk } = setup()
    mk('A')
    const columns = Object.keys(repos.instances.listRecords()[0]?.account ?? {})
    expect(columns.join(',')).not.toMatch(/cookie|token|storage|password/i)
  })
})

describe('tombstones', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  it('deletes only tombstoned partition directories, then drops the tombstone', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'gh-tomb-'))
    dirs.push(userData)
    const opened = makeDb()
    const repos = createRepositories(opened.db)
    const gone = '33333333-3333-4333-8333-333333333333'
    const kept = '44444444-4444-4444-8444-444444444444'
    for (const id of [gone, kept]) {
      await mkdir(partitionDirectory(userData, id), { recursive: true })
      await writeFile(join(partitionDirectory(userData, id), 'Cookies'), 'x')
    }
    const game = repos.games.create({ id: crypto.randomUUID(), name: 'G', startUrl: 'https://g.example/' }, 1)
    const rec = repos.instances.createAccountWithInstance(
      { gameId: game.id, label: 'A', accountId: crypto.randomUUID(), instanceId: crypto.randomUUID(), partitionId: gone, restoreOnLaunch: false },
      1,
    )
    repos.instances.removeAccount(rec.account.id, gone, 2)

    const result = await processTombstones(userData, repos.tombstones, createLogger('t', new MemorySink()))

    expect(result).toEqual({ deleted: 1, failed: 0 })
    expect(await readdir(join(userData, 'Partitions'))).toEqual([`gh-${kept}`])
    expect(repos.tombstones.list()).toEqual([])
    opened.close()
  })

  it('refuses to build a path from a malformed id', () => {
    expect(() => partitionDirectory('/tmp/x', '../../etc')).toThrow()
  })
})

describe('logger', () => {
  it('redacts secrets and strips query/hash from urls', () => {
    const fields = redactFields({
      url: 'https://g.example/play?token=abc#access_token=zzz',
      startUrl: 'https://g.example/a?x=1',
      cookie: 'sid=1',
      Authorization: 'Bearer abc',
      accessToken: 'abc',
      instanceId: 'keep',
    })
    expect(JSON.stringify(fields)).not.toMatch(/abc|zzz|sid=1|x=1/)
    expect(fields).toMatchObject({ url: 'https://g.example/play', startUrl: 'https://g.example/a', instanceId: 'keep' })
  })

  it('writes structured records and callers cannot spoof reserved keys', () => {
    const sink = new MemorySink()
    createLogger('scope', sink, () => new Date('2026-01-01T00:00:00Z')).info('x.y', { scope: 'evil', event: 'evil', a: 1 })
    expect(sink.records[0]).toMatchObject({ level: 'info', scope: 'scope', event: 'x.y', a: 1, ts: '2026-01-01T00:00:00.000Z' })
  })

  it('sanitizeUrl handles garbage', () => {
    expect(sanitizeUrl('not a url')).toBe('[invalid-url]')
  })
})

describe('game url + navigation policy', () => {
  it.each([
    ['https://game.example/play', true],
    ['http://127.0.0.1:3000/', true],
    ['http://localhost:8080/x', true],
    ['http://game.example/', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['chrome://settings', false],
    ['https://user:pw@game.example/', false],
    ['nonsense', false],
    ['', false],
  ])('parseGameUrl(%j) ok=%s', (input, ok) => {
    expect(parseGameUrl(input).ok).toBe(ok)
  })

  it('allows only the game origin for top-level navigation', () => {
    const origins = allowedOriginsFor('https://game.example/play?x=1')
    expect(origins).toEqual(['https://game.example'])
    expect(isAllowedTopLevelNavigation('https://game.example/other', origins)).toBe(true)
    expect(isAllowedTopLevelNavigation('https://evil.example/', origins)).toBe(false)
    expect(isAllowedTopLevelNavigation('https://game.example.evil.com/', origins)).toBe(false)
    expect(isAllowedTopLevelNavigation('http://game.example/', origins)).toBe(false)
    expect(isAllowedTopLevelNavigation('file:///etc/passwd', origins)).toBe(false)
    expect(isAllowedTopLevelNavigation('javascript:alert(1)', origins)).toBe(false)
    expect(isAllowedTopLevelNavigation('garbage', origins)).toBe(false)
  })
})

describe('IPC input schemas', () => {
  const uuid = '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b'

  it('accepts well-formed input', () => {
    expect(createGameSchema.safeParse({ name: ' G ', startUrl: 'https://g.example/' }).success).toBe(true)
    expect(createInstanceSchema.safeParse({ gameId: uuid, label: 'A' }).success).toBe(true)
    expect(instanceRefSchema.safeParse({ instanceId: uuid }).success).toBe(true)
  })

  it.each([
    [createGameSchema, { name: '', startUrl: 'https://g.example/' }],
    [createGameSchema, { name: 'G', startUrl: 'file:///etc/passwd' }],
    [createGameSchema, { name: 'G', startUrl: 'https://g.example/', extra: 1 }],
    [createGameSchema, { name: 'G' }],
    [createInstanceSchema, { gameId: 'not-a-uuid', label: 'A' }],
    [createInstanceSchema, { gameId: uuid, label: 'A', partition: 'persist:evil' }],
    [instanceRefSchema, { instanceId: '../../x' }],
    [instanceRefSchema, {}],
    [instanceRefSchema, null],
    [instanceRefSchema, 'string'],
  ])('rejects invalid input %#', (schema, input) => {
    expect(schema.safeParse(input).success).toBe(false)
  })

  it('never lets a caller choose a partition: no schema has such a field', () => {
    expect(Object.keys(createInstanceSchema.shape)).toEqual(['gameId', 'label'])
  })
})
