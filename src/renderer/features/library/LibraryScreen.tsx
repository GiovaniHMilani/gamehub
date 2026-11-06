import { useShallow } from 'zustand/react/shallow'
import { Button } from '../../components/common/Button'
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
      <StatePanel title="No games yet">
        <p>Add your first game to get started. Each game can have as many accounts as you like, all running side by side.</p>
        <Button tone="primary" onClick={() => openDialog({ kind: 'addGame' })}>Add game</Button>
      </StatePanel>
    )
  }

  return (
    <div className="screen">
      <div className="library-header">
        <input
          type="search"
          className="search"
          aria-label="Search games and accounts"
          placeholder="Search games and accounts"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
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
        <ul className="game-list">
          {gameIds.map((id) => (
            <GameSection key={id} gameId={id} query={search} filter={filter} />
          ))}
        </ul>
      )}
    </div>
  )
}
