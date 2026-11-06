import type { ReactNode } from 'react'

/** Centered message for empty, loading and error states: a title, a sentence, and optionally an action. */
export function StatePanel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel-center">
      <div className="state-panel">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
