import { protocol } from 'electron'
import { readFile, realpath } from 'node:fs/promises'
import type { Logger } from '../logging/logger'
import { APP_HOST, APP_SCHEME, isInsideRoot, resolveAppAsset } from './app-assets'

/**
 * Must run before `app.ready`. `standard` + `secure` give the shell a real
 * origin (`app://gamehub`) so CSP `'self'` and fetch behave like https.
 * Deliberately NOT granted: bypassCSP, service workers, CORS, streaming.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

const notFound = (): Response => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })

/**
 * Serves the built shell from `rootDir` over app://gamehub/.
 *
 * Registered on the DEFAULT session only, which is the session of the shell
 * window. Game partitions have no such handler, so remote game content cannot
 * load shell assets through app:// (asserted in tests).
 */
export function installAppProtocol(rootDir: string, log: Logger): void {
  const realRoot = realpath(rootDir)

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST || request.method !== 'GET') return notFound()

    const asset = resolveAppAsset(rootDir, url.pathname)
    if (asset === null) {
      log.warn('app_protocol.denied', { path: url.pathname })
      return notFound()
    }
    try {
      // Resolve symlinks too: a link inside the root must not lead outside it.
      const real = await realpath(asset.file)
      if (!isInsideRoot(await realRoot, real)) {
        log.warn('app_protocol.denied', { path: url.pathname, reason: 'outside_root' })
        return notFound()
      }
      const body = await readFile(real)
      return new Response(body, {
        headers: { 'content-type': asset.contentType, 'x-content-type-options': 'nosniff' },
      })
    } catch {
      return notFound() // missing file: same answer as a refused one
    }
  })
}
