import { beforeEach, describe, expect, it } from 'vitest'
import { createLogger, MemorySink } from '../../src/main/logging/logger'
import { PopupController } from '../../src/main/window/popup-controller'
import { FakeContents, FakeWindow, SAFE_PREFS } from './helpers/electron-fakes'

const GAME = 'https://game.example'
const PROVIDER = 'https://auth.provider.test'
const AUTH_URL = `${PROVIDER}/authorize?client_id=x&response_type=code`

interface Allowed {
  action: 'allow'
  overrideBrowserWindowOptions: { width: number; height: number; parent: unknown; webPreferences: Record<string, unknown> }
}

let sink: MemorySink
let session: object
let opener: FakeContents
let parent: object
let controller: PopupController
let clock: number
let origins: string[]

beforeEach(() => {
  sink = new MemorySink()
  session = { name: 'session-A' }
  opener = new FakeContents(session)
  parent = { shell: true }
  clock = 1_000_000
  origins = [GAME, PROVIDER]
  controller = new PopupController({
    instanceId: 'inst-A',
    opener: opener as never,
    session: session as never,
    parent: parent as never,
    getAllowedOrigins: () => origins,
    log: createLogger('t', sink),
    now: () => clock,
  })
})

const request = (url = AUTH_URL, over: Partial<{ features: string; disposition: string }> = {}): unknown =>
  opener.windowOpenHandler?.({ url, features: '', disposition: 'new-window', ...over })

/** What Chromium does after an allowed request: creates the window, then emits did-create-window. */
function create(over: { session?: object; prefs?: Record<string, unknown>; url?: string } = {}): FakeWindow {
  const win = new FakeWindow(new FakeContents(over.session ?? session))
  opener.emit('did-create-window', win, { url: over.url ?? AUTH_URL, options: { webPreferences: 'prefs' in over ? over.prefs : SAFE_PREFS } })
  return win
}

const reasons = (): unknown[] => sink.records.filter((r) => r.event === 'popup.denied').map((r) => r['reason'])
const events = (): string[] => sink.events()

describe('PopupController: requests', () => {
  it('allows an allowed origin, pinned to secure options, as a child of the shell', () => {
    const result = request(AUTH_URL, { features: 'width=480,height=640' }) as Allowed
    expect(result.action).toBe('allow')
    expect(result.overrideBrowserWindowOptions).toMatchObject({ width: 480, height: 640, parent })
    expect(result.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    })
    expect(events()).toEqual(expect.arrayContaining(['popup.requested', 'popup.validated']))
  })

  it('never forwards page-supplied features as options: the result has only the fixed shape', () => {
    const result = request(AUTH_URL, { features: 'nodeIntegration=yes,contextIsolation=no,partition=persist:gh-other,width=480' }) as Allowed
    expect(Object.keys(result.overrideBrowserWindowOptions).sort()).toEqual(
      ['autoHideMenuBar', 'fullscreenable', 'height', 'maximizable', 'minimizable', 'parent', 'show', 'webPreferences', 'width'].sort(),
    )
    expect(result.overrideBrowserWindowOptions.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true })
    expect(result.overrideBrowserWindowOptions.webPreferences).not.toHaveProperty('partition')
    expect(result.overrideBrowserWindowOptions.webPreferences).not.toHaveProperty('session')
  })

  it('denies with a logged reason', () => {
    expect(request('https://evil.example/')).toEqual({ action: 'deny' })
    expect(request('about:blank')).toEqual({ action: 'deny' })
    expect(request(AUTH_URL, { disposition: 'save-to-disk' })).toEqual({ action: 'deny' })
    expect(reasons()).toEqual(['origin_not_allowed', 'insecure_url', 'disposition'])
  })

  it('two requests in the same tick, before the first window exists, allow only one', () => {
    expect((request() as Allowed).action).toBe('allow')
    expect(request()).toEqual({ action: 'deny' })
    expect(reasons()).toEqual(['too_many_open'])
  })

  it('enforces the per-minute budget across closed popups, and the window moves on', () => {
    for (let i = 0; i < 5; i++) {
      expect((request() as Allowed).action).toBe('allow')
      create().destroy()
    }
    expect(request()).toEqual({ action: 'deny' })
    expect(reasons().at(-1)).toBe('rate_limited')
    clock += 60_000
    expect((request() as Allowed).action).toBe('allow')
  })
})

describe('PopupController: live allowlist changes', () => {
  it('decisions follow the current list without recreating the controller', () => {
    origins = [GAME]
    expect(request()).toEqual({ action: 'deny' })
    expect(reasons().at(-1)).toBe('origin_not_allowed')
    origins = [GAME, PROVIDER] // the user allowed the provider while the instance is running
    expect((request() as Allowed).action).toBe('allow')
    const win = create()
    origins = [GAME] // ...and removed it again: an open popup may no longer follow a redirect there
    let prevented = false
    win.webContents.emit('will-redirect', { preventDefault: () => (prevented = true) }, `${PROVIDER}/step2`)
    expect(prevented).toBe(true)
  })
})

