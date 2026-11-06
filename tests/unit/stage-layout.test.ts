import { describe, expect, it } from 'vitest'
import { MAX_STAGE_SLOTS, type StageSlot } from '@shared/domain/stage-layout'
import { stageLayoutSchema } from '@shared/ipc/schemas'
import { normalizeSlots } from '../../src/main/window/layout'
import {
  computeTiles,
  GRID_GAP,
  GRID_HEADER,
  gridColumns,
  MAX_GRID_TILES,
  sameSlots,
  toSlots,
  type Rect,
} from '../../src/renderer/model/stage-layout'

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const inside = (r: Rect, w: number, h: number): boolean => r.x >= 0 && r.y >= 0 && r.x + r.width <= w && r.y + r.height <= h

describe('computeTiles (renderer decides the arrangement)', () => {
  const viewport = { width: 1000, height: 600 }

  it('focus mode: one tile filling the viewport, no header', () => {
    const [tile, ...rest] = computeTiles(viewport, ids(3), 'focus')
    expect(rest).toEqual([])
    expect(tile).toEqual({ instanceId: ids(3)[0], header: null, view: { x: 0, y: 0, width: 1000, height: 600 } })
  })
  it('shows nothing when nothing runs, or when there is no room', () => {
    expect(computeTiles(viewport, [], 'focus')).toEqual([])
    expect(computeTiles(viewport, [], 'grid')).toEqual([])
    expect(computeTiles({ width: 0, height: 600 }, ids(2), 'grid')).toEqual([])
    expect(computeTiles({ width: 1000, height: GRID_HEADER }, ids(2), 'grid')).toEqual([])
  })

  it.each([1, 2, 3, 4, 5, 6, 9])('grid of %i: tiles stay inside the viewport and never overlap, headers sit above views', (n) => {
    const tiles = computeTiles(viewport, ids(n), 'grid')
    expect(tiles).toHaveLength(n)
    for (const tile of tiles) {
      expect(inside(tile.view, viewport.width, viewport.height)).toBe(true)
      expect(tile.header).not.toBeNull()
      const header = tile.header as Rect
      expect(header.height).toBe(GRID_HEADER)
      expect(header.y + header.height).toBe(tile.view.y) // the header is exactly the strip above the view
      expect(header.x).toBe(tile.view.x)
      expect(header.width).toBe(tile.view.width)
    }
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i] as (typeof tiles)[number]
        const b = tiles[j] as (typeof tiles)[number]
        expect(overlap({ ...a.view, y: a.view.y - GRID_HEADER, height: a.view.height + GRID_HEADER }, { ...b.view, y: b.view.y - GRID_HEADER, height: b.view.height + GRID_HEADER })).toBe(false)
      }
    }
  })

  it('caps the grid: more instances run than are shown, in order', () => {
    const tiles = computeTiles(viewport, ids(20), 'grid')
    expect(tiles).toHaveLength(MAX_GRID_TILES)
    expect(tiles.map((t) => t.instanceId)).toEqual(ids(MAX_GRID_TILES))
    expect(MAX_GRID_TILES).toBeLessThanOrEqual(MAX_STAGE_SLOTS)
  })
  it('uses a near-square grid', () => {
    expect([1, 2, 3, 4, 5, 9].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3])
    expect(GRID_GAP).toBeGreaterThan(0)
  })
  it('stays valid on fractional viewports (HiDPI)', () => {
    const tiles = computeTiles({ width: 1000.6, height: 599.4 }, ids(4), 'grid')
    for (const t of tiles) expect(Number.isInteger(t.view.width) && Number.isInteger(t.view.height)).toBe(true)
  })
})

describe('toSlots / sameSlots', () => {
  it('adds the viewport origin and rounds to whole pixels', () => {
    const slots = toSlots([{ instanceId: 'a', header: null, view: { x: 10, y: 5, width: 300.4, height: 200.6 } }], { x: 232.5, y: 56.2 })
    expect(slots).toEqual([{ instanceId: 'a', x: 243, y: 61, width: 300, height: 201 }])
  })
  it('never produces a negative origin or an empty size', () => {
    const [slot] = toSlots([{ instanceId: 'a', header: null, view: { x: 0, y: 0, width: 0.2, height: 0.2 } }], { x: -5, y: -5 })
    expect(slot).toEqual({ instanceId: 'a', x: 0, y: 0, width: 1, height: 1 })
  })
  it('detects an unchanged layout, so resizing does not resend it', () => {
    const a: StageSlot[] = [{ instanceId: 'a', x: 1, y: 2, width: 3, height: 4 }]
    expect(sameSlots(a, [{ ...(a[0] as StageSlot) }])).toBe(true)
    expect(sameSlots(a, [{ ...(a[0] as StageSlot), width: 5 }])).toBe(false)
    expect(sameSlots(a, [])).toBe(false)
    expect(sameSlots([], [])).toBe(true)
  })
})

