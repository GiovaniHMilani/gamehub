/**
 * Navigation policy for game views (ADR-0007). Pure: decides, never acts.
 *
 * Top-level navigation stays inside the view only for the game's allowed
 * origins. Everything else is blocked. OAuth popups and "open externally"
 * arrive with the navigation phase; until then they are denied, not guessed.
 */

export function allowedOriginsFor(startUrl: string): string[] {
  return [new URL(startUrl).origin]
}

export function isAllowedTopLevelNavigation(target: string, allowedOrigins: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  return allowedOrigins.includes(url.origin)
}
