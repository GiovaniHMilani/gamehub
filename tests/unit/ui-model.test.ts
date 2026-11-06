import { describe, expect, it } from 'vitest'
import type { GameSummary, InstanceSummary } from '@shared/domain/types'
import { INSTANCE_STATUSES } from '@shared/domain/types'
import { assignHues, gameHost, gameHue, monogram } from '../../src/renderer/model/game-identity'
import { actionsFor, isBusy, needsAttention, statusLabel } from '../../src/renderer/model/instance-actions'
import { describeFailure, describeInstanceError } from '../../src/renderer/model/messages'
import { buildIndexes, NO_IDS } from '../../src/renderer/stores/domain-store'
import {
  describeCounts,
  effectiveFocusedId,
  gameCounts,
  visibleAccountIds,
  visibleGameIds,
} from '../../src/renderer/stores/selectors'

const game = (id: string, name: string, over: Partial<GameSummary> = {}): GameSummary => ({
  id,
  name,
  startUrl: `https://${name.toLowerCase().replace(/\s+/g, '')}.example/`,
  description: '',
  createdAt: 1,
  allowedOrigins: [],
  ...over,
})
const inst = (id: string, gameId: string, label: string, status: InstanceSummary['status'] = 'stopped'): InstanceSummary => ({
  id,
  gameId,
  accountId: `acc-${id}`,
  label,
  status,
  errorCode: null,
  restoreOnLaunch: false,
})

function state(games: GameSummary[], instances: InstanceSummary[]) {
  const empty = { gameById: {}, hueByGameId: {}, instancesById: {}, accountIdsByGame: {}, runningIds: NO_IDS }
  const indexes = buildIndexes(games, instances, empty)
  return { games, ...indexes }
}

describe('actionsFor: what is offered in each state', () => {
  const names = (status: InstanceSummary['status']): string[] => actionsFor(status).map((a) => a.label)

  it('stopped: Start and Remove', () => expect(names('stopped')).toEqual(['Start', 'Remove']))
  it('starting: only Cancel (stop aborts the start)', () => {
    expect(names('starting')).toEqual(['Cancel'])
    expect(actionsFor('starting')[0]?.action).toBe('stop')
  })
  it('running: Open, Stop, Restart', () => expect(names('running')).toEqual(['Open', 'Stop', 'Restart']))
  it('stopping: nothing, so nothing destructive can be duplicated', () => expect(names('stopping')).toEqual([]))
  it('error: Retry (start) and Remove', () => {
    expect(names('error')).toEqual(['Retry', 'Remove'])
    expect(actionsFor('error')[0]?.action).toBe('start')
  })
  it('crashed: Restart and Remove', () => expect(names('crashed')).toEqual(['Restart', 'Remove']))

  it('only offers actions the backend supports, and never two buttons with the same label', () => {
    for (const status of INSTANCE_STATUSES) {
      const specs = actionsFor(status)
      expect(new Set(specs.map((s) => s.label)).size).toBe(specs.length)
      for (const spec of specs) expect(['open', 'start', 'stop', 'restart', 'remove']).toContain(spec.action)
    }
  })

  it('Remove is the only danger action and every state that can start offers Remove', () => {
    for (const status of INSTANCE_STATUSES) {
      for (const spec of actionsFor(status)) expect(spec.tone === 'danger').toBe(spec.action === 'remove')
    }
    for (const status of ['stopped', 'error', 'crashed'] as const) expect(names(status)).toContain('Remove')
  })

  it('labels every state and flags the transitional and problem ones', () => {
    for (const status of INSTANCE_STATUSES) expect(statusLabel(status)).not.toBe('')
    expect(statusLabel('starting')).toBe('Starting…')
    expect(statusLabel('stopping')).toBe('Stopping…')
    expect(INSTANCE_STATUSES.filter(isBusy)).toEqual(['starting', 'stopping'])
    expect(INSTANCE_STATUSES.filter(needsAttention)).toEqual(['crashed', 'error'])
  })
})

