import { matchesAnyOrigin } from '@shared/domain/origin-pattern'

/**
 * Navigation policy for game views (ADR-0007). Pure: decides, never acts.
 *
 * Top-level navigation stays inside a view only for the game's allowed origins:
 * the origin of its start URL plus the origin patterns configured on the game
 * (typically its OAuth provider). Everything else is blocked.
 */

/** Allowed origin patterns for a game: its own origin first, then the configured extras. */
export function allowedOriginsFor(startUrl: string, extra: readonly string[] = []): string[] {
  const own = new URL(startUrl).origin
  return [own, ...extra.filter((origin) => origin !== own)]
}

export function isAllowedTopLevelNavigation(target: string, allowedOrigins: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  // Same rule as popups: credentials embedded in a URL are never navigated to.
  if (url.username !== '' || url.password !== '') return false
  return matchesAnyOrigin(target, allowedOrigins)
}
