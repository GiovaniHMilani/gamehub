import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { useGameStyle } from '../../components/common/Monogram'
import { StatusLamp } from '../../components/common/StatusLamp'
import { useStageSlots } from '../../hooks/useStageSlots'
import { computeTiles, type PlayMode } from '../../model/stage-layout'
import { focusInstance, performInstanceAction } from '../../stores/actions'
import { useDomainStore } from '../../stores/domain-store'
import { useUiStore } from '../../stores/ui-store'

interface StageViewportProps {
  instanceIds: readonly string[]
  mode: PlayMode
  /** The instance that should receive keyboard focus once its view is in place. */
  focusId: string
}

/**
 * The region where Main puts game views. It owns NO game content: it measures itself, arranges
 * tiles, reports the rectangles, and draws the headers that sit above each view.
 */
export function StageViewport({ instanceIds, mode, focusId }: StageViewportProps) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const occluded = useUiStore((s) => s.dialog !== null)

  useLayoutEffect(() => {
    const element = container.current
    if (element === null) return
    const measure = (): void => {
      const width = Math.floor(element.clientWidth)
      const height = Math.floor(element.clientHeight)
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const tiles = useMemo(() => computeTiles(size, instanceIds, mode), [size, instanceIds, mode])
  useStageSlots(container, tiles, occluded, focusId, (id) => void focusInstance(api(), id))

  return (
    <div ref={container} className="stage" data-testid="stage">
      {tiles.map((tile) =>
        tile.header === null ? null : <TileHeader key={tile.instanceId} instanceId={tile.instanceId} rect={tile.header} />,
      )}
      {occluded ? <p className="stage-note">Paused behind the open dialog</p> : null}
    </div>
  )
}

const TileHeader = memo(function TileHeader({ instanceId, rect }: { instanceId: string; rect: { x: number; y: number; width: number; height: number } }) {
  const instance = useDomainStore((s) => s.instancesById[instanceId])
  const gameName = useDomainStore((s) => (instance === undefined ? undefined : s.gameById[instance.gameId]?.name))
  const openInstance = useUiStore((s) => s.openInstance)
  const gameColour = useGameStyle(instance?.gameId ?? '')
  if (instance === undefined) return null

  return (
    <div
      className="tile-header"
      style={{ ...gameColour, left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      data-testid={`tile-${instance.label}`}
    >
      <StatusLamp state={instance.status} />
      <span className="tile-label" title={`${instance.label} in ${gameName ?? 'unknown game'}`}>
        {instance.label} <span className="tile-game">{gameName}</span>
      </span>
      <Button size="small" tone="quiet" onClick={() => openInstance(instanceId)}>Focus</Button>
      <Button size="small" tone="quiet" onClick={() => void performInstanceAction(api(), instanceId, 'stop')}>Stop</Button>
    </div>
  )
})