describe('game identity', () => {
  it('is stable and always picks a hue from the fixed set', () => {
    expect(gameHue('abc')).toBe(gameHue('abc'))
    for (let i = 0; i < 200; i++) expect(typeof gameHue(`g-${i}`)).toBe('number')
    expect(new Set(Array.from({ length: 200 }, (_, i) => gameHue(`g-${i}`))).size).toBeGreaterThan(5) // it varies
  })
  it('assignHues: the first ten games get ten different colours, by creation order', () => {
    const games = Array.from({ length: 10 }, (_, i) => ({ id: `game-${i}`, createdAt: 100 - i })) // created in reverse id order
    const hues = assignHues(games)
    expect(new Set(Object.values(hues)).size).toBe(10)
    expect(Object.keys(hues)).toHaveLength(10)
  })
  it('assignHues: a game keeps its colour when later games are added, and ties break by id', () => {
    const older = [{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }]
    const before = assignHues(older)
    const after = assignHues([...older, { id: 'c', createdAt: 3 }])
    expect(after['a']).toBe(before['a'])
    expect(after['b']).toBe(before['b'])
    const tie = assignHues([{ id: 'y', createdAt: 5 }, { id: 'x', createdAt: 5 }])
    expect(tie['x']).toBe(assignHues([{ id: 'x', createdAt: 5 }])['x']) // x sorts first, takes the first colour
    expect(tie['y']).not.toBe(tie['x'])
  })
  it('assignHues: past the palette it wraps instead of failing', () => {
    const hues = assignHues(Array.from({ length: 25 }, (_, i) => ({ id: `g${String(i).padStart(2, '0')}`, createdAt: i })))
    expect(Object.keys(hues)).toHaveLength(25)
    expect(hues['g00']).toBe(hues['g10'])
  })
  it('assignHues: empty is fine', () => expect(assignHues([])).toEqual({}))

  it.each([
    ['Poke Idle', 'PI'],
    ['pokeidle.io', 'PI'], // pokeidle + io
    ['  Idle   Game  Two ', 'IG'],
    ['Zé', 'ZÉ'],
    ['X', 'X'],
    ['', '?'],
    ['---', '?'],
  ])('monogram(%j) = %s', (name, expected) => expect(monogram(name)).toBe(expected))

  it('gameHost never throws', () => {
    expect(gameHost('https://pokeidle.io/play')).toBe('pokeidle.io')
    expect(gameHost('http://localhost:4000/')).toBe('localhost:4000')
    expect(gameHost('not a url')).toBe('not a url')
  })
})

describe('messages: what the user reads', () => {
  it('describes each failure in plain words, with no codes and no raw details', () => {
    for (const operation of ['start', 'stop', 'restart', 'remove', 'create', 'open', 'save', 'load'] as const) {
      for (const code of ['NOT_FOUND', 'INVALID_STATE', 'INVALID_ARGUMENT', 'INTERNAL'] as const) {
        const text = describeFailure(operation, code)
        expect(text.length).toBeGreaterThan(10)
        expect(text).not.toMatch(/NOT_FOUND|INVALID_|INTERNAL|ERR_|Error:|stack|undefined/)
      }
    }
  })
  it('explains why an instance is in error', () => {
    expect(describeInstanceError('ERR_CONNECTION_REFUSED')).toBe('The game refused the connection.')
    expect(describeInstanceError('ERR_NAME_NOT_RESOLVED')).toMatch(/address/)
    expect(describeInstanceError(null)).toBe('It could not be started.')
    expect(describeInstanceError('ERR_SOMETHING_NEW')).toBe("The game didn't load.")
    expect(describeInstanceError('ERR_SOMETHING_NEW')).not.toMatch(/ERR_/)
  })
})

