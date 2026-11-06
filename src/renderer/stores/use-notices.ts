import { useEffect, useState } from 'react'
import type { Notice } from '@shared/domain/types'

/**
 * Pending "blocked request" notices from Main (ADR-0016). Main sends the FULL list on
 * every change, so the latest message is always the truth: no sequencing is needed, only
 * care that the initial fetch never overwrites a newer pushed list.
 */
export function useNotices(): readonly Notice[] {
  const [notices, setNotices] = useState<readonly Notice[]>([])

  useEffect(() => {
    let pushed = false
    const off = window.gamehub.notices.onChanged((list) => {
      pushed = true
      setNotices(list)
    })
    void window.gamehub.notices.list().then((result) => {
      if (!pushed && result.ok) setNotices(result.data)
    })
    return off
  }, [])

  return notices
}