describe('PopupController: created popups', () => {
  it('registers a popup in the opener session and tracks navigating/running', () => {
    request()
    const win = create()
    expect(controller.openCount).toBe(1)
    expect(win.title).toBe('auth.provider.test · GameHub')
    win.webContents.emit('did-start-loading')
    win.webContents.emit('did-stop-loading')
    expect(sink.records.filter((r) => r.event === 'popup.state').map((r) => r['state'])).toEqual(['navigating', 'running'])
  })

  it('destroys a popup that landed in a DIFFERENT session', () => {
    request()
    const win = create({ session: { name: 'session-B' } })
    expect(win.destroyed).toBe(true)
    expect(controller.openCount).toBe(0)
    expect(events()).toContain('popup.session_mismatch')
  })

  it.each([
    ['nodeIntegration enabled', { ...SAFE_PREFS, nodeIntegration: true }],
    ['sandbox off', { ...SAFE_PREFS, sandbox: false }],
    ['contextIsolation off', { ...SAFE_PREFS, contextIsolation: false }],
    ['a preload injected', { ...SAFE_PREFS, preload: '/tmp/evil.js' }],
    ['no preferences at all', undefined],
  ])('destroys a popup created with %s', (_name, prefs) => {
    request()
    const win = create({ prefs: prefs as Record<string, unknown> })
    expect(win.destroyed).toBe(true)
    expect(controller.openCount).toBe(0)
    expect(events()).toContain('popup.insecure_preferences')
  })

  it('destroys a second window that slips past the request-time check', () => {
    request()
    create()
    const extra = create() // Chromium created another window
    expect(extra.destroyed).toBe(true)
    expect(controller.openCount).toBe(1)
  })

  it('a popup cannot open more windows (no chains)', () => {
    request()
    const win = create()
    const result = win.webContents.windowOpenHandler?.({ url: AUTH_URL, features: '', disposition: 'new-window' })
    expect(result).toEqual({ action: 'deny' })
    expect(reasons().at(-1)).toBe('nested_popup')
  })

  it('blocks navigation and redirects to origins outside the allowlist, allows the callback', () => {
    request()
    const win = create()
    const attempt = (event: 'will-navigate' | 'will-redirect', url: string): boolean => {
      let prevented = false
      win.webContents.emit(event, { preventDefault: () => (prevented = true) }, url)
      return prevented
    }
    expect(attempt('will-navigate', 'https://evil.example/')).toBe(true)
    expect(attempt('will-redirect', 'https://evil.example/steal?code=1')).toBe(true)
    expect(attempt('will-navigate', 'javascript:alert(1)')).toBe(true)
    expect(attempt('will-navigate', `${GAME}/callback?code=abc`)).toBe(false)
    expect(attempt('will-redirect', `${PROVIDER}/step2`)).toBe(false)
    expect(sink.events().filter((e) => e === 'popup.navigation_blocked')).toHaveLength(3)
  })

  it('does not let the page choose its own title', () => {
    request()
    const win = create()
    let prevented = false
    win.webContents.emit('page-title-updated', { preventDefault: () => (prevented = true) })
    expect(prevented).toBe(true)
  })
})

describe('PopupController: cleanup', () => {
  it('releases the entry and every listener when the window closes, however it closes', () => {
    request()
    const win = create()
    expect(win.webContents.listenerCount()).toBeGreaterThan(0)
    win.destroy() // user closed it, or window.close()
    expect(controller.openCount).toBe(0)
    expect(win.webContents.listenerCount()).toBe(0) // no listener left on the dead webContents
    expect(events()).toContain('popup.closed')
    // ...and a new popup is possible again.
    expect((request() as Allowed).action).toBe('allow')
  })

  it('dispose() closes open popups, detaches from the opener and refuses new requests', async () => {
    request()
    const win = create()
    expect(opener.listenerCount()).toBe(1) // did-create-window
    await controller.dispose()
    expect(win.destroyed).toBe(true)
    expect(controller.openCount).toBe(0)
    expect(opener.listenerCount()).toBe(0)
    expect(request()).toEqual({ action: 'deny' })
    expect(reasons().at(-1)).toBe('instance_closing')
  })

  it('a window created after dispose is destroyed, not adopted', async () => {
    request()
    await controller.dispose()
    const late = new FakeWindow(new FakeContents(session))
    // The listener is gone, so nothing adopts it; emulate a straggler reaching the handler anyway.
    opener.emit('did-create-window', late, { url: AUTH_URL, options: { webPreferences: SAFE_PREFS } })
    expect(controller.openCount).toBe(0)
  })

  it('closeAll() waits for every popup to be gone and is safe to repeat', async () => {
    request()
    const win = create()
    await controller.closeAll()
    expect(win.destroyed).toBe(true)
    await expect(controller.closeAll()).resolves.toBeUndefined()
  })
})
