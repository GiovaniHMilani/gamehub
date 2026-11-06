import { MAX_STAGE_SLOTS, type StageSlot } from '@shared/domain/stage-layout'

/**
 * Arranges running instances inside the Play viewport (ADR-0017). The renderer owns the
 * arrangement because it also draws the tile headers; Main only receives the resulting
 * slots and applies them after its own validation.
 */
export type PlayMode = 'focus' | 'grid'

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Tile {
  readonly instanceId: string
  /** Where the DOM header is drawn (viewport-local). Null in focus mode: the toolbar is the header. */
  readonly header: Rect | null
  /** Where the game view is shown (viewport-local). */
  readonly view: Rect
}

export const GRID_GAP = 8
export const GRID_HEADER = 30
/** More than this and tiles become too small to be useful; the rest stay running, just not shown. */
export const MAX_GRID_TILES = 9

export function gridColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)))
}

/** Local (viewport-relative) tiles for the instances to show. Pure. */
export function computeTiles(viewport: { width: number; height: number }, instanceIds: readonly string[], mode: PlayMode): Tile[] {
  const width = Math.floor(viewport.width)
  const height = Math.floor(viewport.height)
  if (width < 1 || height < 1) return []

  if (mode === 'focus') {
    const first = instanceIds[0]
    return first === undefined ? [] : [{ instanceId: first, header: null, view: { x: 0, y: 0, width, height } }]
  }

  const shown = instanceIds.slice(0, Math.min(MAX_GRID_TILES, MAX_STAGE_SLOTS))
  const count = shown.length
  if (count === 0) return []
  const columns = gridColumns(count)
  const rows = Math.ceil(count / columns)
  const cellWidth = Math.floor((width - GRID_GAP * (columns - 1)) / columns)
  const cellHeight = Math.floor((height - GRID_GAP * (rows - 1)) / rows)
  if (cellWidth < 1 || cellHeight <= GRID_HEADER) return []

  return shown.map((instanceId, index) => {
    const x = (index % columns) * (cellWidth + GRID_GAP)
    const y = Math.floor(index / columns) * (cellHeight + GRID_GAP)
    return {
      instanceId,
      header: { x, y, width: cellWidth, height: GRID_HEADER },
      view: { x, y: y + GRID_HEADER, width: cellWidth, height: cellHeight - GRID_HEADER },
    }
  })
}

/** Slots in window coordinates: tile positions plus the viewport's own origin, as whole pixels. */
export function toSlots(tiles: readonly Tile[], origin: { x: number; y: number }): StageSlot[] {
  return tiles.map(({ instanceId, view }) => ({
    instanceId,
    x: Math.max(0, Math.round(origin.x + view.x)),
    y: Math.max(0, Math.round(origin.y + view.y)),
    width: Math.max(1, Math.round(view.width)),
    height: Math.max(1, Math.round(view.height)),
  }))
}

/** Cheap structural equality, so an unchanged layout is not re-sent while resizing. */
export function sameSlots(a: readonly StageSlot[], b: readonly StageSlot[]): boolean {
  if (a.length !== b.length) return false
  return a.every((slot, i) => {
    const other = b[i]
    return (
      other !== undefined &&
      slot.instanceId === other.instanceId &&
      slot.x === other.x &&
      slot.y === other.y &&
      slot.width === other.width &&
      slot.height === other.height
    )
  })
}
