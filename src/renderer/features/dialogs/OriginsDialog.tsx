import { useState, type FormEvent } from 'react'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { Field } from '../../components/common/Field'
import { Modal } from '../../components/common/Modal'
import { gameHost } from '../../model/game-identity'
import { normalizeOrigin, validateOrigin } from '../../model/forms'
import { describeFailure } from '../../model/messages'
import { setGameOrigins } from '../../stores/actions'
import { useDomainStore } from '../../stores/domain-store'
import { useUiStore } from '../../stores/ui-store'

/**
 * The extra sites a game may reach (its sign-in provider, for example). Usually they are added by
 * answering the "Allow?" notice; this is where they are reviewed and taken away. Each change is
 * validated by Main and applies at once to the game's running accounts.
 */
export function OriginsDialog({ gameId }: { gameId: string }) {
  const close = useUiStore((s) => s.closeDialog)
  const game = useDomainStore((s) => s.gameById[gameId])
  const [draft, setDraft] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (game === undefined) return null // removed elsewhere; the host closes this dialog
  const origins = game.allowedOrigins

  const save = async (next: readonly string[]): Promise<boolean> => {
    setBusy(true)
    setFormError(null)
    const result = await setGameOrigins(api(), gameId, next).catch(() => null)
    setBusy(false)
    if (result === null) setFormError(describeFailure('save', 'INTERNAL'))
    else if (!result.ok) setFormError(describeFailure('save', result.error.code))
    return result?.ok === true
  }

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    const problem = validateOrigin(draft, origins)
    setFieldError(problem ?? undefined)
    if (problem !== null) return
    if (await save([...origins, normalizeOrigin(draft)])) setDraft('')
  }

  return (
    <Modal title={`Allowed sites for ${game.name}`} onClose={close}>
      <p className="field-hint">
        {game.name} can always use {gameHost(game.startUrl)}. Other sites, like a sign-in provider, are blocked until you allow them.
        GameHub asks when a game tries to reach one. Changes apply right away to running accounts.
      </p>

      <ul className="origin-list" aria-label="Allowed sites">
        <li className="origin-item origin-implicit">
          <span className="origin-text">{gameHost(game.startUrl)}</span>
          <span className="field-hint">the game itself</span>
        </li>
        {origins.map((origin) => (
          <li key={origin} className="origin-item" data-testid={`origin-${origin}`}>
            <span className="origin-text">{origin}</span>
            <Button tone="danger" size="small" disabled={busy} aria-label={`Remove ${origin}`} onClick={() => void save(origins.filter((o) => o !== origin))}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {origins.length === 0 ? <p className="field-hint">No extra sites yet.</p> : null}

      <form onSubmit={(event) => void add(event)} noValidate style={{ display: 'contents' }}>
        <Field label="Allow another site" error={fieldError}>
          {({ inputId, describedBy, invalid }) => (
            <div className="add-row">
              <input
                id={inputId}
                className="input"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://login.example.com"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button type="submit" disabled={busy}>Allow</Button>
            </div>
          )}
        </Field>
      </form>
      {formError === null ? null : <p className="form-error" role="alert">{formError}</p>}
      <div className="dialog-footer">
        <Button tone="primary" onClick={close}>Done</Button>
      </div>
    </Modal>
  )
}
