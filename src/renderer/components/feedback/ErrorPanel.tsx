import { Button } from '../common/Button'
import { StatePanel } from '../common/StatePanel'

/** The library could not be loaded. Plain words, one action, no technical detail. */
export function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <StatePanel title="Couldn't load your library">
      <p>GameHub couldn't read your games and accounts. Your data is not affected.</p>
      <Button tone="primary" onClick={onRetry}>Try again</Button>
    </StatePanel>
  )
}
