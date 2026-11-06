import { memo, useState, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { Icon } from '../../components/common/Icon'
import { Menu, type MenuItem } from '../../components/common/Menu'
import { GameArt, useGameStyle } from '../../components/common/Monogram'
import { gameHost } from '../../model/game-identity'
import { playGame } from '../../stores/actions'
import { useDomainStore } from '../../stores/domain-store'
import { describeCounts, gameCounts, visibleAccountIds } from '../../stores/selectors'
import { useUiStore, type LibraryFilter } from '../../stores/ui-store'
import { AccountRow } from './AccountRow'

interface GameSectionProps {
  gameId: string
  query: string
  filter: LibraryFilter
  /** Position in the list: only used to stagger the entrance. */
  index: number
}

/**
 * A game as a poster, with its accounts as the party underneath. The main verb (Play) is the only
 * loud control; managing the game (allowed sites, editing, removing) lives in the menu.
 * Re-renders only when its own game, counts or visible accounts change.
 */
export const GameSection = memo(function GameSection({ gameId, query, filter, index }: GameSectionProps) {
  const game = useDomainStore((s) => s.gameById[gameId])
  const counts = useDomainStore(useShallow((s) => gameCounts(s, gameId)))
  const accountIds = useDomainStore(useShallow((s) => visibleAccountIds(s, gameId, query, filter)))
  const openDialog = useUiStore((s) => s.openDialog)
  const style = useGameStyle(gameId)
  const [starting, setStarting] = useState(false)
  if (game === undefined) return null

  const manage: MenuItem[] = [
    {
      label: `Allowed sites${game.allowedOrigins.length > 0 ? ` (${game.allowedOrigins.length})` : ''}`,
      icon: 'globe',
      onSelect: () => openDialog({ kind: 'origins', gameId }),
    },
    { label: 'Edit game', icon: 'edit', onSelect: () => openDialog({ kind: 'editGame', gameId }) },
    { label: 'Remove game', icon: 'trash', tone: 'danger', onSelect: () => openDialog({ kind: 'confirmRemoveGame', gameId }) },
  ]

  const play = (): void => {
    setStarting(true)
    void playGame(api(), gameId).finally(() => setStarting(false))
  }

  return (
    <li
      className="game-panel"
      style={{ ...style, '--i': Math.min(index, 8) } as CSSProperties}
      data-testid={`game-${game.name}`}
      data-live={counts.running > 0 ? 'true' : undefined}
    >
      <div className="game-banner">
        <GameArt gameId={game.id} name={game.name} />
        <div className="game-banner-menu">
          <Menu label={`Manage ${game.name}`} items={manage} />
        </div>
        <div className="game-banner-body">
          <div className="game-banner-text">
            <h2 className="game-title">{game.name}</h2>
            <p className="game-sub" title={`${gameHost(game.startUrl)}${game.description === '' ? '' : `: ${game.description}`}`}>
              {game.description === '' ? gameHost(game.startUrl) : game.description}
            </p>
            <p className="game-counts" data-live={counts.running > 0 ? 'true' : undefined}>
              {describeCounts(counts)}
            </p>
          </div>
          {counts.total === 0 ? (
            <Button tone="play" size="large" onClick={() => openDialog({ kind: 'addAccount', gameId })}>
              <Icon name="plus" size={16} />
              Add account
            </Button>
          ) : (
            <Button tone="play" size="large" disabled={starting} onClick={play}>
              <Icon name="play" size={15} />
              {counts.running > 0 ? 'Open' : starting ? 'Starting…' : 'Play'}
            </Button>
          )}
        </div>
      </div>

      {accountIds.length > 0 ? (
        <ul className="sessions">
          {accountIds.map((id) => (
            <AccountRow key={id} instanceId={id} />
          ))}
          <li>
            <button type="button" className="session-add" onClick={() => openDialog({ kind: 'addAccount', gameId })}>
              <Icon name="plus" size={14} />
              Add account
            </button>
          </li>
        </ul>
      ) : (
        <div className="sessions-empty">
          {counts.total === 0 ? (
            <p>Each account is its own browser: its own login, cookies and saved data.</p>
          ) : (
            <p>No accounts match the current search or filter.</p>
          )}
        </div>
      )}
    </li>
  )
})
