import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type { OAuthTestSite } from '../../fixtures/oauth-test-site/server'
import { waitReady, type Driver } from './driver'

interface GamePageApi {
  startLogin(url: string): boolean
  tryOpen(url: string, features?: string): boolean
  __loginDone: string | null
}

/** Opens the provider popup from a game page and waits until it is on screen and loaded. */
export async function openOAuthPopup(driver: Driver, site: OAuthTestSite, gamePage: Page): Promise<Page> {
  const before = driver.app.windows()
  const opened = await gamePage.evaluate((url) => (window as unknown as GamePageApi).startLogin(url), site.authorizeUrl())
  expect(opened).toBe(true)
  let popup: Page | undefined
  await expect
    .poll(() => {
      popup = driver.app.windows().find((page) => !before.includes(page) && page.url().startsWith(site.providerUrl))
      return popup !== undefined
    })
    .toBe(true)
  const page = popup as Page
  await waitReady(page)
  return page
}

/** Types the account, clicks sign in, and waits for the popup to close itself and the game to receive the login. */
export async function signInInPopup(popup: Page, gamePage: Page, user: string): Promise<void> {
  await popup.getByLabel('Account').fill(user)
  const closed = popup.waitForEvent('close')
  await popup.click('#signin')
  await closed
  await gamePage.waitForFunction((u) => (window as unknown as GamePageApi).__loginDone === u, user)
}

export interface ProviderState {
  cookie: string | null
  serverCookie: string | null
  localStorage: string | null
  indexedDB: string | null
}

export function providerState(popup: Page): Promise<ProviderState> {
  return popup.evaluate(() => (window as unknown as { providerSnapshot(): Promise<ProviderState> }).providerSnapshot())
}

export const EMPTY_PROVIDER: ProviderState = { cookie: null, serverCookie: null, localStorage: null, indexedDB: null }

/** Main-side view of the popup: which game views share its session. Identified by each view's profile marker. */
export interface PopupSessionReport {
  popupStoragePath: string | null
  views: Array<{ marker: string | null; storagePath: string | null; sameSessionAsPopup: boolean }>
}

export function popupSessionReport(app: ElectronApplication, site: OAuthTestSite): Promise<PopupSessionReport | null> {
  return app.evaluate(
    async ({ webContents }, { providerUrl, gameUrl }) => {
      const all = webContents.getAllWebContents()
      const popup = all.find((w) => w.getURL().startsWith(providerUrl))
      if (popup === undefined) return null
      const views: PopupSessionReport['views'] = []
      for (const w of all) {
        if (w === popup || !w.getURL().startsWith(gameUrl)) continue
        views.push({
          marker: (await w.executeJavaScript("localStorage.getItem('marker')")) as string | null,
          storagePath: w.session.storagePath ?? null,
          sameSessionAsPopup: w.session === popup.session,
        })
      }
      return { popupStoragePath: popup.session.storagePath ?? null, views }
    },
    { providerUrl: site.providerUrl, gameUrl: site.gameUrl },
  )
}

/** Storage directory of the session of the game view with this profile marker. */
export async function storagePathOf(app: ElectronApplication, site: OAuthTestSite, marker: string): Promise<string> {
  const path = await app.evaluate(
    async ({ webContents }, { gameUrl, wanted }) => {
      for (const w of webContents.getAllWebContents()) {
        if (!w.getURL().startsWith(gameUrl)) continue
        if ((await w.executeJavaScript("localStorage.getItem('marker')")) === wanted) return w.session.storagePath ?? null
      }
      return null
    },
    { gameUrl: site.gameUrl, wanted: marker },
  )
  expect(path).not.toBeNull()
  return path as string
}

/** Simulates the user closing the provider popup window. Returns how many windows were closed. */
export function closeProviderPopups(app: ElectronApplication, site: OAuthTestSite): Promise<number> {
  return app.evaluate(({ BrowserWindow }, providerUrl) => {
    const targets = BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().startsWith(providerUrl))
    targets.forEach((w) => w.close())
    return targets.length
  }, site.providerUrl)
}

export const tryOpen = (page: Page, url: string, features?: string): Promise<boolean> =>
  page.evaluate(([u, f]) => (window as unknown as GamePageApi).tryOpen(u as string, f), [url, features] as const)

