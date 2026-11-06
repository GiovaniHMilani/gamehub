import { useEffect, useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { Field } from '../../components/common/Field'
import { Modal } from '../../components/common/Modal'
import {
  describeAddressChange,
  hasErrors,
  MAX_DESCRIPTION,
  MAX_GAME_NAME,
  suggestedGameName,
  validateGameForm,
  type GameFormErrors,
} from '../../model/forms'
import { describeFailure } from '../../model/messages'
import { updateGame } from '../../stores/actions'
import { useDomainStore } from '../../stores/domain-store'
import { gameCounts } from '../../stores/selectors'
import { useUiStore } from '../../stores/ui-store'

/**
 * Edit a game's address, name and description. The address is the delicate one: logins belong to a
 * SITE, so moving to another site can sign accounts out, and running accounts stay on the page they
 * are on until they are restarted. The form says so before saving, in proportion to what changed.
 */
export function EditGameDialog({ gameId }: { gameId: string }) {
  const close = useUiStore((s) => s.closeDialog)
  const game = useDomainStore((s) => s.gameById[gameId])
  const counts = useDomainStore(useShallow((s) => gameCounts(s, gameId)))
  const [url, setUrl] = useState(game?.startUrl ?? '')
  const [name, setName] = useState(game?.name ?? '')
  const [description, setDescription] = useState(game?.description ?? '')
  const [errors, setErrors] = useState<GameFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const exists = game !== undefined

  // Removed while this was open: there is nothing left to edit.
  useEffect(() => {
    if (!exists) close()
  }, [exists, close])

  if (game === undefined) return null

  const change = describeAddressChange(game.startUrl, url)
  const live = counts.running + counts.busy
  const suggested = suggestedGameName(url)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    const found = validateGameForm({ name, url, description })
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) return

    const next = {
      name: name.trim() === '' ? suggested : name.trim(),
      startUrl: url.trim(),
      description: description.trim(),
    }
    if (next.name === game.name && next.startUrl === game.startUrl && next.description === game.description) {
      close() // nothing changed: nothing to ask Main
      return
    }

    setSubmitting(true)
    const result = await updateGame(api(), { gameId, ...next }).catch(() => null)
    setSubmitting(false)
    if (result === null) setFormError(describeFailure('save', 'INTERNAL'))
    else if (!result.ok) setFormError(describeFailure('save', result.error.code))
    else close()
  }

  return (
    <Modal title={`Edit ${game.name}`} onClose={close}>
      <form onSubmit={(event) => void submit(event)} noValidate style={{ display: 'contents' }}>
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
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
        </Field>

        {change === 'site' && counts.total > 0 ? (
          <p className="form-note" role="note">
            This is a different site. Each account keeps its saved data, but logins belong to the site they were made on, so
            accounts may need to sign in again.
          </p>
        ) : null}
        {change !== 'none' && live > 0 ? (
          <p className="form-note" role="note">
            {live} running {live === 1 ? 'account keeps' : 'accounts keep'} the current page until you restart {live === 1 ? 'it' : 'them'}.
          </p>
        ) : null}

        <Field label="Name" hint={suggested === '' ? 'Leave empty to use the address.' : `Leave empty to use ${suggested}.`} error={errors.name}>
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
        <Field label="Description" hint="One line to help you recognise it." error={errors.description}>
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
          <Button type="submit" tone="primary" disabled={submitting}>{submitting ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </form>
    </Modal>
  )
}
