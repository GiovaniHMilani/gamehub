import { expect, test } from '@playwright/test'
import { launchApp, removeUserData } from './helpers/launch'

test('app launches the shell window with an isolated userData dir', async () => {
  const { app, userDataDir } = await launchApp()
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('app-title')).toHaveText('GameHub')

    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    expect(userData).toBe(userDataDir)
  } finally {
    await app.close()
    await removeUserData(userDataDir)
  }
})

test('production shell CSP forbids inline scripts', async () => {
  const { app, userDataDir } = await launchApp()
  try {
    const window = await app.firstWindow()
    await window.getByTestId('app-root').waitFor()
    const csp = await window.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
    )
    const scriptSrc = csp.split(';').map((d: string) => d.trim()).find((d: string) => d.startsWith('script-src'))
    expect(scriptSrc).toBe("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
  } finally {
    await app.close()
    await removeUserData(userDataDir)
  }
})

test('shell renderer has no Node.js access', async () => {
  const { app, userDataDir } = await launchApp()
  try {
    const window = await app.firstWindow()
    await window.getByTestId('app-root').waitFor()
    const exposure = await window.evaluate(() => ({
      require: typeof (globalThis as Record<string, unknown>)['require'],
      process: typeof (globalThis as Record<string, unknown>)['process'],
      gamehubKeys: Object.keys((globalThis as unknown as { gamehub: object }).gamehub),
    }))
    expect(exposure).toEqual({ require: 'undefined', process: 'undefined', gamehubKeys: ['games', 'instances'] })
  } finally {
    await app.close()
    await removeUserData(userDataDir)
  }
})
