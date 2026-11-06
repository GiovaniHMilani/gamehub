import { memo } from 'react'
import { Portrait } from '../../components/common/Monogram'
import { describeInstanceError } from '../../model/messages'
import { statusLabel } from '../../model/instance-actions'
import { useDomainStore } from '../../stores/domain-store'
import { InstanceActions } from './InstanceActions'

/**
 * One account of a game, as a member of the party: portrait ringed by its state, its name, the
 * state in words, and what it can do. It subscribes to exactly one instance, so an event about
 * another account never re-renders it.
 */
export const AccountRow = memo(function AccountRow({ instanceId }: { instanceId: string }) {
  const instance = useDomainStore((s) => s.instancesById[instanceId])
  if (instance === undefined) return null

  return (
    <li className="session" data-testid={`instance-${instance.label}`} data-state={instance.status}>
      <Portrait gameId={instance.gameId} label={instance.label} status={instance.status} />
      <div className="session-text">
        <p className="session-label" title={instance.label}>{instance.label}</p>
        <p className="session-state">
          <span className="session-status" data-status={instance.status} aria-live="polite">
            {statusLabel(instance.status)}
          </span>
          {instance.status === 'error' ? <span className="session-detail"> {describeInstanceError(instance.errorCode)}</span> : null}
          {instance.status === 'crashed' ? <span className="session-detail"> The game stopped unexpectedly.</span> : null}
        </p>
      </div>
      <InstanceActions instanceId={instance.id} label={instance.label} status={instance.status} />
    </li>
  )
})
