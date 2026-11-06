import type { GameHubApi } from '@shared/ipc/api'
import { InstanceSyncEngine } from '@shared/ipc/event-sync'
import { useDomainStore } from './domain-store'
import { useNoticeStore } from './notice-store'
import { useUiStore } from './ui-store'

/**
 * Connects the stores to Main: instances through the existing snapshot + sequenced events
 * (ADR-0015), games and notices through plain fetches. No polling anywhere: everything the
 * UI shows after the first load arrives as an event or as the result of the user's own action.
 */
export type SyncApi = Pick<GameHubApi, 'games' | 'notices'> & {
  readonly instances: Pick<GameHubApi['instances'], 'snapshot' | 'onChanged'>
}

export interface SyncHandle {
  stop(): void
  /** "Try again" of the error screen: refetches everything. */
  retry(): void
}

export async function refreshGames(api: Pick<GameHubApi, 'games'>): Promise<void> {
  let result: Awaited<ReturnType<GameHubApi['games']['list']>>
  try {
    result = await api.games.list()
  } catch {
    result = { ok: false, error: { code: 'INTERNAL', message: 'list failed' } }
  }
  if (result.ok) {
    useDomainStore.getState().setGames(result.data)
    return
  }
  const domain = useDomainStore.getState()
  domain.failLoading()
  if (domain.status === 'ready') useUiStore.getState().pushToast('error', "Couldn't refresh the game list.")
}

export function startSync(api: SyncApi): SyncHandle {
  const domain = useDomainStore.getState()
  domain.reset()

  let refreshing = false
  const refreshOnce = (): void => {
    if (refreshing) return
    refreshing = true
    void refreshGames(api).finally(() => {
      refreshing = false
    })
  }

  const engine = new InstanceSyncEngine({
    snapshot: () => api.instances.snapshot(),
    subscribe: (listener) => api.instances.onChanged(listener),
    onChange: (view) => {
      useDomainStore.getState().applySync(view)
      // An instance of a game we have not heard of (created moments ago): fetch the games again.
      const state = useDomainStore.getState()
      if (state.gamesLoaded && view.instances.some((instance) => state.gameById[instance.gameId] === undefined)) refreshOnce()
    },
    onError: () => useDomainStore.getState().failLoading(),
  })

  // Notices: subscribe first, then fetch; a pushed list is never overwritten by an older fetch.
  let pushed = false
  const offNotices = api.notices.onChanged((list) => {
    pushed = true
    useNoticeStore.getState().setNotices(list)
  })
  void api.notices.list().then(
    (result) => {
      if (!pushed && result.ok) useNoticeStore.getState().setNotices(result.data)
    },
    () => undefined,
  )

  engine.start()
  refreshOnce()

  return {
    stop: () => {
      engine.stop()
      offNotices()
    },
    retry: () => {
      useDomainStore.setState({ status: 'loading' })
      engine.retry()
      refreshOnce()
    },
  }
}
