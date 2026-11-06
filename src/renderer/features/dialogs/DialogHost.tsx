import { useUiStore } from '../../stores/ui-store'
import { AddAccountDialog } from './AddAccountDialog'
import { AddGameDialog } from './AddGameDialog'
import { ConfirmRemoveDialog } from './ConfirmRemoveDialog'
import { ConfirmRemoveGameDialog } from './ConfirmRemoveGameDialog'
import { EditGameDialog } from './EditGameDialog'
import { OriginsDialog } from './OriginsDialog'

/** Renders the one open dialog. Its absence is what un-pauses the Play viewport. */
export function DialogHost() {
  const dialog = useUiStore((s) => s.dialog)
  if (dialog === null) return null

  switch (dialog.kind) {
    case 'addGame':
      return <AddGameDialog />
    case 'addAccount':
      return <AddAccountDialog gameId={dialog.gameId} />
    case 'confirmRemove':
      return <ConfirmRemoveDialog instanceId={dialog.instanceId} />
    case 'editGame':
      return <EditGameDialog gameId={dialog.gameId} />
    case 'confirmRemoveGame':
      return <ConfirmRemoveGameDialog gameId={dialog.gameId} />
    case 'origins':
      return <OriginsDialog gameId={dialog.gameId} />
  }
}
