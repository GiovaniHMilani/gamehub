import { useShallow } from 'zustand/react/shallow'
import { Button } from '../../components/common/Button'
import { Icon } from '../../components/common/Icon'
import { StatePanel } from '../../components/common/StatePanel'
import { useDomainStore } from '../../stores/domain-store'
import { visibleGameIds } from '../../stores/selectors'
import { useUiStore, type LibraryFilter } from '../../stores/ui-store'
import { GameSection } from './GameSection'

const FILTERS: ReadonlyArray<{ value: LibraryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'problems', label: 'Problems' },
]

export function LibraryScreen() {
  const search = useUiStore((s) => s.search)
  const filter = useUiStore((s) => s.filter)
  const setSearch = useUiStore((s) => s.setSearch)
  const setFilter = useUiStore((s) => s.setFilter)
  const openDialog = useUiStore((s) => s.openDialog)
  const gameCount = useDomainStore((s) => s.games.length)
  const gameIds = useDomainStore(useShallow((s) => visibleGameIds(s, search, filter)))

  if (gameCount === 0) {
    return (
      <div className="panel-center">
        <div className="welcome">
          <div className="welcome-stack" aria-hidden="true">
            <span className="welcome-card" data-n="1" />
            <span className="welcome-card" data-n="2" />
            <span className="welcome-card" data-n="3">
              <Icon name="play" size={34} />
            </span>
          </div>
          <h2>No games yet</h2>
          <p>Add a game, then give it as many accounts as you like. Each one is its own browser, so they can all play at once.</p>
          <Button tone="play" size="large" onClick={() => openDialog({ kind: 'addGame' })}>
            <Icon name="plus" size={16} />
            Add game
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="library-header">
        <label className="search-wrap">
          <Icon name="library" size={16} />
          <input
            type="search"
            className="search"
            aria-label="Search games and accounts"
            placeholder="Search games and accounts"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="segmented" role="group" aria-label="Show">
          {FILTERS.map((entry) => (
            <button key={entry.value} type="button" aria-pressed={filter === entry.value} onClick={() => setFilter(entry.value)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {gameIds.length === 0 ? (
        <StatePanel title="Nothing matches">
          <p>No game or account fits this search and filter.</p>
          <Button
            onClick={() => {
              setSearch('')
              setFilter('all')
            }}
          >
            Clear search and filter
          </Button>
        </StatePanel>
      ) : (
        <ul className="game-grid">
          {gameIds.map((id, index) => (
            <GameSection key={id} gameId={id} query={search} filter={filter} index={index} />
          ))}
        </ul>
      )}
    </div>
  )
}
