import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

/** Locators and flows for the real shell UI. Everything goes through what a user can see and click. */

export const topbar = (shell: Page): Locator => shell.getByRole('banner')
export const section = (shell: Page, gameName: string): Locator => shell.getByTestId(`game-${gameName}`)
export const row = (shell: Page, label: string): Locator => shell.getByTestId(`instance-${label}`)
export const dialog = (shell: Page): Locator => shell.getByRole('dialog')
export const stage = (shell: Page): Locator => shell.getByTestId('stage')
export const statusOf = (shell: Page, label: string): Locator => row(shell, label).locator('[data-status]')
export const toast = (shell: Page): Locator => shell.getByRole('status')

export async function goTo(shell: Page, screen: 'Library' | 'Play' | 'Settings'): Promise<void> {
  await shell.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: new RegExp(`^${screen}`) }).click()
}

export async function addGame(shell: Page, input: { url: string; name?: string; description?: string }): Promise<void> {
  await topbar(shell).getByRole('button', { name: 'Add game' }).click()
  const dlg = dialog(shell)
  await dlg.getByLabel('Address').fill(input.url)
  if (input.name !== undefined) await dlg.getByLabel('Name').fill(input.name)
  if (input.description !== undefined) await dlg.getByLabel('Description').fill(input.description)
  await dlg.getByRole('button', { name: 'Add game' }).click()
  await expect(dlg).toHaveCount(0)
}

export async function addAccount(shell: Page, gameName: string, label: string, options: { start?: boolean } = {}): Promise<void> {
  await section(shell, gameName).getByRole('button', { name: 'Add account' }).first().click()
  const dlg = dialog(shell)
  await dlg.getByLabel('Account name').fill(label)
  await dlg.getByRole('button', { name: options.start === true ? 'Add and start' : 'Add account', exact: true }).click()
  await expect(dlg).toHaveCount(0)
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewReport {
  marker: string | null
  bounds: Box
  visible: boolean
  focused: boolean
}

/**
 * What MAIN actually did with every game view: where it is, whether it is shown, whether it has keyboard
 * focus. Each view is identified by the profile marker its page stored (see the session test site).
 */
export function viewReports(app: ElectronApplication): Promise<ViewReport[]> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('app://gamehub'))
    if (shell === undefined) return []
    const views = shell.contentView.children as unknown as Array<{
      webContents: Electron.WebContents
      getBounds(): Box
      getVisible(): boolean
    }>
    return Promise.all(
      views.map(async (view) => ({
        marker: (await view.webContents.executeJavaScript("localStorage.getItem('marker')").catch(() => null)) as string | null,
        bounds: view.getBounds(),
        visible: view.getVisible(),
        focused: view.webContents.isFocused(),
      })),
    )
  })
}

export const visibleViews = async (app: ElectronApplication): Promise<ViewReport[]> => (await viewReports(app)).filter((v) => v.visible)

export async function stageBox(shell: Page): Promise<Box> {
  const box = await stage(shell).boundingBox()
  if (box === null) throw new Error('The stage is not on screen')
  return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
}

/** Within one pixel: the DOM reports fractions, Main applies whole pixels. */
export function sameBox(a: Box, b: Box, tolerance = 1): boolean {
  return (['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(a[key] - b[key]) <= tolerance)
}

export function resizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
  return app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().startsWith('app://gamehub'))
      ?.setContentSize(size.width, size.height)
  }, { width, height })
}
