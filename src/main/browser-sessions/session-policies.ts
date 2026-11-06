import type { Session } from 'electron'

/**
 * Per-session security policy, applied once by SessionManager (ADR-0006).
 * Deny by default: games get only what they demonstrably need.
 */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write'])

export function applySessionPolicies(session: Session): void {
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  session.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSIONS.has(permission))
  session.setDevicePermissionHandler(() => false)
  // Downloads are cancelled in v1 (ADR-0007).
  session.on('will-download', (event) => event.preventDefault())
}
