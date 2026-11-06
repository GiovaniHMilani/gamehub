/** Deterministic IPC response shape (ADR-0005). No stacks or paths cross it. */
export type ErrorCode = 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'INVALID_STATE' | 'INTERNAL'

export interface IpcError {
  readonly code: ErrorCode
  readonly message: string
}

export type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: IpcError }
