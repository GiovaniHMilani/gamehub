import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '../../components/common/Button'
import { Monogram, useGameStyle } from '../../components/common/Monogram'
import { gameHost } from '../../model/game-identity'
import { useDomainStore } from '../../stores/domain-store'
import { describeCounts, gameCounts, visibleAccountIds } from '../../stores/selectors'
import { useUiStore, type LibraryFilter } from '../../stores/ui-store'
import { AccountRow } from './AccountRow'

interface GameSectionProps {
  gameId: string
  query: string
  filter: LibraryFilter
}

/** A game and its accounts. Re-renders only when its own game, counts or visible accounts change. */
export const GameSection = memo(function GameSection({ gameId, query, filter }: GameSectionProps) {
  const game = useDomainStore((s) => s.gameById[gameId])
  const counts = useDomainStore(useShallow((s) => gameCounts(s, gameId)))
  const accountIds = useDomainStore(useShallow((s) => visibleAccountIds(s, gameId, query, filter)))
  const openDialog = useUiStore((s) => s.openDialog)
  const style = useGameStyle(gameId)
  if (game === undefined) return null

  return (
    <li style={style} data-testid={`game-${game.name}`}>
      <div className="game-head">
        <Monogram gameId={game.id} name={game.name} />
        <div className="game-head-text">
          <div className="game-name">
            <h2>{game.name}</h2>
            <span className="game-meta">{gameHost(game.startUrl)}</span>
          </div>
          <p className="game-meta">{describeCounts(counts)}</p>
          {game.description === '' ? null : <p className="game-description" title={game.description}>{game.description}</p>}
        </div>
        <div className="game-head-actions">
          <Button tone="quiet" size="small" onClick={() => openDialog({ kind: 'origins', gameId })}>
            Allowed sites{game.allowedOrigins.length > 0 ? ` (${game.allowedOrigins.length})` : ''}
          </Button>
          <Button tone="quiet" size="small" onClick={() => openDialog({ kind: 'editGame', gameId })}>
            Edit game
          </Button>
          <Button tone="danger" size="small" onClick={() => openDialog({ kind: 'confirmRemoveGame', gameId })}>
            Remove game
          </Button>
          <Button size="small" onClick={() => openDialog({ kind: 'addAccount', gameId })}>
            Add account
          </Button>
        </div>
      </div>

      {accountIds.length > 0 ? (
        <ul className="accounts">
          {accountIds.map((id) => (
            <AccountRow key={id} instanceId={id} />
          ))}
        </ul>
      ) : (
        <div className="accounts accounts-empty">
          {counts.total === 0 ? (
            <>
              <span>Each account is its own browser: its own login, cookies and saved data.</span>
              <Button tone="primary" size="small" onClick={() => openDialog({ kind: 'addAccount', gameId })}>
                Add the first account
              </Button>
            </>
          ) : (
            <span>No accounts match the current search or filter.</span>
          )}
        </div>
      )}
    </li>
  )
})
