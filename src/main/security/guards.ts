import { app } from 'electron'
import type { Logger } from '../logging/logger'

/**
 * Deny-by-default guards applied to EVERY webContents the app ever creates
 * (ADR-0006), including ones that escape the specific policies:
 *  - no new windows (OAuth popups are added deliberately in the navigation phase);
 *  - no <webview> attachment.
 * Per-view navigation rules are added by WindowManager on top of this floor.
 */
export function installGlobalGuards(log: Logger): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => {
      log.warn('security.window_open_denied', { type: contents.getType() })
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      log.warn('security.webview_blocked')
    })
  })
}
