import { useState, type FormEvent } from 'react'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { Field } from '../../components/common/Field'
import { Modal } from '../../components/common/Modal'
import { hasErrors, MAX_DESCRIPTION, MAX_GAME_NAME, suggestedGameName, validateGameForm, type GameFormErrors } from '../../model/forms'
import { describeFailure } from '../../model/messages'
import { createGame } from '../../stores/actions'
import { useUiStore } from '../../stores/ui-store'

export function AddGameDialog() {
  const close = useUiStore((s) => s.closeDialog)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<GameFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const suggested = suggestedGameName(url)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    const found = validateGameForm({ name, url, description })
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) return

    setSubmitting(true)
    const trimmedDescription = description.trim()
    const result = await createGame(api(), {
      name: name.trim() === '' ? suggested : name.trim(),
      startUrl: url.trim(),
      ...(trimmedDescription === '' ? {} : { description: trimmedDescription }),
    }).catch(() => null)
    setSubmitting(false)

    if (result === null) setFormError(describeFailure('create', 'INTERNAL'))
    else if (!result.ok) setFormError(describeFailure('create', result.error.code))
    else close()
  }

  return (
    <Modal title="Add a game" onClose={close}>
      <form className="dialog-body-form" onSubmit={(event) => void submit(event)} noValidate style={{ display: 'contents' }}>
        <Field label="Address" hint="Where the game lives, like https://example.com/play" error={errors.url}>
          {({ inputId, describedBy, invalid }) => (
            <input
              id={inputId}
              className="input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              placeholder="https://"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
        </Field>
        <Field label="Name" hint={suggested === '' ? 'Optional. Defaults to the address.' : `Optional. Defaults to ${suggested}.`} error={errors.name}>
          {({ inputId, describedBy, invalid }) => (
            <input
              id={inputId}
              className="input"
              maxLength={MAX_GAME_NAME + 20}
              autoComplete="off"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Description" hint="Optional. One line to help you recognise it." error={errors.description}>
          {({ inputId, describedBy, invalid }) => (
            <textarea
              id={inputId}
              className="textarea"
              rows={2}
              maxLength={MAX_DESCRIPTION + 40}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        {formError === null ? null : <p className="form-error" role="alert">{formError}</p>}
        <div className="dialog-footer">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" tone="primary" disabled={submitting}>{submitting ? 'Adding…' : 'Add game'}</Button>
        </div>
      </form>
    </Modal>
  )
}
