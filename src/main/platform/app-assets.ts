import { extname, isAbsolute, relative, resolve } from 'node:path'

/**
 * Pure path resolution for the app:// protocol (ADR-0014). No Electron, no I/O,
 * so every traversal trick can be unit-tested.
 *
 * app:// is NOT a file server. It maps a URL path onto files under one root
 * directory (the built renderer), and only for an allowlist of web asset types.
 */

export const APP_SCHEME = 'app'
export const APP_HOST = 'gamehub'
export const SHELL_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export interface ResolvedAsset {
  readonly file: string
  readonly contentType: string
}

/**
 * @param root     absolute directory that may be served
 * @param pathname URL pathname exactly as received (still percent-encoded)
 * @returns the file to read, or null if the request must be refused
 */
export function resolveAppAsset(root: string, pathname: string): ResolvedAsset | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // malformed percent-encoding
  }
  // After one decode there must be nothing left to decode: refuses %252e%252e tricks.
  if (decoded.includes('%')) return null
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':')) return null

  const segments = decoded.split('/').filter((segment) => segment !== '')
  // `..`, `.` and dotfiles (.env, .git, ...) are never served.
  if (segments.some((segment) => segment.startsWith('.'))) return null

  const wantsDirectory = decoded.endsWith('/') || segments.length === 0
  const relativePath = wantsDirectory ? [...segments, 'index.html'].join('/') : segments.join('/')

  const contentType = CONTENT_TYPES[extname(relativePath).toLowerCase()]
  if (contentType === undefined) return null

  const file = resolve(root, relativePath)
  const fromRoot = relative(root, file)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null
  return { file, contentType }
}

/** True if `candidate` (already realpath'd) is `root` or lives inside it. */
export function isInsideRoot(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot !== '' && !fromRoot.startsWith('..') && !isAbsolute(fromRoot)
}
