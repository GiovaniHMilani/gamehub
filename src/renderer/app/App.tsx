import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { GameSummary } from '@shared/domain/types'
import type { Result } from '@shared/ipc/result'
import { useInstances } from '../stores/use-instances'
import { useNotices } from '../stores/use-notices'

/**
 * TEMPORARY control strip for the vertical slice. It only issues typed
 * commands through window.gamehub and mirrors the state Main pushes; Main
 * owns the lifecycle. The real UI starts in roadmap phase 8.
 */

/** `https://pokeidle.io` and `https://pokeidle.io/` are the same game URL. */
function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href
  } catch {
    return false
  }
}

export function App() {
  const { instances, seq, resyncs } = useInstances()
  const pendingNotices = useNotices()
  const firstNotice = pendingNotices[0]
  const [games, setGames] = useState<readonly GameSummary[]>([])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshGames = useCallback(async () => {
    const result = await window.gamehub.games.list()
    if (result.ok) setGames(result.data)
  }, [])

  useEffect(() => {
    void refreshGames()
  }, [refreshGames])

  // With a game already in the library, start with it selected (URL filled in),
  // so nobody has to retype a URL just to say which game they mean.
  const autoSelected = useRef(false)
  useEffect(() => {
    const first = games[0]
    if (autoSelected.current || first === undefined || url !== '') return
    autoSelected.current = true
    setUrl(first.startUrl)
  }, [games, url])

  const selectGame = (gameId: string): void => {
    const game = games.find((g) => g.id === gameId)
    setUrl(game?.startUrl ?? '')
    setNotice(null)
  }

  const run = async (action: () => Promise<Result<unknown>>): Promise<void> => {
    const result = await action()
    setError(result.ok ? null : result.error.message)
    // Instance state arrives through sequenced events; nothing to refresh here.
  }

  const resolveNotice = async (noticeId: string, decision: 'allow' | 'dismiss'): Promise<void> => {
    const notice = pendingNotices.find((n) => n.id === noticeId)
    const result = await window.gamehub.notices.resolve({ noticeId, decision })
    setError(result.ok ? null : result.error.message)
    if (result.ok && decision === 'allow' && notice !== undefined) {
      setNotice(
        notice.kind === 'popup'
          ? `Allowed ${notice.origin}. Click the sign-in button again.`
          : `Allowed ${notice.origin} for ${notice.gameName} and retried.`,
      )
      await refreshGames()
    }
  }

  const existingGame = games.find((g) => sameUrl(g.startUrl, url))

  const addAccount = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    let game = games.find((g) => sameUrl(g.startUrl, url))
    if (game === undefined) {
      const created = await window.gamehub.games.create({ name: new URL(url).hostname, startUrl: url })
      if (!created.ok) return setError(created.error.message)
      game = created.data
      await refreshGames()
    }
    await run(() => window.gamehub.instances.create({ gameId: game.id, label }))
    setLabel('')
  }

  return (
    <main data-testid="app-root" style={{ height: 96, boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden', font: '13px system-ui', padding: '8px 12px' }}>
      <strong data-testid="app-title">GameHub</strong>
      <small data-testid="sync-status" style={{ marginLeft: 8, color: '#666' }}>
        seq {seq ?? '-'} · resyncs {resyncs}
      </small>
      <form onSubmit={(e) => void addAccount(e)} style={{ display: 'inline-flex', gap: 6, marginLeft: 12 }}>
        {games.length > 0 && (
          <select aria-label="Game" value={games.find((g) => sameUrl(g.startUrl, url))?.id ?? ''} onChange={(e) => selectGame(e.target.value)}>
            <option value="">New game (type its URL)</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )}
        <input aria-label="Game URL" placeholder="https://game.example/" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input aria-label="Account label" placeholder="Account" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" disabled={url === '' || label === ''} title={url === '' || label === '' ? 'Needs a game URL and an account label' : undefined}>
          Add account
        </button>
      </form>
      {firstNotice !== undefined ? (
        <div
          role="group"
          aria-label="Blocked request"
          data-testid="notice"
          style={{ marginTop: 4, padding: '2px 6px', background: '#fff4c2', border: '1px solid #d9b800', borderRadius: 3 }}
        >
          “{firstNotice.instanceLabel}” wants to {firstNotice.kind === 'popup' ? 'open a window on' : 'go to'}{' '}
          <strong data-testid="notice-origin">{firstNotice.origin}</strong>. Allow it for all accounts of {firstNotice.gameName}?{' '}
          <button onClick={() => void resolveNotice(firstNotice.id, 'allow')}>Allow</button>{' '}
          <button onClick={() => void resolveNotice(firstNotice.id, 'dismiss')}>Dismiss</button>
          {pendingNotices.length > 1 && <span style={{ marginLeft: 8 }}>(+{pendingNotices.length - 1} more)</span>}
        </div>
      ) : (
        <div data-testid="game-status" style={{ marginTop: 4, color: '#444' }}>
          {url === ''
            ? 'Enter the game URL, or pick a game.'
            : existingGame === undefined
              ? 'No game with this URL yet: "Add account" creates it.'
              : `${existingGame.name}: allowed origins ${existingGame.allowedOrigins.length === 0 ? '(none yet: you are asked when something is blocked)' : existingGame.allowedOrigins.join(', ')}`}
          {notice !== null && <span role="status" style={{ marginLeft: 12, color: '#116611' }}>{notice}</span>}
        </div>
      )}
      {error !== null && <span role="alert" style={{ marginLeft: 12, color: '#b00020' }}>{error}</span>}
      <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
        {instances.map((instance) => (
          <li key={instance.id} data-testid={`instance-${instance.label}`} style={{ whiteSpace: 'nowrap' }}>
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
