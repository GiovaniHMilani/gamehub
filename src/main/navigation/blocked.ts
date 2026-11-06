/**
 * A navigation or popup that policy refused (ADR-0007), reported so the user can
 * decide whether to allow its origin (ADR-0016).
 */
export type BlockedKind = 'navigation' | 'popup' | 'popup-navigation'

export interface BlockedRequest {
  readonly instanceId: string
  /**
   * The full destination. It may carry OAuth `state`/`client_id`, so it stays in Main
   * memory: it is never logged and never sent to the renderer.
   */
  readonly url: string
  readonly kind: BlockedKind
  /** Re-issues the refused navigation once its origin has been allowed. Absent when it cannot be redone. */
  readonly retry?: () => void
}

export type BlockedHandler = (request: BlockedRequest) => void
