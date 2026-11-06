import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Two local origins that imitate "game + OAuth provider":
 *
 *   game      http://127.0.0.1:<p1>/   the session test page, plus popup/login helpers and /callback
 *   provider  http://localhost:<p2>/   /authorize (sign-in page) and /me
 *
 * Different hosts, so cookies are never shared by accident: any cross-contamination
 * seen in the tests comes from sessions, not from the fixture.
 */
export interface OAuthTestSite {
  readonly gameUrl: string // http://127.0.0.1:p1/
  readonly gameOrigin: string
  readonly providerUrl: string // http://localhost:p2/
  readonly providerOrigin: string
  /** A standard authorization-code request URL pointing the provider back at the game. */
  authorizeUrl(): string
  close(): Promise<void>
}

const GAME_ADDITIONS = `
<script>
  // Opens a popup to the given URL (like a "Sign in with ..." button would).
  window.startLogin = (authUrl) => window.open(authUrl, 'oauth', 'popup,width=480,height=640') !== null
  // Generic opener used by the policy tests: returns whether the browser handed back a window.
  window.tryOpen = (url, features) => window.open(url, '_blank', features || '') !== null
  window.__loginDone = null
  window.addEventListener('message', async (event) => {
    if (event.origin !== location.origin) return
    if (event.data && event.data.type === 'oauth-result') {
      await setIdentity(event.data.user)   // the game stores the login in ITS OWN origin
      window.__loginDone = event.data.user
    }
  })
</script>`

const CALLBACK = `<!doctype html><html><head><meta charset="utf-8"><title>OAuth callback</title></head><body>
<p>Signing in…</p>
<script>
  const code = new URLSearchParams(location.search).get('code') || ''
  const user = code.replace(/^code-for-/, '')
  if (window.opener) window.opener.postMessage({ type: 'oauth-result', user }, location.origin)
  document.body.dataset.done = 'true'
  window.close()
</script></body></html>`

function cookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split('; ')) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index) === name) return decodeURIComponent(part.slice(index + 1))
  }
  return null
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Unexpected server address')
  return address.port
}

const close = (server: Server): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => (error ? reject(error) : resolve()))
  })

export async function startOAuthTestSite(ports: { game?: number; provider?: number } = {}): Promise<OAuthTestSite> {
  const sessionPage = await readFile(join(import.meta.dirname, '../session-test-site/index.html'), 'utf8')
  const providerPage = await readFile(join(import.meta.dirname, 'provider.html'), 'utf8')
  const gamePage = sessionPage.replace('</body>', `${GAME_ADDITIONS}</body>`)
  const send = (res: import('node:http').ServerResponse, type: string, body: string): void => {
    res.setHeader('content-type', type)
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }
  const path = (url: string | undefined): string => (url ?? '/').split('?')[0] ?? '/'

  const game = createServer((req, res) => {
    const route = path(req.url)
    if (route === '/') return send(res, 'text/html; charset=utf-8', gamePage)
    if (route === '/callback') return send(res, 'text/html; charset=utf-8', CALLBACK)
    if (route === '/whoami') return send(res, 'application/json', JSON.stringify({ identity: cookie(req.headers.cookie, 'identity') }))
    res.statusCode = 404
    res.end('not found')
  })
  const provider = createServer((req, res) => {
    const route = path(req.url)
    if (route === '/authorize') return send(res, 'text/html; charset=utf-8', providerPage)
    if (route === '/me') return send(res, 'application/json', JSON.stringify({ user: cookie(req.headers.cookie, 'provider_user') }))
    res.statusCode = 404
    res.end('not found')
  })

  const gamePort = await listen(game, ports.game ?? 0)
  const providerPort = await listen(provider, ports.provider ?? 0)
  const gameOrigin = `http://127.0.0.1:${gamePort}`
  const providerOrigin = `http://localhost:${providerPort}`

  return {
    gameUrl: `${gameOrigin}/`,
    gameOrigin,
    providerUrl: `${providerOrigin}/`,
    providerOrigin,
    authorizeUrl: () =>
      `${providerOrigin}/authorize?client_id=gamehub-test&response_type=code&state=xyz&redirect_uri=${encodeURIComponent(`${gameOrigin}/callback`)}`,
    close: async () => {
      await Promise.all([close(game), close(provider)])
    },
  }
}
