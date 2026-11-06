import { MAX_STAGE_SLOTS, type StageSlot } from '@shared/domain/stage-layout'

export interface ContentSize {
  readonly width: number
  readonly height: number
}

/**
 * Turns a layout REQUEST from the renderer into rectangles Main is willing to apply.
 * Pure. The renderer is not trusted with geometry either:
 *  - only mounted views can be placed (an unknown id is ignored);
 *  - each instance appears at most once (the first request wins);
 *  - at most MAX_STAGE_SLOTS slots;
 *  - every rectangle is clamped into the window's content area, and one that ends up
 *    empty is dropped (a view can never cover anything outside the window).
 * Views not in the result are hidden by the caller.
 */
export function normalizeSlots(
  requested: readonly StageSlot[],
  content: ContentSize,
  isMounted: (instanceId: string) => boolean,
): StageSlot[] {
  const seen = new Set<string>()
  const result: StageSlot[] = []
  for (const slot of requested) {
    if (result.length >= MAX_STAGE_SLOTS) break
    if (seen.has(slot.instanceId) || !isMounted(slot.instanceId)) continue
    seen.add(slot.instanceId)

    const x = Math.min(Math.max(0, Math.trunc(slot.x)), content.width)
    const y = Math.min(Math.max(0, Math.trunc(slot.y)), content.height)
    const width = Math.min(Math.trunc(slot.width), content.width - x)
    const height = Math.min(Math.trunc(slot.height), content.height - y)
    if (width < 1 || height < 1) continue
    result.push({ instanceId: slot.instanceId, x, y, width, height })
  }
  return result
}
