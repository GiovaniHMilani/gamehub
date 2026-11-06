import { parseGameUrl } from './game-url'

/**
 * Allowed-origin patterns for a game (ADR-0007). Pure and provider-agnostic.
 *
 *   exact:    https://login.example.com        (http only for loopback)
 *   wildcard: https://*.example.com[:port]     (https only, subdomains only)
 *
 * A wildcard never matches the bare domain, needs at least two labels
 * (`*.com` is rejected) and a TLD that contains a letter (so it cannot match
 * IP addresses). Public-suffix lists are deliberately not consulted: a pattern
 * such as `https://*.co.uk` is accepted and is the user's responsibility.
 */
export type OriginPattern =
  | { readonly kind: 'exact'; readonly origin: string }
  | { readonly kind: 'wildcard'; readonly suffix: string; readonly port: string }

const WILDCARD = /^https:\/\/\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::(\d{1,5}))?$/i

export function parseOriginPattern(input: string): OriginPattern | null {
  const wildcard = WILDCARD.exec(input)
  if (wildcard !== null) {
    const suffix = (wildcard[1] ?? '').toLowerCase()
    const tld = suffix.split('.').at(-1) ?? ''
    if (!/[a-z]/.test(tld)) return null
    const port = wildcard[2] ?? ''
    if (port !== '' && (Number(port) < 1 || Number(port) > 65535)) return null
    return { kind: 'wildcard', suffix, port: port === '443' ? '' : port }
  }

  const parsed = parseGameUrl(input)
  if (!parsed.ok) return null
  const { url } = parsed
  // `*` is a legal host character for the URL parser, but a malformed wildcard
  // must be rejected, not silently treated as a literal host that matches nothing.
  if (url.hostname.includes('*')) return null
  // Origin only: no path, query or hash.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null
  if (input !== url.origin && input !== `${url.origin}/`) return null
  return { kind: 'exact', origin: url.origin }
}

function matches(url: URL, pattern: OriginPattern): boolean {
  if (pattern.kind === 'exact') return url.origin === pattern.origin
  return url.protocol === 'https:' && url.hostname.endsWith(`.${pattern.suffix}`) && url.port === pattern.port
}

/** True if `target` (a URL string) belongs to any of the patterns. Invalid patterns never match. */
export function matchesAnyOrigin(target: string, patterns: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }
  for (const raw of patterns) {
    const pattern = parseOriginPattern(raw)
    if (pattern !== null && matches(url, pattern)) return true
  }
  return false
}
