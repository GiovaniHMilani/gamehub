import type {
  CreateGameInput,
  CreateInstanceInput,
  GameSummary,
  InstanceSummary,
} from '../domain/types'
import type { Result } from './result'

/**
 * The typed surface exposed to the renderer as `window.gamehub` (ADR-0005).
 * Grows one explicit capability at a time. No generic execute/invoke.
 */
export interface GameHubApi {
  readonly games: {
    create(input: CreateGameInput): Promise<Result<GameSummary>>
    list(): Promise<Result<readonly GameSummary[]>>
  }
  readonly instances: {
    list(): Promise<Result<readonly InstanceSummary[]>>
    get(instanceId: string): Promise<Result<InstanceSummary>>
    create(input: CreateInstanceInput): Promise<Result<InstanceSummary>>
    /** Starts the instance; resolves with its resulting state (running/error/crashed). */
    start(instanceId: string): Promise<Result<InstanceSummary>>
    /** "Close": stops the view, keeps account + session data. */
    stop(instanceId: string): Promise<Result<InstanceSummary>>
    restart(instanceId: string): Promise<Result<InstanceSummary>>
    /** Deletes the account, its instance and all browser data. Irreversible. */
    remove(instanceId: string): Promise<Result<null>>
    /** Subscribe to state changes. Returns an unsubscribe function. */
    onChanged(listener: (summary: InstanceSummary) => void): () => void
  }
}
