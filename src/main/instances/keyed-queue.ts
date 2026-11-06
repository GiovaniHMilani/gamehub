/**
 * Runs async tasks one at a time per key, in submission order.
 * A failing task does not block the next one. Idle keys are released, so the
 * queue holds no references once everything has settled.
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    // `previous` is always a settled-or-pending promise that never rejects.
    const result = previous.then(task)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }

  /** Number of keys with pending or running work. */
  get activeKeys(): number {
    return this.tails.size
  }
}
