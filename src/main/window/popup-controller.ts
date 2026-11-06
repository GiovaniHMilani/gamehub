import type { BrowserWindow, Session, WebContents } from 'electron'
import type { Logger } from '../logging/logger'
import type { BlockedHandler } from '../navigation/blocked'
import { isAllowedTopLevelNavigation } from '../navigation/policy'
import {
  canTransitionPopup,
  decidePopup,
  parsePopupSize,
  pruneRecentOpens,
  type PopupState,
} from '../navigation/popup-policy'

interface PopupEntry {
  readonly window: BrowserWindow
  readonly contents: WebContents
  state: PopupState
  readonly removeListeners: () => void
}

export interface PopupControllerDeps {
  readonly instanceId: string
  /** The game view that is allowed to request popups. */
  readonly opener: WebContents
  /** The opener's session. Every popup must end up on exactly this one. */
  readonly session: Session
  /** The shell window; popups are its children, so they die with it. */
  readonly parent: BrowserWindow
  /** Read on every decision, so a change to the game's allowlist applies to open instances. */
  readonly getAllowedOrigins: () => readonly string[]
  readonly log: Logger
  /** Told when a request is refused only because its origin is not allowed (ADR-0016). */
  readonly onBlocked?: BlockedHandler
  readonly now?: () => number
}

/**
 * Popup handling for ONE game instance (ADR-0007): validates each `window.open`
 * request, creates the popup in the instance's own session, and cleans up.
 *
 * Why the session is correct by construction AND verified: Chromium gives a
 * window opened with `window.open` the BrowserContext of its opener, and a
 * `partition`/`session` option cannot change that (spike S5). The controller
 * still checks every popup on creation and destroys it if the session or the
 * security preferences are not exactly what was intended.
 *
 * Lifecycle: requested -> validated -> created -> navigating <-> running -> closed.
 * Everything a popup owns is released on `closed`; `dispose()` closes the rest.
 */
export class PopupController {
  private readonly popups = new Map<number, PopupEntry>() // webContents id -> entry
  private recentOpens: number[] = []
  /** Requests allowed but whose window has not been created yet. */
  private pending = 0
  private disposed = false
  private readonly now: () => number

  constructor(private readonly deps: PopupControllerDeps) {
    this.now = deps.now ?? Date.now
    deps.opener.setWindowOpenHandler((details) => this.onOpenRequest(details))
    deps.opener.on('did-create-window', this.onCreated)
  }

  get openCount(): number {
    return this.popups.size
  }

