import { useEffect, useRef, type RefObject } from 'react'
import type { StageSlot } from '@shared/domain/stage-layout'
import { api } from '../api'
import { sameSlots, toSlots, type Tile } from '../model/stage-layout'

/**
 * Reports to Main where the game views should be shown (ADR-0017). The renderer only ASKS;
 * Main validates, clamps and applies, and hides every view that is not listed.
 *
 *  - requests are coalesced to one per animation frame and skipped when nothing changed, so
 *    dragging the window edge sends at most the frames that really moved;
 *  - while `occluded` (a dialog is open) it asks for nothing to be shown: native views are drawn
 *    above the page, so they would cover the dialog;
 *  - leaving the screen asks for everything to be hidden.
 *
 * `onPlaced` runs when an instance's view has just been given a place, which is the moment its
 * keyboard focus can be handed over.
 */
export function useStageSlots(
  container: RefObject<HTMLElement | null>,
  tiles: readonly Tile[],
  occluded: boolean,
  focusId: string | null,
  onPlaced: (instanceId: string) => void,
): void {
  const lastSent = useRef<readonly StageSlot[] | null>(null)
  const onPlacedRef = useRef(onPlaced)
  onPlacedRef.current = onPlaced

  useEffect(() => {
    const element = container.current
    if (element === null) return
    let frame = 0

    const send = (): void => {
      frame = 0
      const rect = element.getBoundingClientRect()
      const slots = occluded ? [] : toSlots(tiles, { x: rect.x, y: rect.y })
      const previous = lastSent.current
      if (previous !== null && sameSlots(previous, slots)) return
      lastSent.current = slots
      api().stage.setLayout(slots)

      const placedNow = focusId !== null && slots.some((slot) => slot.instanceId === focusId)
      const wasPlaced = focusId !== null && previous?.some((slot) => slot.instanceId === focusId) === true
      if (placedNow && !wasPlaced && focusId !== null) onPlacedRef.current(focusId)
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(send)
    }

    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener('resize', schedule)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [container, tiles, occluded, focusId])

  // Leaving the Play screen: nothing may stay on top of the next screen.
  useEffect(
    () => () => {
      lastSent.current = null
      api().stage.setLayout([])
    },
    [],
  )
}
