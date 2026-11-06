import type { InstanceStatus } from '@shared/domain/types'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { Icon } from '../../components/common/Icon'
import { Menu, type MenuItem } from '../../components/common/Menu'
import { actionsFor } from '../../model/instance-actions'
import { performInstanceAction } from '../../stores/actions'
import { useUiStore } from '../../stores/ui-store'

/**
 * What an account offers in its current state (see `actionsFor`), without a row of buttons:
 * the main verb as a button, Stop as a quiet icon beside it, and everything else (Restart,
 * Remove) in the menu. While an action is in flight its own control is disabled; the others
 * (Cancel during a start) stay available.
 */
export function InstanceActions({ instanceId, label, status }: { instanceId: string; label: string; status: InstanceStatus }) {
  const pendingAction = useUiStore((s) => s.pending[instanceId])
  const specs = actionsFor(status)
  const main = specs[0]
  const stop = main !== undefined && main.action !== 'stop' ? specs.find((spec) => spec.action === 'stop') : undefined
  const rest = specs.filter((spec) => spec !== main && spec !== stop)
  const run = (action: (typeof specs)[number]['action']): void => void performInstanceAction(api(), instanceId, action)

  const items: MenuItem[] = rest.map((spec) => ({
    label: spec.label,
    ...(spec.action === 'restart' ? { icon: 'restart' as const } : spec.action === 'remove' ? { icon: 'trash' as const } : {}),
    ...(spec.tone === 'danger' ? { tone: 'danger' as const } : {}),
    onSelect: () => run(spec.action),
  }))

  return (
    <div className="session-actions">
      {main === undefined ? null : (
        <Button tone={main.tone === 'primary' ? 'primary' : 'neutral'} size="small" disabled={pendingAction === main.action} onClick={() => run(main.action)}>
          {main.action === 'start' || main.action === 'restart' ? <Icon name={main.action === 'start' ? 'play' : 'restart'} size={13} /> : null}
          {main.label}
        </Button>
      )}
      {stop === undefined ? null : (
        <button type="button" className="icon-btn" aria-label="Stop" title="Stop" disabled={pendingAction === 'stop'} onClick={() => run('stop')}>
          <Icon name="stop" size={15} />
        </button>
      )}
      {items.length > 0 ? <Menu label={`More for ${label}`} items={items} /> : null}
    </div>
  )
}
