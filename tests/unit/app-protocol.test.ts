import { describe, expect, it } from 'vitest'
import { isInsideRoot, resolveAppAsset } from '../../src/main/platform/app-assets'
import { isTrustedShellUrl } from '../../src/main/security/shell-origin'

const ROOT = '/srv/gamehub/out/renderer'

describe('resolveAppAsset', () => {
  it('maps the root and directories to index.html', () => {
    expect(resolveAppAsset(ROOT, '/')).toEqual({ file: `${ROOT}/index.html`, contentType: 'text/html; charset=utf-8' })
    expect(resolveAppAsset(ROOT, '/index.html')?.file).toBe(`${ROOT}/index.html`)
    expect(resolveAppAsset(ROOT, '/sub/')?.file).toBe(`${ROOT}/sub/index.html`)
  })

  it('serves built assets with the right content type', () => {
    expect(resolveAppAsset(ROOT, '/assets/index-abc123.js')).toEqual({
      file: `${ROOT}/assets/index-abc123.js`,
      contentType: 'text/javascript; charset=utf-8',
    })
    expect(resolveAppAsset(ROOT, '/assets/style.css')?.contentType).toBe('text/css; charset=utf-8')
    expect(resolveAppAsset(ROOT, '/logo.SVG')?.contentType).toBe('image/svg+xml')
    expect(resolveAppAsset(ROOT, '/font.woff2')?.contentType).toBe('font/woff2')
  })

  it.each([
    ['/../package.json'],
    ['/../../etc/passwd'],
    ['/assets/../../package.json'],
    ['/%2e%2e/package.json'],
    ['/..%2fpackage.json'],
    ['/..%2F..%2Fetc%2Fpasswd'],
    ['/%2e%2e%2f%2e%2e%2fpackage.json'],
    ['/..%5cpackage.json'], // encoded backslash
    ['/..\\package.json'],
    ['/%252e%252e%252fpackage.json'], // double encoding
    ['/index.html%00.png'], // null byte
    ['/%00'],
    ['/%E0%A4%A'], // malformed percent-encoding
    ['/C:/Windows/win.ini'],
    ['//etc/passwd'], // not a root escape, but has no allowed type
    ['/.env'],
    ['/.git/config'],
    ['/assets/.hidden.js'],
  ])('refuses %j', (path) => {
    expect(resolveAppAsset(ROOT, path)).toBeNull()
  })

  it.each([['/package.json'], ['/app.node'], ['/script.sh'], ['/data.db'], ['/noextension'], ['/index.html.map'], ['/secret.pem']])(
    'refuses types outside the allowlist: %j',
    (path) => {
      expect(resolveAppAsset(ROOT, path)).toBeNull()
    },
  )

  it('never returns a path outside the root, for any input', () => {
    const attempts = ['/..', '/a/../../b.js', '/./x.js', '/a//b.js', '/%2e/x.js', '/....//x.js', '/a/%2e%2e/%2e%2e/x.js']
    for (const path of attempts) {
      const result = resolveAppAsset(ROOT, path)
      if (result !== null) expect(isInsideRoot(ROOT, result.file)).toBe(true)
    }
  })
})

describe('isInsideRoot', () => {
  it('accepts files inside and rejects everything else', () => {
    expect(isInsideRoot(ROOT, `${ROOT}/a.js`)).toBe(true)
    expect(isInsideRoot(ROOT, `${ROOT}/x/y/a.js`)).toBe(true)
    expect(isInsideRoot(ROOT, ROOT)).toBe(false)
    expect(isInsideRoot(ROOT, '/srv/gamehub/out/renderer-evil/a.js')).toBe(false)
    expect(isInsideRoot(ROOT, '/srv/gamehub/package.json')).toBe(false)
    expect(isInsideRoot(ROOT, '/etc/passwd')).toBe(false)
  })
})

describe('isTrustedShellUrl', () => {
  it('trusts only app://gamehub', () => {
    expect(isTrustedShellUrl('app://gamehub/index.html')).toBe(true)
    expect(isTrustedShellUrl('app://gamehub/')).toBe(true)
    expect(isTrustedShellUrl('app://evil/index.html')).toBe(false)
    expect(isTrustedShellUrl('app://gamehub.evil.com/index.html')).toBe(false)
    expect(isTrustedShellUrl('file:///Users/x/out/renderer/index.html')).toBe(false)
    expect(isTrustedShellUrl('https://game.example/')).toBe(false)
    expect(isTrustedShellUrl('http://127.0.0.1:5173/')).toBe(false) // dev server is opt-in
    expect(isTrustedShellUrl('garbage')).toBe(false)
    expect(isTrustedShellUrl('')).toBe(false)
  })

  it('trusts the dev server only when it is passed in, and only that origin', () => {
    const dev = 'http://localhost:5173/'
    expect(isTrustedShellUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isTrustedShellUrl('http://localhost:5173/x?y=1', dev)).toBe(true)
    expect(isTrustedShellUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isTrustedShellUrl('http://evil.test:5173/', dev)).toBe(false)
    expect(isTrustedShellUrl('app://gamehub/index.html', dev)).toBe(true)
    expect(isTrustedShellUrl('https://game.example/', 'file:///etc')).toBe(false)
  })
})
