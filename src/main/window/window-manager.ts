import { BrowserWindow, WebContentsView, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import type { Logger } from '../logging/logger'
import { isAllowedTopLevelNavigation } from '../navigation/policy'
import {
  LoadAbortedError,
  LoadFailedError,
  ProcessGoneError,
  type MountedView,
  type ViewHost,
} from '../instances/ports'

/** Height reserved for the shell's own UI strip; game views sit below it. */
const CHROME_HEIGHT = 64

interface ManagedView {
  readonly view: WebContentsView
  /** Kept separately: `view.webContents` is undefined once closed (spike S4). */
  readonly contents: WebContents
  readonly goneListeners: Set<(reason: string) => void>
  readonly removeContentsListeners: () => void
}

/**
 * Owns the single shell BrowserWindow and every game WebContentsView
 * (ADR-0001). It creates, positions, focuses and destroys views; it knows
 * nothing about lifecycle rules, which belong to InstanceManager.
 *
 * Phase note: window creation and view layout live together here for this
 * slice. The architecture's MainWindow/LayoutController split is deferred
 * until renderer-driven layout (roadmap phase 7).
 */
export class WindowManager implements ViewHost<Session> {
  private window: BrowserWindow | null = null
  private readonly views = new Map<string, ManagedView>()

  constructor(private readonly log: Logger) {}

  get mainWindow(): BrowserWindow | null {
    return this.window
  }

  createMainWindow(): BrowserWindow {
    if (this.window !== null && !this.window.isDestroyed()) return this.window

    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: 'GameHub',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    })
    this.window = window

    window.once('ready-to-show', () => window.show())
    const onResize = (): void => this.relayout()
    window.on('resize', onResize)
    window.once('closed', () => {
      window.off('resize', onResize)
      this.window = null
    })

    // The shell must never navigate away from itself.
    const shellUrl = (): string => window.webContents.getURL().split('#')[0] ?? ''
    window.webContents.on('will-navigate', (event, url) => {
      if (url.split('#')[0] !== shellUrl()) {
        event.preventDefault()
        this.log.warn('navigation.shell_blocked', { url })
      }
    })

    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (devServerUrl !== undefined && devServerUrl !== '') {
      void window.loadURL(devServerUrl)
    } else {
      void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    }
    return window
  }

  // ---- ViewHost --------------------------------------------------------

  mount(args: { instanceId: string; session: Session; allowedOrigins: readonly string[] }): MountedView {
    const { instanceId, session, allowedOrigins } = args
    const window = this.window
    if (window === null || window.isDestroyed()) throw new Error('Main window is not available')
    if (this.views.has(instanceId)) throw new Error('View already mounted for instance')

    // Game content is untrusted: sandboxed, no Node, and deliberately no preload.
    const view = new WebContentsView({
      webPreferences: {
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    })
    const contents = view.webContents
    const goneListeners = new Set<(reason: string) => void>()

    contents.setWindowOpenHandler(({ url }) => {
      this.log.warn('navigation.popup_denied', { instanceId, url })
      return { action: 'deny' }
    })
    const guard = (event: { preventDefault(): void }, url: string): void => {
      if (!isAllowedTopLevelNavigation(url, allowedOrigins)) {
        event.preventDefault()
        this.log.warn('navigation.blocked', { instanceId, url })
      }
    }
    const onGone = (_event: unknown, details: { reason: string }): void => {
      goneListeners.forEach((listener) => listener(details.reason))
    }
    contents.on('will-navigate', guard)
    contents.on('will-redirect', guard)
    contents.on('render-process-gone', onGone)

    window.contentView.addChildView(view)
    this.views.set(instanceId, {
      view,
      contents,
      goneListeners,
      removeContentsListeners: () => {
        contents.off('will-navigate', guard)
        contents.off('will-redirect', guard)
        contents.off('render-process-gone', onGone)
      },
    })
    this.relayout()
    this.log.info('view.created', { instanceId, count: this.views.size })

    return {
      onGone: (listener) => {
        goneListeners.add(listener)
        return () => goneListeners.delete(listener)
      },
      loadUrl: (url, signal) => this.load(instanceId, contents, goneListeners, url, signal),
    }
  }

  async unmount(instanceId: string): Promise<void> {
    const managed = this.views.get(instanceId)
    if (managed === undefined) return
    this.views.delete(instanceId)

    managed.goneListeners.clear()
    managed.removeContentsListeners()
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.contentView.removeChildView(managed.view)
    }
    // Removing a view does not destroy its webContents (spike S4): close it.
    if (!managed.contents.isDestroyed()) {
      const destroyed = new Promise<void>((resolve) => managed.contents.once('destroyed', () => resolve()))
      managed.contents.close()
      await destroyed
    }
    this.relayout()
    this.log.info('view.destroyed', { instanceId, count: this.views.size })
  }

  // ---- focus / visibility / bounds ------------------------------------

  focusView(instanceId: string): void {
    const managed = this.views.get(instanceId)
    if (managed !== undefined && !managed.contents.isDestroyed()) managed.contents.focus()
  }

  setVisible(instanceId: string, visible: boolean): void {
    this.views.get(instanceId)?.view.setVisible(visible)
  }

  /** Number of live views (for leak checks). */
  get viewCount(): number {
    return this.views.size
  }

  /**
   * Temporary even grid below the shell strip. Renderer-driven layout
   * (ADR-0001: renderer expresses intent, Main applies it) replaces this later.
   */
  private relayout(): void {
    const window = this.window
    if (window === null || window.isDestroyed() || this.views.size === 0) return
    const { width, height } = window.getContentBounds()
    const top = CHROME_HEIGHT
    const areaHeight = Math.max(0, height - top)
    const count = this.views.size
    const columns = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / columns)
    const cellWidth = Math.floor(width / columns)
    const cellHeight = Math.floor(areaHeight / rows)
    let index = 0
    for (const { view } of this.views.values()) {
      const column = index % columns
      const row = Math.floor(index / columns)
      view.setBounds({ x: column * cellWidth, y: top + row * cellHeight, width: cellWidth, height: cellHeight })
      index++
    }
  }

  private load(
    instanceId: string,
    contents: WebContents,
    goneListeners: Set<(reason: string) => void>,
    url: string,
    signal: AbortSignal,
  ): Promise<void> {
    this.log.info('navigation.started', { instanceId, url })
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new LoadAbortedError())
        return
      }
      let settled = false
      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        goneListeners.delete(onGone)
        finish()
      }
      const onAbort = (): void => {
        settle(() => reject(new LoadAbortedError()))
        if (!contents.isDestroyed()) contents.stop()
      }
      const onGone = (reason: string): void => settle(() => reject(new ProcessGoneError(reason)))

      signal.addEventListener('abort', onAbort, { once: true })
      goneListeners.add(onGone)

      // loadURL resolves on did-finish-load and rejects on did-fail-load.
      contents.loadURL(url).then(
        () => {
          this.log.info('navigation.completed', { instanceId, url })
          settle(resolve)
        },
        (error: unknown) => {
          const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'ERR_UNKNOWN'
          this.log.warn('navigation.failed', { instanceId, url, code })
          settle(() => reject(new LoadFailedError(code)))
        },
      )
    })
  }
}
