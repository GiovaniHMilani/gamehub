import { create } from 'zustand'
import type { InstanceAction } from '../model/instance-actions'
import type { PlayMode } from '../model/stage-layout'

/**
 * UI-only state: what the user is looking at. Nothing here describes an instance's
 * lifecycle; that is read from the domain store, which mirrors Main.
 */
export type Screen = 'library' | 'play' | 'settings'
export type LibraryFilter = 'all' | 'running' | 'problems'

export type DialogState =
  | { readonly kind: 'addGame' }
  | { readonly kind: 'addAccount'; readonly gameId: string }
  | { readonly kind: 'confirmRemove'; readonly instanceId: string }
  | { readonly kind: 'confirmRemoveGame'; readonly gameId: string }
  | { readonly kind: 'editGame'; readonly gameId: string }
  | { readonly kind: 'origins'; readonly gameId: string }

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  readonly id: number
  readonly tone: ToastTone
  readonly text: string
}

const MAX_TOASTS = 3

export interface UiState {
  readonly screen: Screen
  readonly playMode: PlayMode
  /** Which instance the Play screen was asked to show. The effective one is derived (see model). */
  readonly focusedInstanceId: string | null
  readonly dialog: DialogState | null
  readonly search: string
  readonly filter: LibraryFilter
  readonly toasts: readonly Toast[]
  /** In-flight instance action, to ignore a double click of the SAME action. Others stay available. */
  readonly pending: Readonly<Record<string, InstanceAction>>

  navigate(screen: Screen): void
  openInstance(instanceId: string): void
  setPlayMode(mode: PlayMode): void
  openDialog(dialog: DialogState): void
  closeDialog(): void
  setSearch(search: string): void
  setFilter(filter: LibraryFilter): void
  pushToast(tone: ToastTone, text: string): void
  dismissToast(id: number): void
  setPending(instanceId: string, action: InstanceAction | null): void
  reset(): void
}

let nextToastId = 1

const INITIAL = {
  screen: 'library' as Screen,
  playMode: 'focus' as PlayMode,
  focusedInstanceId: null as string | null,
  dialog: null as DialogState | null,
  search: '',
  filter: 'all' as LibraryFilter,
  toasts: [] as readonly Toast[],
  pending: {} as Readonly<Record<string, InstanceAction>>,
}

export const useUiStore = create<UiState>()((set) => ({
  ...INITIAL,

  navigate: (screen) => set({ screen }),
  openInstance: (instanceId) => set({ screen: 'play', focusedInstanceId: instanceId, playMode: 'focus' }),
  setPlayMode: (playMode) => set({ playMode }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setSearch: (search) => set({ search }),
  setFilter: (filter) => set({ filter }),

  pushToast: (tone, text) =>
    set((state) => ({
      toasts: [...state.toasts, { id: nextToastId++, tone, text }].slice(-MAX_TOASTS),
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  setPending: (instanceId, action) =>
    set((state) => {
      const others = Object.fromEntries(Object.entries(state.pending).filter(([id]) => id !== instanceId))
      return { pending: action === null ? others : { ...others, [instanceId]: action } }
    }),

  reset: () => set({ ...INITIAL }),
}))
