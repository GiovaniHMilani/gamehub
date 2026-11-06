/**
 * What InstanceManager needs from the window layer. Implemented by
 * WindowManager (Electron) and by fakes in unit tests, so lifecycle logic
 * stays testable without a browser.
 */

export class LoadAbortedError extends Error {
  constructor() {
    super('Load aborted')
    this.name = 'LoadAbortedError'
  }
}

export class LoadFailedError extends Error {
  readonly code: string
  constructor(code: string) {
    super(`Load failed: ${code}`)
    this.name = 'LoadFailedError'
    this.code = code
  }
}

export class ProcessGoneError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`Render process gone: ${reason}`)
    this.name = 'ProcessGoneError'
    this.reason = reason
  }
}

/** Handle to a mounted game view. Owned by the window layer. */
export interface MountedView {
  /**
   * Resolves when the main frame finished loading. Rejects with
   * LoadAbortedError (signal aborted), LoadFailedError, or ProcessGoneError.
   */
  loadUrl(url: string, signal: AbortSignal): Promise<void>
  /** Subscribes to renderer-process death. Returns an unsubscribe function. */
  onGone(listener: (reason: string) => void): () => void
}

export interface ViewHost<S> {
  /** Creates a view bound to `session` and attaches it to the main window. */
  mount(args: { instanceId: string; session: S; allowedOrigins: readonly string[] }): MountedView
  /** Detaches the view, closes its webContents and resolves once destroyed. */
  unmount(instanceId: string): Promise<void>
  /** Replaces the origins a mounted view (and its popups) may navigate to. No-op if not mounted. */
  updateAllowedOrigins(instanceId: string, origins: readonly string[]): void
}
