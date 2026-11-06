import type { InstanceStatus } from '@shared/domain/types'
import { api } from '../../api'
import { Button } from '../../components/common/Button'
import { actionsFor } from '../../model/instance-actions'
import { performInstanceAction } from '../../stores/actions'
import { useUiStore } from '../../stores/ui-store'

/**
 * The buttons that make sense for an instance in its current state (see `actionsFor`).
 * While one action is in flight its own button is disabled; the others (Cancel during a start)
 * stay available.
 */
export function InstanceActions({ instanceId, status }: { instanceId: string; status: InstanceStatus }) {
  const pendingAction = useUiStore((s) => s.pending[instanceId])

  return (
    <div className="account-actions">
      {actionsFor(status).map((spec) => (
        <Button
          key={spec.label}
          tone={spec.tone}
          size="small"
          disabled={pendingAction === spec.action}
          onClick={() => void performInstanceAction(api(), instanceId, spec.action)}
        >
          {spec.label}
        </Button>
      ))}
    </div>
  )
}
