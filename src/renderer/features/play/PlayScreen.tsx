import { useMemo } from 'react'
import { Button } from '../../components/common/Button'
import { useGameStyle } from '../../components/common/Monogram'
import { StatePanel } from '../../components/common/StatePanel'
import { NO_IDS, useDomainStore } from '../../stores/domain-store'
import { effectiveFocusedId } from '../../stores/selectors'
import { useUiStore } from '../../stores/ui-store'
import { StageViewport } from './StageViewport'

/**
 * Where running accounts are used. The instance shown is DERIVED (the requested one if it still
 * runs, else the first running one), so an account that stops or is removed never leaves this
 * screen pointing at nothing.
 */
export function PlayScreen() {
  const runningIds = useDomainStore((s) => s.runningIds)
  const requested = useUiStore((s) => s.focusedInstanceId)
  const mode = useUiStore((s) => s.playMode)
  const navigate = useUiStore((s) => s.navigate)
  const focusId = effectiveFocusedId(runningIds, requested)
  const gameId = useDomainStore((s) => s.instancesById[focusId ?? '']?.gameId ?? '')
  const style = useGameStyle(gameId)

  const shownIds = useMemo(() => (mode === 'focus' ? (focusId === null ? NO_IDS : [focusId]) : runningIds), [mode, focusId, runningIds])

  if (focusId === null) {
    return (
      <StatePanel title="Nothing is running">
        <p>Start an account from the library and it will show up here.</p>
        <Button tone="play" size="large" onClick={() => navigate('library')}>Go to the library</Button>
      </StatePanel>
    )
  }

  return (
    <section className="play" style={style} aria-label="Running accounts">
      <StageViewport instanceIds={shownIds} mode={mode} focusId={focusId} />
    </section>
  )
}
