import { api } from '../../api'
import { Icon } from '../../components/common/Icon'
import { Portrait, useGameStyle } from '../../components/common/Monogram'
import { ToastRegion } from '../../components/feedback/ToastRegion'
import { MAX_GRID_TILES } from '../../model/stage-layout'
import { performInstanceAction } from '../../stores/actions'
import { useDomainStore } from '../../stores/domain-store'
import { useUiStore } from '../../stores/ui-store'

/**
 * On the Play screen the top bar IS the toolbar: the account and its game, how many to show, and the
 * two things you do to a running account. The shell steps back so the games get the room.
 */
export function PlayToolbar({ focusId, runningCount }: { focusId: string; runningCount: number }) {
  const instance = useDomainStore((s) => s.instancesById[focusId])
  const gameName = useDomainStore((s) => (instance === undefined ? undefined : s.gameById[instance.gameId]?.name))
  const mode = useUiStore((s) => s.playMode)
  const setPlayMode = useUiStore((s) => s.setPlayMode)
  const openInstance = useUiStore((s) => s.openInstance)
  const pending = useUiStore((s) => s.pending[focusId])
  const openDialog = useUiStore((s) => s.openDialog)
  const style = useGameStyle(instance?.gameId ?? '')
  if (instance === undefined) return null

  return (
    <header className="topbar topbar-play" style={style}>
      {mode === 'focus' ? (
        <div className="dock-title">
          <Portrait gameId={instance.gameId} label={instance.label} status={instance.status} />
          <h1 className="dock-name">{instance.label}</h1>
          <span className="dock-game">{gameName}</span>
        </div>
      ) : (
        <div className="dock-title">
          <h1 className="dock-name">All running accounts</h1>
          {runningCount > MAX_GRID_TILES ? <span className="dock-game">Showing {MAX_GRID_TILES} of {runningCount}</span> : null}
        </div>
      )}

      <ToastRegion />

      {runningCount > 1 ? (
        <div className="segmented" role="group" aria-label="Layout">
          <button type="button" aria-pressed={mode === 'focus'} onClick={() => openInstance(focusId)}>
            <Icon name="one" size={14} />
            One
          </button>
          <button type="button" aria-pressed={mode === 'grid'} onClick={() => setPlayMode('grid')}>
            <Icon name="grid" size={14} />
            All
          </button>
        </div>
      ) : null}

      {mode === 'focus' ? (
        <div className="dock-actions">
          <button type="button" className="icon-btn" aria-label="Restart" title="Restart" disabled={pending === 'restart'} onClick={() => void performInstanceAction(api(), focusId, 'restart')}>
            <Icon name="restart" size={17} />
          </button>
          <button type="button" className="icon-btn" aria-label="Stop" title="Stop" disabled={pending === 'stop'} onClick={() => void performInstanceAction(api(), focusId, 'stop')}>
            <Icon name="stop" size={15} />
          </button>
        </div>
      ) : null}

      <button type="button" className="icon-btn" aria-label="Add game" title="Add game" onClick={() => openDialog({ kind: 'addGame' })}>
        <Icon name="plus" size={17} />
      </button>
    </header>
  )
}
