import { useId, type ReactNode } from 'react'

interface FieldProps {
  label: string
  hint?: string
  error?: string | undefined
  /** Receives the ids to wire the control to its label, hint and error. */
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/** A labelled form control with an optional hint and error, wired for assistive technology. */
export function Field({ label, hint, error, children }: FieldProps) {
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId].filter((id) => id !== null).join(' ')

  return (
    <div className="field">
      <label className="field-label" htmlFor={inputId}>{label}</label>
      {children({ inputId, describedBy: describedBy === '' ? undefined : describedBy, invalid: error !== undefined })}
      {hint === undefined ? null : <p id={hintId} className="field-hint">{hint}</p>}
      {error === undefined ? null : <p id={errorId} className="field-error" role="alert">{error}</p>}
    </div>
  )
}
