import { useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { Field } from '../../components/common/Field'
import { Modal } from '../../components/common/Modal'
import { MAX_ACCOUNT_LABEL, suggestedAccountLabel, validateAccountLabel } from '../../model/forms'
import { describeFailure } from '../../model/messages'
import { createAccount } from '../../stores/actions'
import { useDomainStore } from '../../stores/domain-store'
import { useUiStore } from '../../stores/ui-store'

export function AddAccountDialog({ gameId }: { gameId: string }) {
  const close = useUiStore((s) => s.closeDialog)
  const game = useDomainStore((s) => s.gameById[gameId])
  const existingLabels = useDomainStore(
    useShallow((s) => (s.accountIdsByGame[gameId] ?? []).map((id) => s.instancesById[id]?.label ?? '')),
  )
  const [label, setLabel] = useState(() => suggestedAccountLabel(existingLabels))
  const [error, setError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (startAfter: boolean): Promise<void> => {
    if (submitting) return
    const problem = validateAccountLabel(label, existingLabels)
    setError(problem ?? undefined)
    setFormError(null)
    if (problem !== null) return

    setSubmitting(true)
    const result = await createAccount(api(), { gameId, label: label.trim() }, { startAfter }).catch(() => null)
    setSubmitting(false)

    if (result === null) setFormError(describeFailure('create', 'INTERNAL'))
    else if (!result.ok) setFormError(describeFailure('create', result.error.code))
    else close()
  }

  if (game === undefined) return null // the game disappeared; the host closes this dialog

  return (
    <Modal title={`Add an account to ${game.name}`} onClose={close}>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void submit(false)
        }}
        noValidate
        style={{ display: 'contents' }}
      >
        <p className="field-hint">
          Each account is its own browser, with its own login and saved data. Nothing is shared with the others.
        </p>
        <Field label="Account name" hint="So you can tell it apart, like Main or Alt 2." error={error}>
          {({ inputId, describedBy, invalid }) => (
            <input
              id={inputId}
              className="input"
              autoComplete="off"
              maxLength={MAX_ACCOUNT_LABEL + 10}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          )}
        </Field>
        {formError === null ? null : <p className="form-error" role="alert">{formError}</p>}
        <div className="dialog-footer">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" disabled={submitting}>Add account</Button>
          <Button tone="primary" disabled={submitting} onClick={() => void submit(true)}>Add and start</Button>
        </div>
      </form>
    </Modal>
  )
}
