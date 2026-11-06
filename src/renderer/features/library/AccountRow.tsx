import { memo } from 'react'
import { StatusLamp } from '../../components/common/StatusLamp'
import { describeInstanceError } from '../../model/messages'
import { statusLabel } from '../../model/instance-actions'
import { useDomainStore } from '../../stores/domain-store'
import { InstanceActions } from './InstanceActions'

/**
 * One account of a game: a line, not a card. It subscribes to exactly one instance, so an event
 * about another account never re-renders it.
 */
export const AccountRow = memo(function AccountRow({ instanceId }: { instanceId: string }) {
  const instance = useDomainStore((s) => s.instancesById[instanceId])
  if (instance === undefined) return null

  return (
    <li className="account" data-testid={`instance-${instance.label}`} data-state={instance.status}>
      <StatusLamp state={instance.status} />
      <div className="account-text">
        <p className="account-label" title={instance.label}>{instance.label}</p>
        <p>
          <span className="account-status" data-status={instance.status} aria-live="polite">
            {statusLabel(instance.status)}
          </span>
          {instance.status === 'error' ? <span className="account-detail"> {describeInstanceError(instance.errorCode)}</span> : null}
          {instance.status === 'crashed' ? <span className="account-detail"> The game stopped unexpectedly.</span> : null}
        </p>
      </div>
      <InstanceActions instanceId={instance.id} status={instance.status} />
    </li>
  )
})
