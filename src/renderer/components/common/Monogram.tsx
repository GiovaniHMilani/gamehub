import { useMemo, type CSSProperties } from 'react'
import type { InstanceStatus } from '@shared/domain/types'
import { gameHue, gameMotif, monogram } from '../../model/game-identity'
import { useDomainStore } from '../../stores/domain-store'
import { StatusLamp } from './StatusLamp'

/**
 * The colours of a game, as CSS variables to put on the element that owns them. They are RESOLVED
 * here, not derived in a stylesheet: a custom property that is computed with `var(--hue)` on :root
 * is inherited as an already-computed value, so a per-game `--hue` would never reach it.
 * The hue comes from the store (distinct per game, by creation order); the id hash is only a fallback.
 *
 *   --game       bright: rings, rails, small accents on the dark canvas
 *   --game-mid   the artwork's light end
 *   --game-deep  the artwork's dark end
 */
export function useGameStyle(gameId: string): CSSProperties {
  const hue = useDomainStore((s) => s.hueByGameId[gameId] ?? gameHue(gameId))
  return useMemo(
    () =>
      ({
        '--game': `hsl(${hue} 75% 62%)`,
        '--game-mid': `hsl(${hue} 58% 36%)`,
        '--game-deep': `hsl(${(hue + 24) % 360} 52% 15%)`,
      }) as CSSProperties,
    [hue],
  )
}

/** A game's square mark: its colour and its initials. */
export function Monogram({ gameId, name }: { gameId: string; name: string }) {
  return (
    <span className="monogram" style={useGameStyle(gameId)} aria-hidden="true">
      {monogram(name)}
    </span>
  )
}

/** The generated artwork behind a game: colour, one of a few patterns, and a huge initial. */
export function GameArt({ gameId, name }: { gameId: string; name: string }) {
  return (
    <span className="game-art" data-motif={gameMotif(gameId)} aria-hidden="true">
      <span className="game-art-glyph">{monogram(name).charAt(0)}</span>
    </span>
  )
}

/**
 * An account as a member of the party: a round portrait in its game's colour, ringed by its state,
 * with a small lamp whose SHAPE also tells the state. Decorative: the state is always written next to it.
 */
export function Portrait({ gameId, label, status, size = 'regular' }: { gameId?: string; label: string; status: InstanceStatus; size?: 'regular' | 'large' }) {
  const own = useGameStyle(gameId ?? '')
  return (
    <span className="portrait" data-state={status} data-size={size} style={gameId === undefined ? undefined : own} aria-hidden="true">
      <span className="portrait-face">{monogram(label)}</span>
      <span className="portrait-lamp">
        <StatusLamp state={status} />
      </span>
    </span>
  )
}
