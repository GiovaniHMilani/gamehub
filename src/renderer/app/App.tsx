import { useEffect, useRef } from 'react'
import { api } from '../api'
import { ErrorPanel } from '../components/feedback/ErrorPanel'
import { LoadingPanel } from '../components/feedback/LoadingPanel'
import { NoticeBar } from '../components/feedback/NoticeBar'
import { Sidebar } from '../components/layout/Sidebar'
import { Topbar } from '../components/layout/Topbar'
import { DialogHost } from '../features/dialogs/DialogHost'
import { LibraryScreen } from '../features/library/LibraryScreen'
import { PlayScreen } from '../features/play/PlayScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'
import { useDomainStore } from '../stores/domain-store'
import { startSync, type SyncHandle } from '../stores/sync'
import { useUiStore } from '../stores/ui-store'

/**
 * The GameHub shell. It shows what Main reports and asks Main to act; it owns no instance,
 * session or game view. Subscriptions start once and are released on unmount.
 */
export function App() {
  const sync = useRef<SyncHandle | null>(null)

  useEffect(() => {
    const handle = startSync(api())
    sync.current = handle
    return () => {
      handle.stop()
      sync.current = null
    }
  }, [])

  return (
    <div className="shell" data-testid="app-root">
      <Sidebar />
      <div className="main">
        <Topbar />
        <NoticeBar />
        <Content onRetry={() => sync.current?.retry()} />
      </div>
      <DialogHost />
    </div>
  )
}

function Content({ onRetry }: { onRetry: () => void }) {
  const status = useDomainStore((s) => s.status)
  const screen = useUiStore((s) => s.screen)

  if (status === 'loading') return <LoadingPanel />
  if (status === 'error') return <ErrorPanel onRetry={onRetry} />

  switch (screen) {
    case 'library':
      return <LibraryScreen />
    case 'play':
      return <PlayScreen />
    case 'settings':
      return <SettingsScreen />
  }
}
