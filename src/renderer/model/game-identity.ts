/**
 * A game's visual identity. Colours are handed out in order of creation from a fixed set that
 * stays legible on both the light canvas and the dark sidebar, so the first ten games are
 * GUARANTEED different colours (a hash would collide often) and a game keeps its colour as
 * more are added later. `gameHue` (a hash of the id) is only the fallback for a game the UI
 * has not loaded yet.
 */
const HUES = [204, 28, 152, 322, 46, 268, 178, 8, 98, 232] as const

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface HueSource {
  readonly id: string
  readonly createdAt: number
}

/** gameId -> hue, by creation order (then id). The first HUES.length games never share a colour. */
export function assignHues(games: readonly HueSource[]): Record<string, number> {
  const ordered = games.toSorted((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const hues: Record<string, number> = {}
  ordered.forEach((game, index) => {
    hues[game.id] = HUES[index % HUES.length] ?? HUES[0]
  })
  return hues
}

export function gameHue(gameId: string): number {
  return HUES[hash(gameId) % HUES.length] ?? HUES[0]
}

/** Up to two letters: initials of the first two words, or the first two letters of one word. */
export function monogram(name: string): string {
  const words = name.trim().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')
  if (words.length === 0) return '?'
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase()
  return ((words[0] ?? '').charAt(0) + (words[1] ?? '').charAt(0)).toUpperCase()
}

/** `host` of a game's start URL, for display. Never throws. */
export function gameHost(startUrl: string): string {
  try {
    return new URL(startUrl).host
  } catch {
    return startUrl
  }
}
