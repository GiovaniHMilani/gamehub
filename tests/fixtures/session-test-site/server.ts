import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Tiny local site used by the isolation/persistence tests. It serves one page
 * and a /whoami endpoint that echoes the `identity` cookie the SERVER received,
 * which gives an independent, server-side view of what each browser profile sends.
 */
export interface SessionTestSite {
  readonly url: string
  /** `identity` cookie values seen by /whoami, in request order. */
  readonly seenIdentities: Array<string | null>
  close(): Promise<void>
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split('; ')) {
    const index = part.indexOf('=')
    if (index > 0) out[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1))
  }
  return out
}

export async function startSessionTestSite(port = 0): Promise<SessionTestSite> {
  const html = await readFile(join(import.meta.dirname, 'index.html'), 'utf8')
  const seenIdentities: Array<string | null> = []

  const server: Server = createServer((req, res) => {
    if (req.url === '/whoami') {
      const identity = parseCookies(req.headers.cookie)['identity'] ?? null
      seenIdentities.push(identity)
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify({ identity }))
      return
    }
    if (req.url === '/' || req.url?.startsWith('/?') === true) {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(html)
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Unexpected server address')

  return {
    url: `http://127.0.0.1:${address.port}/`,
    seenIdentities,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
