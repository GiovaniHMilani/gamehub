import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { confirmRemoveInstance } from '../../stores/actions'
import { useDomainStore } from '../../stores/domain-store'
import { useUiStore } from '../../stores/ui-store'

/**
 * Removing an account deletes its login and every byte of its browser data, so it asks first.
 * Cancel comes first in the DOM, so it is the focused default.
 */
export function ConfirmRemoveDialog({ instanceId }: { instanceId: string }) {
  const close = useUiStore((s) => s.closeDialog)
  const instance = useDomainStore((s) => s.instancesById[instanceId])
  const gameName = useDomainStore((s) => (instance === undefined ? undefined : s.gameById[instance.gameId]?.name))
  const [submitting, setSubmitting] = useState(false)
  const exists = instance !== undefined

  // Removed somewhere else while this was open: there is nothing left to confirm.
  useEffect(() => {
    if (!exists) close()
  }, [exists, close])

  if (instance === undefined) return null

  const remove = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    const done = await confirmRemoveInstance(api(), instanceId)
    setSubmitting(false)
    if (done) close()
  }

  return (
    <Modal title={`Remove ${instance.label}?`} onClose={close}>
      <p>
        This deletes the login and all saved data of <strong>{instance.label}</strong>
        {gameName === undefined ? '' : ` in ${gameName}`}. It can't be undone.
        {instance.status === 'running' || instance.status === 'starting' ? ' The account will be stopped first.' : ''}
      </p>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button tone="destructive" disabled={submitting} onClick={() => void remove()}>
          {submitting ? 'Removing…' : 'Remove account'}
        </Button>
      </div>
    </Modal>
  )
}