describe('selectors', () => {
  const games = [game('g1', 'Poke Idle', { description: 'A monster idle game' }), game('g2', 'Zed Quest'), game('g3', 'Empty Game')]
  const instances = [
    inst('i1', 'g1', 'main', 'running'),
    inst('i2', 'g1', 'alt', 'stopped'),
    inst('i3', 'g1', 'boxes', 'error'),
    inst('i4', 'g2', 'solo', 'starting'),
  ]
  const s = state(games, instances)

  it('lists games by name, including a game with no accounts', () => {
    expect(visibleGameIds(s, '', 'all')).toEqual(['g3', 'g1', 'g2'])
    expect(s.accountIdsByGame['g3']).toEqual([])
  })
  it('orders accounts by label', () => expect(s.accountIdsByGame['g1']).toEqual(['i2', 'i3', 'i1']))

  it('filters by state', () => {
    expect(visibleGameIds(s, '', 'running')).toEqual(['g1'])
    expect(visibleAccountIds(s, 'g1', '', 'running')).toEqual(['i1'])
    expect(visibleGameIds(s, '', 'problems')).toEqual(['g1'])
    expect(visibleAccountIds(s, 'g1', '', 'problems')).toEqual(['i3'])
    expect(visibleGameIds(s, '', 'problems').includes('g3')).toBe(false)
  })

  it('searches games by name, host and description, case-insensitively', () => {
    expect(visibleGameIds(s, 'POKE', 'all')).toEqual(['g1'])
    expect(visibleGameIds(s, 'monster', 'all')).toEqual(['g1'])
    expect(visibleGameIds(s, 'zedquest.example', 'all')).toEqual(['g2'])
    expect(visibleGameIds(s, 'nothing matches this', 'all')).toEqual([])
  })
  it('a game hit shows all its accounts; an account hit shows only that account', () => {
    expect(visibleAccountIds(s, 'g1', 'poke', 'all')).toEqual(['i2', 'i3', 'i1'])
    expect(visibleAccountIds(s, 'g1', 'boxes', 'all')).toEqual(['i3'])
    expect(visibleGameIds(s, 'boxes', 'all')).toEqual(['g1'])
    expect(visibleAccountIds(s, 'g2', 'boxes', 'all')).toEqual([])
  })
  it('combines search and filter', () => {
    expect(visibleGameIds(s, 'poke', 'problems')).toEqual(['g1'])
    expect(visibleAccountIds(s, 'g1', 'poke', 'problems')).toEqual(['i3'])
    expect(visibleGameIds(s, 'zed', 'running')).toEqual([])
  })

  it('counts per game, including problems and transitional states', () => {
    expect(gameCounts(s, 'g1')).toEqual({ total: 3, running: 1, busy: 0, problems: 1 })
    expect(gameCounts(s, 'g2')).toEqual({ total: 1, running: 0, busy: 1, problems: 0 })
    expect(gameCounts(s, 'g3')).toEqual({ total: 0, running: 0, busy: 0, problems: 0 })
    expect(gameCounts(s, 'unknown')).toEqual({ total: 0, running: 0, busy: 0, problems: 0 })
  })
  it('describes counts in plain words', () => {
    expect(describeCounts(gameCounts(s, 'g3'))).toBe('No accounts yet')
    expect(describeCounts(gameCounts(s, 'g1'))).toBe('3 accounts, 1 running, 1 with a problem')
    expect(describeCounts(gameCounts(s, 'g2'))).toBe('1 account, 1 changing')
    expect(describeCounts({ total: 2, running: 0, busy: 0, problems: 0 })).toBe('2 accounts')
  })

  it('shows the requested running instance, else the first running one, else nothing', () => {
    expect(effectiveFocusedId(['a', 'b'], 'b')).toBe('b')
    expect(effectiveFocusedId(['a', 'b'], 'gone')).toBe('a') // the focused one stopped or was removed
    expect(effectiveFocusedId(['a', 'b'], null)).toBe('a')
    expect(effectiveFocusedId([], 'a')).toBeNull()
  })

  it('keeps the running list in display order: game name, then account label', () => {
    const running = state(
      [game('g1', 'Beta'), game('g2', 'Alpha')],
      [inst('x', 'g1', 'one', 'running'), inst('y', 'g2', 'two', 'running'), inst('z', 'g2', 'one', 'running'), inst('w', 'g2', 'zzz', 'stopped')],
    )
    expect(running.runningIds).toEqual(['z', 'y', 'x'])
  })
})
