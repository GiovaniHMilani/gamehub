import { memo } from 'react'
import { useDomainStore } from '../../stores/domain-store'
import { useUiStore, type Screen } from '../../stores/ui-store'
import { Icon, type IconName } from '../common/Icon'
import { Portrait } from '../common/Monogram'
import { StatusLamp } from '../common/StatusLamp'
import { useGameStyle } from '../common/Monogram'

interface NavEntry {
  screen: Screen
  label: string
  icon: IconName
}

const ENTRIES: readonly NavEntry[] = [
  { screen: 'library', label: 'Library', icon: 'library' },
  { screen: 'play', label: 'Play', icon: 'controller' },
  { screen: 'settings', label: 'Settings', icon: 'settings' },
]

/**
 * A narrow launcher rail: the mark, three destinations, and the party that is running right now.
 * Names are in the accessible label and the tooltip, not in the way.
 */
export function Sidebar() {
  return (
    <aside className="rail">
      <div className="brand" title="GameHub">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <defs>
            <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffc861" />
              <stop offset="1" stopColor="#ff8a1f" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="10" fill="url(#brand-g)" />
          <path d="M12.500 9.500v13a.8.8 0 0 0 1.200.7l10.200-6.500a.8.8 0 0 0 0-1.400L13.700 8.800a.8.8 0 0 0-1.200.7Z" fill="#2a1700" />
          <circle cx="8" cy="12" r="1.500" fill="#2a1700" opacity=".55" />
          <circle cx="8" cy="20" r="1.500" fill="#2a1700" opacity=".55" />
        </svg>
        <span className="visually-hidden" data-testid="app-title">GameHub</span>
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
          title={entry.label}
          aria-label={entry.label}
          aria-current={screen === entry.screen ? 'page' : undefined}
          onClick={() => navigate(entry.screen)}
        >
          <Icon name={entry.icon} size={22} />
          {entry.screen === 'play' && runningCount > 0 ? <span className="nav-count" aria-label={`${runningCount} running`}>{runningCount}</span> : null}
        </button>
      ))}
    </nav>
  )
}

function RunningList() {
  const runningIds = useDomainStore((s) => s.runningIds)

  return (
    <section className="party" aria-label="Running accounts">
      {runningIds.length === 0 ? (
        <p className="party-empty">Nothing running</p>
      ) : (
        <ul className="party-list">
          {runningIds.map((id) => (
            <RunningItem key={id} instanceId={id} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** One portrait per running account. Subscribes to its own instance and to whether it is the one on screen. */
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
        className="party-item"
        style={style}
        title={`${instance.label} in ${gameName ?? 'unknown game'}`}
        aria-label={`${instance.label}, ${gameName ?? 'unknown game'}`}
        aria-current={isShown ? 'true' : undefined}
        onClick={() => openInstance(instanceId)}
      >
        <Portrait gameId={instance.gameId} label={instance.label} status={instance.status} size="large" />
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
    <div
      className="rail-footer"
      data-testid="sync-status"
      data-seq={seq ?? ''}
      data-resyncs={resyncs}
      data-live={live}
      title={live ? 'Up to date' : 'Connecting…'}
    >
      <StatusLamp state={live ? 'live' : 'starting'} />
      <span className="visually-hidden">{live ? 'Up to date' : 'Connecting…'}</span>
    </div>
  )
}
