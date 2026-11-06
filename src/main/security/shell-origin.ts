import { APP_HOST, APP_SCHEME } from '../platform/app-assets'

/**
 * Is `url` a page that may call the privileged IPC API?
 *
 * Only the shell: `app://gamehub/...` in production, plus the Vite dev server
 * when (and only when) the caller passes it. Compares protocol and host
 * explicitly: in Node, `new URL('app://x').origin` is the string 'null'.
 */
export function isTrustedShellUrl(url: string, devServerUrl?: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST) return true
  if (devServerUrl !== undefined && devServerUrl !== '') {
    try {
      const dev = new URL(devServerUrl)
      return (dev.protocol === 'http:' || dev.protocol === 'https:') && parsed.origin === dev.origin
    } catch {
      return false
    }
  }
  return false
}
