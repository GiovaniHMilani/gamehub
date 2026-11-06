import type {
  CreateGameInput,
  CreateInstanceInput,
  GameSummary,
  InstanceSummary,
  Notice,
  ResolveNoticeInput,
  SetAllowedOriginsInput,
} from '../domain/types'
import type { InstanceEvent, InstancesSnapshot } from './instance-events'
import type { Result } from './result'

/**
 * The typed surface exposed to the renderer as `window.gamehub` (ADR-0005).
 * Grows one explicit capability at a time. No generic execute/invoke.
 */
export interface GameHubApi {
  readonly games: {
    create(input: CreateGameInput): Promise<Result<GameSummary>>
    list(): Promise<Result<readonly GameSummary[]>>
    /** Replaces the game's extra allowed origins. Applies at once to the game's running instances. */
    setAllowedOrigins(input: SetAllowedOriginsInput): Promise<Result<GameSummary>>
  }
  readonly instances: {
    list(): Promise<Result<readonly InstanceSummary[]>>
    /** State plus the `seq` it is consistent with. Subscribe to onChanged BEFORE calling this. */
    snapshot(): Promise<Result<InstancesSnapshot>>
    get(instanceId: string): Promise<Result<InstanceSummary>>
    create(input: CreateInstanceInput): Promise<Result<InstanceSummary>>
    /** Starts the instance; resolves with its resulting state (running/error/crashed). */
    start(instanceId: string): Promise<Result<InstanceSummary>>
    /** "Close": stops the view, keeps account + session data. */
    stop(instanceId: string): Promise<Result<InstanceSummary>>
    restart(instanceId: string): Promise<Result<InstanceSummary>>
    /** Deletes the account, its instance and all browser data. Irreversible. */
    remove(instanceId: string): Promise<Result<null>>
    /** Sequenced state events (changed/removed). Returns an unsubscribe function. */
    onChanged(listener: (event: InstanceEvent) => void): () => void
  }
  readonly notices: {
    list(): Promise<Result<readonly Notice[]>>
    /** "allow" adds the origin to the game and redoes the refused navigation; "dismiss" just closes the notice. */
    resolve(input: ResolveNoticeInput): Promise<Result<null>>
    /** Receives the FULL list of pending notices on every change. Returns an unsubscribe function. */
    onChanged(listener: (notices: readonly Notice[]) => void): () => void
  }
}
