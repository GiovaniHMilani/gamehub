import type { ErrorCode } from '@shared/ipc/result'

/** Domain failure with a code that is safe to return across IPC. */
export class DomainError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
