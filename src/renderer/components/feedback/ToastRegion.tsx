import { useEffect } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { Button } from '../common/Button'

const AUTO_DISMISS_MS = 4500

/**
 * The newest message, in the top bar. It lives in the chrome (never over the Play viewport, where
 * a game view would cover it). Successes fade by themselves; an error stays until dismissed.
 */
export function ToastRegion() {
  const toast = useUiStore((s) => s.toasts.at(-1))
  const dismiss = useUiStore((s) => s.dismissToast)
  const id = toast?.id
  const tone = toast?.tone

  useEffect(() => {
    if (id === undefined || tone === 'error') return
    const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    return () => clearTimeout(timer) // never leave a timer behind for a toast that is gone
  }, [id, tone, dismiss])

  return (
    <div className="topbar-feedback" role="status" aria-live="polite">
      {toast === undefined ? null : (
        <div className="toast" data-tone={toast.tone}>
          <span className="toast-text" title={toast.text}>{toast.text}</span>
          <Button tone="quiet" size="small" aria-label="Dismiss message" onClick={() => dismiss(toast.id)}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  )
}
