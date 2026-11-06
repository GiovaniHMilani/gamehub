/**
 * Where game views are shown (ADR-0017). The renderer decides the arrangement and
 * reports the rectangles; Main validates and applies them. Coordinates are in the
 * shell's own CSS pixels, which equal the window's content coordinates.
 */
export const MAX_STAGE_SLOTS = 16

export interface StageSlot {
  readonly instanceId: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface StageLayoutInput {
  readonly slots: readonly StageSlot[]
}
