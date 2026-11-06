import { useEffect, useState } from 'react'
import { InstanceSyncEngine, type SyncView } from '@shared/ipc/event-sync'

const INITIAL: SyncView = { seq: null, instances: [], resyncs: 0 }

/**
 * Mirror of Main's instance state. Main is the source of truth; this hook only
 * keeps a consistent copy via snapshot + sequenced events (ADR-0015).
 * Effect cleanup unsubscribes, so StrictMode's double-mount leaves one listener.
 */
export function useInstances(): SyncView {
  const [view, setView] = useState<SyncView>(INITIAL)

  useEffect(() => {
    const engine = new InstanceSyncEngine({
      snapshot: () => window.gamehub.instances.snapshot(),
      subscribe: (listener) => window.gamehub.instances.onChanged(listener),
      onChange: setView,
    })
    engine.start()
    return () => engine.stop()
  }, [])

  return view
}
