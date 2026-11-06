import { useUiStore, type Screen } from '../../stores/ui-store'
import { Button } from '../common/Button'
import { ToastRegion } from '../feedback/ToastRegion'

const TITLES: Readonly<Record<Screen, string>> = {
  library: 'Library',
  play: 'Play',
  settings: 'Settings',
}

export function Topbar() {
  const screen = useUiStore((s) => s.screen)
  const openDialog = useUiStore((s) => s.openDialog)

  return (
    <header className="topbar">
      <h1 className="topbar-title">{TITLES[screen]}</h1>
      <ToastRegion />
      <Button tone="primary" onClick={() => openDialog({ kind: 'addGame' })}>
        Add game
      </Button>
    </header>
  )
}
