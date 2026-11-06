import { create } from 'zustand'
import type { Notice } from '@shared/domain/types'

/**
 * Pending "blocked request" notices (ADR-0016). Main sends the FULL list on every change,
 * so the latest list is always the truth and no sequencing is needed.
 */
interface NoticeState {
  readonly notices: readonly Notice[]
  setNotices(notices: readonly Notice[]): void
}

const NONE: readonly Notice[] = Object.freeze([])

export const useNoticeStore = create<NoticeState>()((set) => ({
  notices: NONE,
  setNotices: (notices) => set({ notices: notices.length === 0 ? NONE : notices }),
}))
