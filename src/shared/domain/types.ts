/**
 * Core domain types (docs/architecture/overview.md §3, ADR-0002).
 *
 *   Game 1───* GameAccount 1───0..1 GameInstance ···> InstanceRuntime (memory)
 *                  └── partitionId ──> persist:gh-<partitionId>
 *
 * Persisted entities hold metadata only. Browser state (cookies, storage,
 * cache) lives in the Electron partition and never appears here.
 */

/** Runtime lifecycle (ADR-0004). Never persisted; the DB stores intent only. */
export const INSTANCE_STATUSES = ['stopped', 'starting', 'running', 'stopping', 'crashed', 'error'] as const
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number]

export interface Game {
  readonly id: string
  readonly name: string
  /** Validated by parseGameUrl. Restore always starts here (ADR-0003). */
  readonly startUrl: string
  /** One short line shown in the catalog. May be empty. */
  readonly description: string
  /**
   * Extra origins (beyond startUrl's) the game may navigate to or open popups on,
   * e.g. its OAuth provider. Patterns per origin-pattern.ts (ADR-0007).
   */
  readonly allowedOrigins: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface GameAccount {
  readonly id: string
  readonly gameId: string
  readonly label: string
  /** Immutable UUID v4 generated in Main. Never reused after deletion. */
  readonly partitionId: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** Persisted instance configuration. 1 account : 0..1 instance. */
export interface GameInstance {
  readonly id: string
  readonly accountId: string
  /** User intent: should this instance come back on app start. */
  readonly restoreOnLaunch: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

/**
 * Browser identity of an account. Resolved only by SessionManager.
 * Main-process only: partition data is never sent to the renderer.
 */
export interface SessionIdentity {
  readonly accountId: string
  readonly partitionId: string
  /** `persist:gh-<partitionId>` */
  readonly partitionName: string
}

// ---- Renderer-facing DTOs (no partition/session details) -------------------

export interface GameSummary {
  readonly id: string
  readonly name: string
  readonly startUrl: string
  readonly description: string
  /** Creation time (ms). The UI uses it to give each game a stable, distinct colour. */
  readonly createdAt: number
  readonly allowedOrigins: readonly string[]
}

export interface InstanceSummary {
  readonly id: string
  readonly gameId: string
  readonly accountId: string
  readonly label: string
  readonly status: InstanceStatus
  /** Set when status is `error` (e.g. ERR_CONNECTION_REFUSED), else null. */
  readonly errorCode: string | null
  readonly restoreOnLaunch: boolean
}

export interface CreateGameInput {
  readonly name: string
  readonly startUrl: string
  readonly description?: string | undefined
  readonly allowedOrigins?: readonly string[] | undefined
}

export interface SetAllowedOriginsInput {
  readonly gameId: string
  readonly allowedOrigins: readonly string[]
}

export interface CreateInstanceInput {
  readonly gameId: string
  readonly label: string
}

export interface UpdateGameInput {
  readonly gameId: string
  readonly name: string
  readonly startUrl: string
  readonly description: string
}

export interface GameRef {
  readonly gameId: string
}

export interface InstanceRef {
  readonly instanceId: string
}

// ---- Blocked-request notices (ADR-0016) -------------------------------------

export type NoticeKind = 'navigation' | 'popup' | 'popup-navigation'

/** What the renderer is told about a blocked request: who, where to, never the full URL. */
export interface Notice {
  readonly id: string
  readonly instanceId: string
  readonly instanceLabel: string
  readonly gameId: string
  readonly gameName: string
  /** Origin of the destination only, e.g. https://accounts.google.com */
  readonly origin: string
  readonly kind: NoticeKind
}

export type NoticeDecision = 'allow' | 'dismiss'

export interface ResolveNoticeInput {
  readonly noticeId: string
  readonly decision: NoticeDecision
}
