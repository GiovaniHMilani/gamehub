import type { ErrorCode } from '@shared/ipc/result'

/**
 * What the user reads when an operation fails. Short, in plain words, and never the raw
 * message, a code or a stack: those stay in the log.
 */
export type Operation = 'start' | 'stop' | 'restart' | 'remove' | 'create' | 'open' | 'save' | 'load'

const VERB: Readonly<Record<Operation, string>> = {
  start: "start it",
  stop: 'stop it',
  restart: 'restart it',
  remove: 'remove it',
  create: 'create it',
  open: 'open it',
  save: 'save the change',
  load: 'load your library',
}

export function describeFailure(operation: Operation, code: ErrorCode): string {
  const verb = VERB[operation]
  switch (code) {
    case 'NOT_FOUND':
      return 'That item no longer exists. The list has been refreshed.'
    case 'INVALID_STATE':
      return `Couldn't ${verb} right now. Wait for the current step to finish and try again.`
    case 'INVALID_ARGUMENT':
      return `Couldn't ${verb}: please check what you entered.`
    case 'INTERNAL':
      return `Couldn't ${verb}. Something went wrong inside GameHub.`
  }
}

/** Describes why an instance is in the `error` state, from the load error code stored by Main. */
export function describeInstanceError(errorCode: string | null): string {
  switch (errorCode) {
    case 'ERR_CONNECTION_REFUSED':
      return 'The game refused the connection.'
    case 'ERR_NAME_NOT_RESOLVED':
      return "Couldn't find the game's address."
    case 'ERR_INTERNET_DISCONNECTED':
    case 'ERR_NETWORK_CHANGED':
      return "You're offline."
    case 'ERR_CONNECTION_TIMED_OUT':
    case 'ERR_TIMED_OUT':
      return 'The game took too long to respond.'
    case 'ERR_CERT_AUTHORITY_INVALID':
    case 'ERR_CERT_DATE_INVALID':
    case 'ERR_CERT_COMMON_NAME_INVALID':
      return "The game's security certificate is not valid."
    case 'START_FAILED':
      return "The account's browser session could not be started."
    case null:
      return 'It could not be started.'
    default:
      return "The game didn't load."
  }
}
