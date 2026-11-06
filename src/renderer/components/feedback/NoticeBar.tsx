import { api } from '../../api'
import { resolveNotice } from '../../stores/actions'
import { useNoticeStore } from '../../stores/notice-store'
import { Button } from '../common/Button'

/**
 * "This game wants to reach another site: allow it?" (ADR-0016). Main decides what is shown: only
 * the account, the game and the destination ORIGIN, never the full address.
 */
export function NoticeBar() {
  const notices = useNoticeStore((s) => s.notices)
  const notice = notices[0]
  if (notice === undefined) return null

  return (
    <div className="notice-bar" role="group" aria-label="Blocked request" data-testid="notice">
      <p className="notice-text">
        “{notice.instanceLabel}” wants to {notice.kind === 'popup' ? 'open a window on' : 'go to'}{' '}
        <span className="notice-origin" data-testid="notice-origin">{notice.origin}</span>. Allow it for all accounts of {notice.gameName}?
      </p>
      <div className="notice-actions">
        <Button tone="primary" onClick={() => void resolveNotice(api(), notice, 'allow')}>Allow</Button>
        <Button onClick={() => void resolveNotice(api(), notice, 'dismiss')}>Dismiss</Button>
        {notices.length > 1 ? <span>{notices.length - 1} more waiting</span> : null}
      </div>
    </div>
  )
}
