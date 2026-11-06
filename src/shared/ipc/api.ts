/**
 * The typed surface exposed to the renderer as `window.gamehub`.
 * Grows one explicit capability at a time (ADR-0005).
 */
export type GameHubApi = Readonly<Record<never, never>>
