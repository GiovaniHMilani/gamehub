/**
 * Game URL validation (ADR-0007). Game URLs are untrusted input.
 *
 * Accepted: https; http only for loopback hosts (local fixtures/dev games).
 * Rejected: other schemes (file, javascript, data, chrome, ...), embedded
 * credentials, missing host.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export type GameUrlResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: string }

export function parseGameUrl(input: string): GameUrlResult {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: 'Not a valid URL' }
  }

  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'URL must not contain credentials' }
  }
  if (url.hostname === '') {
    return { ok: false, reason: 'URL must have a host' }
  }
  if (url.protocol === 'https:') return { ok: true, url }
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return { ok: true, url }
  return { ok: false, reason: 'Only https URLs are allowed (http only for localhost)' }
}
