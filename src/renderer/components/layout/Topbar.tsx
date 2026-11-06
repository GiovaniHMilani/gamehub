import { PlayToolbar } from '../../features/play/PlayToolbar'
import { useDomainStore } from '../../stores/domain-store'
import { effectiveFocusedId } from '../../stores/selectors'
import { useUiStore, type Screen } from '../../stores/ui-store'
import { Button } from '../common/Button'
import { Icon } from '../common/Icon'
import { ToastRegion } from '../feedback/ToastRegion'

const TITLES: Readonly<Record<Screen, string>> = {
  library: 'Library',
  play: 'Play',
  settings: 'Settings',
}

export function Topbar() {
  const screen = useUiStore((s) => s.screen)
  const requested = useUiStore((s) => s.focusedInstanceId)
  const openDialog = useUiStore((s) => s.openDialog)
  const runningIds = useDomainStore((s) => s.runningIds)
  const focusId = effectiveFocusedId(runningIds, requested)

  // Playing: the bar becomes the game's toolbar. With nothing running it is the usual bar.
  if (screen === 'play' && focusId !== null) return <PlayToolbar focusId={focusId} runningCount={runningIds.length} />

  return (
    <header className="topbar">
      <h1 className="topbar-title">{TITLES[screen]}</h1>
      <ToastRegion />
      <Button size="small" onClick={() => openDialog({ kind: 'addGame' })}>
        <Icon name="plus" size={14} />
        Add game
      </Button>
    </header>
  )
}
