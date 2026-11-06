/**
 * Minimal stand-ins for the few Electron objects PopupController touches, so its
 * decisions can be tested for situations a real Chromium never produces
 * (a popup in the wrong session, with weakened preferences, ...).
 */
type Listener = (...args: never[]) => void
type OpenHandler = (details: { url: string; features: string; disposition: string }) => unknown

export class FakeContents {
  private static nextId = 1
  readonly id = FakeContents.nextId++
  destroyed = false
  windowOpenHandler: OpenHandler | null = null
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(readonly session: object = {}) {}

  setWindowOpenHandler(handler: OpenHandler): void {
    this.windowOpenHandler = handler
  }
  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)?.add(listener)
    return this
  }
  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) (listener as (...a: unknown[]) => void)(...args)
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0)
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

export class FakeWindow {
  title = ''
  destroyed = false
  private readonly closed: Array<() => void> = []
  constructor(readonly webContents: FakeContents) {}

  once(event: string, listener: () => void): this {
    if (event === 'closed') this.closed.push(listener)
    return this
  }
  setTitle(title: string): void {
    this.title = title
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.webContents.destroyed = true
    this.closed.splice(0).forEach((listener) => listener())
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

export const SAFE_PREFS = { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false }
