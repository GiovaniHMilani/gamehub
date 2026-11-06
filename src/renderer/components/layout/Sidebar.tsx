import { memo } from 'react'
import { useDomainStore } from '../../stores/domain-store'
import { useUiStore, type Screen } from '../../stores/ui-store'
import { StatusLamp } from '../common/StatusLamp'
import { useGameStyle } from '../common/Monogram'

interface NavEntry {
  screen: Screen
  label: string
}

const ENTRIES: readonly NavEntry[] = [
  { screen: 'library', label: 'Library' },
  { screen: 'play', label: 'Play' },
  { screen: 'settings', label: 'Settings' },
]

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span data-testid="app-title">GameHub</span>
      </div>
      <Navigation />
      <RunningList />
      <SyncIndicator />
    </aside>
  )
}

function Navigation() {
  const screen = useUiStore((s) => s.screen)
  const navigate = useUiStore((s) => s.navigate)
  const runningCount = useDomainStore((s) => s.runningIds.length)

  return (
    <nav className="nav" aria-label="Main">
      {ENTRIES.map((entry) => (
        <button
          key={entry.screen}
          type="button"
          className="nav-item"
          aria-current={screen === entry.screen ? 'page' : undefined}
          onClick={() => navigate(entry.screen)}
        >
          <span>{entry.label}</span>
          {entry.screen === 'play' && runningCount > 0 ? <span className="nav-count">{runningCount}</span> : null}
        </button>
      ))}
    </nav>
  )
}

function RunningList() {
  const runningIds = useDomainStore((s) => s.runningIds)

  return (
    <section className="sidebar-section" aria-label="Running accounts">
      <h2 className="sidebar-heading">Running</h2>
      {runningIds.length === 0 ? (
        <p className="sidebar-empty">Nothing is running yet.</p>
      ) : (
        <ul className="running-list">
          {runningIds.map((id) => (
            <RunningItem key={id} instanceId={id} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** One entry per running account. Subscribes to its own instance and to whether it is the one on screen. */
const RunningItem = memo(function RunningItem({ instanceId }: { instanceId: string }) {
  const instance = useDomainStore((s) => s.instancesById[instanceId])
  const gameName = useDomainStore((s) => (instance === undefined ? undefined : s.gameById[instance.gameId]?.name))
  const isShown = useUiStore((s) => s.screen === 'play' && s.focusedInstanceId === instanceId)
  const openInstance = useUiStore((s) => s.openInstance)
  const style = useGameStyle(instance?.gameId ?? '')
  if (instance === undefined) return null

  return (
    <li>
      <button
        type="button"
        className="running-item"
        style={style}
        aria-current={isShown ? 'true' : undefined}
        onClick={() => openInstance(instanceId)}
      >
        <StatusLamp state={instance.status} />
        <span className="running-item-text">
          <span className="running-item-label">{instance.label}</span>
          <span className="running-item-game">{gameName ?? 'Unknown game'}</span>
        </span>
      </button>
    </li>
  )
})

/** Its own component, so the sequence number changing on every event re-renders only this. */
function SyncIndicator() {
  const live = useDomainStore((s) => s.status === 'ready')
  const seq = useDomainStore((s) => s.seq)
  const resyncs = useDomainStore((s) => s.resyncs)

  return (
    <div className="sidebar-footer" data-testid="sync-status" data-seq={seq ?? ''} data-resyncs={resyncs} data-live={live}>
      <StatusLamp state={live ? 'live' : 'starting'} />
      <span>{live ? 'Up to date' : 'Connecting…'}</span>
    </div>
  )
}
