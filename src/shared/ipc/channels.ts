/**
 * The complete, fixed list of IPC channels (ADR-0005).
 * Plain constants only: the preload imports this file, so it must stay tiny.
 */
export const IPC = {
  gamesCreate: 'games:create',
  gamesList: 'games:list',
  instancesList: 'instances:list',
  instancesGet: 'instances:get',
  instancesCreate: 'instances:create',
  instancesStart: 'instances:start',
  instancesStop: 'instances:stop',
  instancesRestart: 'instances:restart',
  instancesRemove: 'instances:remove',
} as const

export const EVENTS = {
  instancesChanged: 'instances:changed',
} as const
