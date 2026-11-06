import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { GameSummary, InstanceSummary } from '@shared/domain/types'
import type { Result } from '@shared/ipc/result'

/**
 * TEMPORARY control strip for the vertical slice. It only issues typed
 * commands through window.gamehub and mirrors the state Main pushes; Main
 * owns the lifecycle. The real UI starts in roadmap phase 8.
 */

function upsert(list: readonly InstanceSummary[], next: InstanceSummary): InstanceSummary[] {
  const index = list.findIndex((item) => item.id === next.id)
  if (index === -1) return [...list, next]
  return list.map((item) => (item.id === next.id ? next : item))
}

export function App() {
  const [instances, setInstances] = useState<readonly InstanceSummary[]>([])
  const [games, setGames] = useState<readonly GameSummary[]>([])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [i, g] = await Promise.all([window.gamehub.instances.list(), window.gamehub.games.list()])
    if (i.ok) setInstances(i.data)
    if (g.ok) setGames(g.data)
  }, [])

  useEffect(() => {
    void refresh()
    return window.gamehub.instances.onChanged((summary) => setInstances((prev) => upsert(prev, summary)))
  }, [refresh])

  const run = async (action: () => Promise<Result<unknown>>): Promise<void> => {
    const result = await action()
    setError(result.ok ? null : result.error.message)
    await refresh()
  }

  const addAccount = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    let game = games.find((g) => g.startUrl === url)
    if (game === undefined) {
      const created = await window.gamehub.games.create({ name: new URL(url).hostname, startUrl: url })
      if (!created.ok) return setError(created.error.message)
      game = created.data
    }
    await run(() => window.gamehub.instances.create({ gameId: game.id, label }))
    setLabel('')
  }

  return (
    <main data-testid="app-root" style={{ height: 64, overflow: 'hidden', font: '13px system-ui', padding: '8px 12px' }}>
      <strong data-testid="app-title">GameHub</strong>
      <form onSubmit={(e) => void addAccount(e)} style={{ display: 'inline-flex', gap: 6, marginLeft: 12 }}>
        <input aria-label="Game URL" placeholder="https://game.example/" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input aria-label="Account label" placeholder="Account" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" disabled={url === '' || label === ''}>Add account</button>
      </form>
      {error !== null && <span role="alert" style={{ marginLeft: 12, color: '#b00020' }}>{error}</span>}
      <ul style={{ display: 'flex', gap: 12, listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
        {instances.map((instance) => (
          <li key={instance.id} data-testid={`instance-${instance.label}`}>
            {instance.label}: <span data-status={instance.status}>{instance.status}</span>
            {instance.errorCode !== null && ` (${instance.errorCode})`}{' '}
            <button onClick={() => void run(() => window.gamehub.instances.start(instance.id))}>Start</button>
            <button onClick={() => void run(() => window.gamehub.instances.stop(instance.id))}>Close</button>
            <button onClick={() => void run(() => window.gamehub.instances.restart(instance.id))}>Restart</button>
            <button onClick={() => void run(() => window.gamehub.instances.remove(instance.id))}>Remove</button>
          </li>
        ))}
      </ul>
    </main>
  )
}