  private onOpenRequest(details: {
    url: string
    features: string
    disposition: string
  }): { action: 'deny' } | { action: 'allow'; overrideBrowserWindowOptions: Electron.BrowserWindowConstructorOptions } {
    const { instanceId, log } = this.deps
    const now = this.now()
    log.info('popup.requested', { instanceId, url: details.url })

    if (this.disposed) return this.deny(details.url, 'instance_closing')
    this.recentOpens = pruneRecentOpens(this.recentOpens, now)
    const decision = decidePopup({
      url: details.url,
      disposition: details.disposition,
      allowedOrigins: this.deps.getAllowedOrigins(),
      fromPopup: false,
      openCount: this.popups.size + this.pending,
      recentOpens: this.recentOpens,
      now,
    })
    if (decision.action === 'deny') {
      // Only "origin not allowed" can be fixed by the user; the other reasons are hard rules.
      if (decision.reason === 'origin_not_allowed') {
        this.deps.onBlocked?.({ instanceId, url: details.url, kind: 'popup' })
      }
      return this.deny(details.url, decision.reason)
    }

    this.recentOpens.push(now)
    this.pending++
    log.info('popup.validated', { instanceId, url: details.url })

    const { width, height } = parsePopupSize(details.features)
    return {
      action: 'allow',
      // Highest precedence over anything parsed from the page's `features` string.
      overrideBrowserWindowOptions: {
        width,
        height,
        parent: this.deps.parent,
        show: true,
        autoHideMenuBar: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          webviewTag: false,
        },
      },
    }
  }

  private deny(url: string, reason: string): { action: 'deny' } {
    this.deps.log.warn('popup.denied', { instanceId: this.deps.instanceId, url, reason })
    return { action: 'deny' }
  }

  private readonly onCreated = (window: BrowserWindow, details: Electron.DidCreateWindowDetails): void => {
    const { instanceId, log, session } = this.deps
    this.pending = Math.max(0, this.pending - 1)
    const contents = window.webContents

    // 1. Session: must be the opener's, never the default or another account's.
    if (contents.session !== session) {
      log.error('popup.session_mismatch', { instanceId })
      window.destroy()
      return
    }
    // 2. Security preferences: `details.options` are the final merged options (documented API).
    //    Nothing the page put in `features` may have weakened them.
    const prefs = details.options.webPreferences
    if (prefs?.sandbox !== true || prefs.contextIsolation !== true || prefs.nodeIntegration === true || prefs.preload) {
      log.error('popup.insecure_preferences', { instanceId })
      window.destroy()
      return
    }
    // 3. Budget (also enforced at request time; this closes the window between request and creation).
    if (this.disposed || this.popups.size >= 1) {
      log.warn('popup.denied', { instanceId, url: details.url, reason: 'too_many_open' })
      window.destroy()
      return
    }

    const id = contents.id
    const onNavigate = (event: { preventDefault(): void }, url: string): void => {
      if (!isAllowedTopLevelNavigation(url, this.deps.getAllowedOrigins())) {
        event.preventDefault()
        log.warn('popup.navigation_blocked', { instanceId, url })
        this.deps.onBlocked?.({
          instanceId,
          url,
          kind: 'popup-navigation',
          retry: () => {
            if (!contents.isDestroyed() && isAllowedTopLevelNavigation(url, this.deps.getAllowedOrigins())) {
              void contents.loadURL(url).catch(() => undefined)
            }
          },
        })
      }
    }
    const onTitle = (event: { preventDefault(): void }): void => event.preventDefault() // the page must not spoof the title
    const onNavigated = (_event: unknown, url: string): void => window.setTitle(titleFor(url))
    const onStart = (): void => this.transition(id, 'navigating')
    const onStop = (): void => this.transition(id, 'running')

    // A popup can never open further windows: no chains.
    contents.setWindowOpenHandler(({ url }) => this.deny(url, 'nested_popup'))
    contents.on('will-navigate', onNavigate)
    contents.on('will-redirect', onNavigate)
    contents.on('page-title-updated', onTitle)
    contents.on('did-navigate', onNavigated)
    contents.on('did-start-loading', onStart)
    contents.on('did-stop-loading', onStop)
    window.setTitle(titleFor(details.url))

    const entry: PopupEntry = {
      window,
      contents,
      state: 'created',
      removeListeners: () => {
        // `off` is plain EventEmitter code: safe on a destroyed webContents (only native
        // methods throw). It must run, otherwise the closures stay attached to it.
        contents.off('will-navigate', onNavigate)
        contents.off('will-redirect', onNavigate)
        contents.off('page-title-updated', onTitle)
        contents.off('did-navigate', onNavigated)
        contents.off('did-start-loading', onStart)
        contents.off('did-stop-loading', onStop)
      },
    }
    this.popups.set(id, entry)
    window.once('closed', () => this.cleanup(id))
    log.info('popup.created', { instanceId, url: details.url, open: this.popups.size })
  }

  private transition(id: number, next: PopupState): void {
    const entry = this.popups.get(id)
    if (entry === undefined || !canTransitionPopup(entry.state, next)) return
    entry.state = next
    this.deps.log.info('popup.state', { instanceId: this.deps.instanceId, state: next })
  }

  /** Runs when the popup window is gone, however it was closed. Idempotent. */
  private cleanup(id: number): void {
    const entry = this.popups.get(id)
    if (entry === undefined) return
    entry.removeListeners()
    this.popups.delete(id) // drops the last reference to the window and its webContents
    entry.state = 'closed'
    this.deps.log.info('popup.closed', { instanceId: this.deps.instanceId, open: this.popups.size })
  }

  /** Destroys every open popup and waits until they are gone. */
  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.popups.values()].map(
        (entry) =>
          new Promise<void>((resolve) => {
            if (entry.window.isDestroyed()) return resolve()
            entry.window.once('closed', () => resolve())
            entry.window.destroy() // forced: a page's beforeunload must not keep a popup alive
          }),
      ),
    )
  }

  /** Instance is going away: refuse new popups, detach from the opener, close the rest. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.pending = 0
    if (!this.deps.opener.isDestroyed()) this.deps.opener.off('did-create-window', this.onCreated)
    await this.closeAll()
  }
}

function titleFor(url: string): string {
  try {
    return `${new URL(url).host} · GameHub`
  } catch {
    return 'GameHub'
  }
}
