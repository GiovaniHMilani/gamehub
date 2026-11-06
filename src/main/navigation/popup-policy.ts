import { parseGameUrl } from '@shared/domain/game-url'
import { matchesAnyOrigin } from '@shared/domain/origin-pattern'

/**
 * Popup policy for game views (ADR-0007). Pure: decides, never acts.
 *
 * A popup is allowed only when ALL of these hold:
 *  - it was requested by the game page itself, not by another popup (no chains);
 *  - the disposition is a real new window or foreground tab;
 *  - the URL is https (http only on loopback), has no credentials and is not blank;
 *  - the URL's origin is one of the game's allowed origins;
 *  - the instance has no other popup open, and is under the per-minute budget.
 *
 * It is provider-agnostic: nothing here knows Google, Discord, Steam, etc.
 */

export const MAX_OPEN_POPUPS_PER_INSTANCE = 1
export const MAX_POPUP_OPENS_PER_WINDOW = 5
export const POPUP_RATE_WINDOW_MS = 60_000

export type PopupDenyReason =
  | 'nested_popup'
  | 'disposition'
  | 'invalid_url'
  | 'insecure_url'
  | 'origin_not_allowed'
  | 'too_many_open'
  | 'rate_limited'

export type PopupDecision = { readonly action: 'allow' } | { readonly action: 'deny'; readonly reason: PopupDenyReason }

export interface PopupRequest {
  readonly url: string
  readonly disposition: string
  readonly allowedOrigins: readonly string[]
  /** True when the request comes from a popup rather than the game view. */
  readonly fromPopup: boolean
  readonly openCount: number
  /** Timestamps (ms) of earlier ALLOWED popup requests of this instance. */
  readonly recentOpens: readonly number[]
  readonly now: number
}

const ALLOWED_DISPOSITIONS: ReadonlySet<string> = new Set(['new-window', 'foreground-tab'])

export function decidePopup(request: PopupRequest): PopupDecision {
  const deny = (reason: PopupDenyReason): PopupDecision => ({ action: 'deny', reason })

  if (request.fromPopup) return deny('nested_popup')
  if (!ALLOWED_DISPOSITIONS.has(request.disposition)) return deny('disposition')

  try {
    new URL(request.url)
  } catch {
    return deny('invalid_url') // includes the empty URL of `window.open('')`
  }
  if (!parseGameUrl(request.url).ok) return deny('insecure_url')
  if (!matchesAnyOrigin(request.url, request.allowedOrigins)) return deny('origin_not_allowed')

  if (request.openCount >= MAX_OPEN_POPUPS_PER_INSTANCE) return deny('too_many_open')
  const recent = request.recentOpens.filter((at) => request.now - at < POPUP_RATE_WINDOW_MS)
  if (recent.length >= MAX_POPUP_OPENS_PER_WINDOW) return deny('rate_limited')

  return { action: 'allow' }
}

/** Drops timestamps that fell out of the rate window (no timers needed). */
export function pruneRecentOpens(recentOpens: readonly number[], now: number): number[] {
  return recentOpens.filter((at) => now - at < POPUP_RATE_WINDOW_MS)
}

// ---- window size ----------------------------------------------------------

const MIN_SIZE = { width: 320, height: 400 }
const MAX_SIZE = { width: 1000, height: 1000 }
const DEFAULT_SIZE = { width: 500, height: 650 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Reads width/height from a `window.open` features string, clamped to a sane range. */
export function parsePopupSize(features: string): { width: number; height: number } {
  const read = (name: string): number | null => {
    const match = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(\\d{1,5})`, 'i').exec(features)
    return match?.[1] === undefined ? null : Number(match[1])
  }
  const width = read('width')
  const height = read('height')
  return {
    width: width === null ? DEFAULT_SIZE.width : clamp(width, MIN_SIZE.width, MAX_SIZE.width),
    height: height === null ? DEFAULT_SIZE.height : clamp(height, MIN_SIZE.height, MAX_SIZE.height),
  }
}

// ---- popup lifecycle ------------------------------------------------------

/**
 * requested -> validated -> created -> navigating -> running -> closed
 * A popup can be closed from any state after `created` (user, script, instance stop).
 */
export type PopupState = 'requested' | 'validated' | 'created' | 'navigating' | 'running' | 'closed'

const POPUP_TRANSITIONS: Readonly<Record<PopupState, readonly PopupState[]>> = {
  requested: ['validated'],
  validated: ['created'],
  created: ['navigating', 'running', 'closed'],
  navigating: ['navigating', 'running', 'closed'],
  running: ['navigating', 'closed'],
  closed: [],
}

export function canTransitionPopup(from: PopupState, to: PopupState): boolean {
  return POPUP_TRANSITIONS[from].includes(to)
}
