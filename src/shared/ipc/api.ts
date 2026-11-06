import type {
  CreateGameInput,
  CreateInstanceInput,
  GameSummary,
  InstanceSummary,
  Notice,
  ResolveNoticeInput,
  SetAllowedOriginsInput,
  UpdateGameInput,
} from '../domain/types'
import type { StageSlot } from '../domain/stage-layout'
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
    /**
     * Replaces a game's name, address and description. Accounts keep their data, but cookies and storage
     * belong to a site, so a different address may sign accounts out; running accounts keep their current
     * page until they are restarted.
     */
    update(input: UpdateGameInput): Promise<Result<GameSummary>>
    /**
     * Removes a game AND all of its accounts: each one is stopped and its login and browser
     * data are deleted. Irreversible. Accounts are removed one by one, so if one fails the game
     * stays with the accounts that were not removed yet.
     */
    remove(gameId: string): Promise<Result<null>>
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
    /** Gives keyboard focus to a RUNNING instance's view. INVALID_STATE if it is not running. */
    focus(instanceId: string): Promise<Result<InstanceSummary>>
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
  readonly stage: {
    /**
     * Says where each running instance's view should be shown. Fire-and-forget: Main
     * validates and clamps it, and hides every view that is not listed.
     */
    setLayout(slots: readonly StageSlot[]): void
  }
}
