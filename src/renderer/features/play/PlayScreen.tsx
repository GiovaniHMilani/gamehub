import { useMemo } from 'react'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { StatePanel } from '../../components/common/StatePanel'
import { StatusLamp } from '../../components/common/StatusLamp'
import { useGameStyle } from '../../components/common/Monogram'
import { MAX_GRID_TILES, type PlayMode } from '../../model/stage-layout'
import { performInstanceAction } from '../../stores/actions'
import { NO_IDS, useDomainStore } from '../../stores/domain-store'
import { effectiveFocusedId } from '../../stores/selectors'
import { useUiStore } from '../../stores/ui-store'
import { StageViewport } from './StageViewport'

/**
 * Where running accounts are used. The instance shown is DERIVED (the requested one if it still
 * runs, else the first running one), so an account that stops or is removed never leaves this
 * screen pointing at nothing.
 */
export function PlayScreen() {
  const runningIds = useDomainStore((s) => s.runningIds)
  const requested = useUiStore((s) => s.focusedInstanceId)
  const mode = useUiStore((s) => s.playMode)
  const navigate = useUiStore((s) => s.navigate)
  const focusId = effectiveFocusedId(runningIds, requested)

  const shownIds = useMemo(() => (mode === 'focus' ? (focusId === null ? NO_IDS : [focusId]) : runningIds), [mode, focusId, runningIds])

  if (focusId === null) {
    return (
      <StatePanel title="Nothing is running">
        <p>Start an account from the library and it will show up here.</p>
        <Button tone="primary" onClick={() => navigate('library')}>Go to the library</Button>
      </StatePanel>
    )
  }

  return (
    <section className="play" aria-label="Running accounts">
      <PlayToolbar focusId={focusId} mode={mode} runningCount={runningIds.length} />
      <StageViewport instanceIds={shownIds} mode={mode} focusId={focusId} />
    </section>
  )
}

function PlayToolbar({ focusId, mode, runningCount }: { focusId: string; mode: PlayMode; runningCount: number }) {
  const instance = useDomainStore((s) => s.instancesById[focusId])
  const gameName = useDomainStore((s) => (instance === undefined ? undefined : s.gameById[instance.gameId]?.name))
  const setPlayMode = useUiStore((s) => s.setPlayMode)
  const openInstance = useUiStore((s) => s.openInstance)
  const pending = useUiStore((s) => s.pending[focusId])
  const style = useGameStyle(instance?.gameId ?? '')
  if (instance === undefined) return null

  return (
    <div className="play-toolbar" style={style}>
      {mode === 'focus' ? (
        <div className="play-title">
          <StatusLamp state={instance.status} />
          <h2 className="play-title-text">{instance.label}</h2>
          <span className="play-title-game play-title-text">{gameName}</span>
        </div>
      ) : (
        <div className="play-title">
          <h2 className="play-title-text">All running accounts</h2>
          {runningCount > MAX_GRID_TILES ? (
            <span className="play-title-game">Showing {MAX_GRID_TILES} of {runningCount}</span>
          ) : null}
        </div>
      )}

      {runningCount > 1 ? (
        <div className="segmented" role="group" aria-label="Layout">
          <button type="button" aria-pressed={mode === 'focus'} onClick={() => openInstance(focusId)}>One</button>
          <button type="button" aria-pressed={mode === 'grid'} onClick={() => setPlayMode('grid')}>All</button>
        </div>
      ) : null}

      {mode === 'focus' ? (
        <div className="play-actions">
          <Button size="small" disabled={pending === 'restart'} onClick={() => void performInstanceAction(api(), focusId, 'restart')}>Restart</Button>
          <Button size="small" disabled={pending === 'stop'} onClick={() => void performInstanceAction(api(), focusId, 'stop')}>Stop</Button>
        </div>
      ) : null}
    </div>
  )
}
