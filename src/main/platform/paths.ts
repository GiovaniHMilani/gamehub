import { app } from 'electron'
import { isAbsolute, join } from 'node:path'

/**
 * Select the userData directory before `app.ready` (ADR-0012).
 *
 * - Tests: GAMEHUB_USER_DATA_DIR (absolute path, usually a temp dir).
 * - Development: a sibling `GameHub-dev` directory so dev runs never touch
 *   real account sessions.
 * - Production: Electron's default (derived from productName "GameHub").
 */
export function configureUserDataPath(): void {
  const override = process.env['GAMEHUB_USER_DATA_DIR']
  if (override !== undefined && override !== '') {
    if (!isAbsolute(override)) {
      throw new Error('GAMEHUB_USER_DATA_DIR must be an absolute path')
    }
    app.setPath('userData', override)
    return
  }

  if (!app.isPackaged) {
    app.setPath('userData', join(app.getPath('appData'), 'GameHub-dev'))
  }
}
