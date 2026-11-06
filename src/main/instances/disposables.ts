/** Collects cleanup callbacks; `dispose()` runs them once, newest first. */
export class Disposables {
  private fns: Array<() => void> = []

  add(fn: () => void): void {
    this.fns.push(fn)
  }

  get size(): number {
    return this.fns.length
  }

  dispose(): void {
    const fns = this.fns
    this.fns = []
    for (const fn of fns.reverse()) {
      try {
        fn()
      } catch {
        // A failing cleanup must not prevent the others from running.
      }
    }
  }
}