describe('normalizeSlots (Main does not trust the renderer with geometry)', () => {
  const content = { width: 1200, height: 800 }
  const slot = (instanceId: string, x: number, y: number, width: number, height: number): StageSlot => ({ instanceId, x, y, width, height })
  const mounted = (...known: string[]) => (id: string): boolean => known.includes(id)

  it('keeps a valid slot as it is', () => {
    expect(normalizeSlots([slot('a', 232, 56, 900, 700)], content, mounted('a'))).toEqual([slot('a', 232, 56, 900, 700)])
  })
  it('ignores instances that are not mounted', () => {
    expect(normalizeSlots([slot('ghost', 0, 0, 100, 100), slot('a', 0, 0, 100, 100)], content, mounted('a')).map((s) => s.instanceId)).toEqual(['a'])
  })
  it('keeps only the first slot of an instance', () => {
    const result = normalizeSlots([slot('a', 0, 0, 100, 100), slot('a', 500, 500, 100, 100)], content, mounted('a'))
    expect(result).toEqual([slot('a', 0, 0, 100, 100)])
  })
  it('clamps a rectangle that sticks out of the window', () => {
    expect(normalizeSlots([slot('a', 1000, 700, 900, 900)], content, mounted('a'))).toEqual([slot('a', 1000, 700, 200, 100)])
    expect(normalizeSlots([slot('a', -50, -50, 100, 100)], content, mounted('a'))).toEqual([slot('a', 0, 0, 100, 100)])
  })
  it('drops a rectangle that ends up empty (entirely outside)', () => {
    expect(normalizeSlots([slot('a', 1200, 0, 100, 100)], content, mounted('a'))).toEqual([])
    expect(normalizeSlots([slot('a', 0, 800, 100, 100)], content, mounted('a'))).toEqual([])
    expect(normalizeSlots([slot('a', 0, 0, 0, 100)], content, mounted('a'))).toEqual([])
  })
  it('handles a window with no content area (minimised)', () => {
    expect(normalizeSlots([slot('a', 0, 0, 100, 100)], { width: 0, height: 0 }, mounted('a'))).toEqual([])
  })
  it('never returns more than MAX_STAGE_SLOTS, and never a rectangle outside the content', () => {
    const many = Array.from({ length: 40 }, (_, i) => slot(`i${i}`, i * 40, 0, 500, 500))
    const result = normalizeSlots(many, content, () => true)
    expect(result).toHaveLength(MAX_STAGE_SLOTS)
    for (const s of result) expect(s.x + s.width <= content.width && s.y + s.height <= content.height).toBe(true)
  })
})

describe('stageLayoutSchema (the IPC boundary)', () => {
  const id = '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b'
  const ok = { instanceId: id, x: 0, y: 0, width: 10, height: 10 }
  it('accepts an empty layout (everything hidden) and valid slots', () => {
    expect(stageLayoutSchema.safeParse({ slots: [] }).success).toBe(true)
    expect(stageLayoutSchema.safeParse({ slots: [ok] }).success).toBe(true)
  })
  it.each([
    ['float', { ...ok, width: 10.5 }],
    ['negative origin', { ...ok, x: -1 }],
    ['zero size', { ...ok, height: 0 }],
    ['absurd size', { ...ok, width: 1_000_000 }],
    ['NaN', { ...ok, x: Number.NaN }],
    ['not a uuid', { ...ok, instanceId: '../../x' }],
    ['extra key', { ...ok, partition: 'persist:evil' }],
    ['string number', { ...ok, x: '1' }],
  ])('rejects %s', (_name, bad) => expect(stageLayoutSchema.safeParse({ slots: [bad] }).success).toBe(false))
  it('rejects too many slots, extra top-level keys and non-objects', () => {
    expect(stageLayoutSchema.safeParse({ slots: Array.from({ length: MAX_STAGE_SLOTS + 1 }, () => ok) }).success).toBe(false)
    expect(stageLayoutSchema.safeParse({ slots: [], extra: 1 }).success).toBe(false)
    for (const bad of [null, 'x', 1, []]) expect(stageLayoutSchema.safeParse(bad).success).toBe(false)
  })
})
