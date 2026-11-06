import { useMemo, type CSSProperties } from 'react'
import { gameHue, monogram } from '../../model/game-identity'
import { useDomainStore } from '../../stores/domain-store'

/**
 * The colours of a game, as CSS variables to put on the element that owns them. They are RESOLVED
 * here, not derived in a stylesheet: a custom property that is computed with `var(--hue)` on :root
 * is inherited as an already-computed value, so a per-game `--hue` would never reach it.
 * The hue comes from the store (distinct per game, by creation order); the id hash is only a fallback.
 */
export function useGameStyle(gameId: string): CSSProperties {
  const hue = useDomainStore((s) => s.hueByGameId[gameId] ?? gameHue(gameId))
  return useMemo(
    () => ({ '--game': `hsl(${hue} 52% 40%)`, '--game-wash': `hsl(${hue} 60% 94%)` }) as CSSProperties,
    [hue],
  )
}

export function Monogram({ gameId, name }: { gameId: string; name: string }) {
  return (
    <span className="monogram" style={useGameStyle(gameId)} aria-hidden="true">
      {monogram(name)}
    </span>
  )
}
