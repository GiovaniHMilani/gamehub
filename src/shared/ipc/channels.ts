/**
 * The complete, fixed list of IPC channels (ADR-0005).
 * Plain constants only: the preload imports this file, so it must stay tiny.
 */
export const IPC = {
  noticesList: 'notices:list',
  noticesResolve: 'notices:resolve',
  gamesCreate: 'games:create',
  gamesList: 'games:list',
  gamesSetAllowedOrigins: 'games:setAllowedOrigins',
  instancesList: 'instances:list',
  instancesSnapshot: 'instances:snapshot',
  instancesGet: 'instances:get',
  instancesCreate: 'instances:create',
  instancesStart: 'instances:start',
  instancesStop: 'instances:stop',
  instancesRestart: 'instances:restart',
  instancesRemove: 'instances:remove',
} as const

export const EVENTS = {
  instancesEvent: 'instances:event',
  noticesChanged: 'notices:changed',
} as const
