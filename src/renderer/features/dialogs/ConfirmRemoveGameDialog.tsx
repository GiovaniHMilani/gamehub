import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { confirmRemoveGame } from '../../stores/actions'
import { useDomainStore } from '../../stores/domain-store'
import { gameCounts } from '../../stores/selectors'
import { useUiStore } from '../../stores/ui-store'

/**
 * Removing a game also deletes every account of it, with their logins and saved data, so the
 * dialog says exactly how many, and how many are running. Cancel is the focused default.
 */
export function ConfirmRemoveGameDialog({ gameId }: { gameId: string }) {
  const close = useUiStore((s) => s.closeDialog)
  const game = useDomainStore((s) => s.gameById[gameId])
  const counts = useDomainStore(useShallow((s) => gameCounts(s, gameId)))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const exists = game !== undefined

  // Removed somewhere else while this was open: nothing is left to confirm.
  useEffect(() => {
    if (!exists) close()
  }, [exists, close])

  if (game === undefined) return null

  const remove = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    const failure = await confirmRemoveGame(api(), gameId)
    setSubmitting(false)
    if (failure === null) close()
    else setError(failure)
  }

  const accounts = `${counts.total} ${counts.total === 1 ? 'account' : 'accounts'}`
  return (
    <Modal title={`Remove ${game.name}?`} onClose={close}>
      {counts.total === 0 ? (
        <p>
          This removes <strong>{game.name}</strong> from your library. It has no accounts.
        </p>
      ) : (
        <p>
          This removes <strong>{game.name}</strong> and its {accounts}, deleting their logins and all saved data. It can't be
          undone.
          {counts.running + counts.busy > 0 ? ` ${counts.running + counts.busy} running ${counts.running + counts.busy === 1 ? 'account' : 'accounts'} will be stopped first.` : ''}
        </p>
      )}
      {error === null ? null : <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button tone="destructive" disabled={submitting} onClick={() => void remove()}>
          {submitting ? 'Removing…' : 'Remove game'}
        </Button>
      </div>
    </Modal>
  )
}
