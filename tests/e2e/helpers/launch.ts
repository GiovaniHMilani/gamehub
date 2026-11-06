import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export interface LaunchedApp {
  app: ElectronApplication
  userDataDir: string
}

/** Launches the built app (out/) with an isolated, disposable userData dir. */
export async function launchApp(userDataDir?: string): Promise<LaunchedApp> {
  const dir = userDataDir ?? (await mkdtemp(join(tmpdir(), 'gamehub-e2e-')))
  // Editors such as VS Code export ELECTRON_RUN_AS_NODE=1 to child processes,
  // which makes Electron start as plain Node. Never inherit it.
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value
    }
  }
  env['GAMEHUB_USER_DATA_DIR'] = dir

  const app = await electron.launch({
    args: [resolve(import.meta.dirname, '../../../out/main/index.js')],
    env,
  })
  return { app, userDataDir: dir }
}

export async function removeUserData(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
