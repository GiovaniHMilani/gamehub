import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GameSummary, InstanceStatus, InstanceSummary } from '../../../src/shared/domain/types'
import type { Result } from '../../../src/shared/ipc/result'
import { launchApp } from './launch'

/** What the fixture page reports from the browser's real storage. */
export interface Snap {
  marker: string | null
  cookie: string | null
  sessionCookie: string | null
  serverCookie: string | null
  localStorage: string | null
  indexedDB: string | null
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`IPC failed: ${result.error.code}: ${result.error.message}`)
  return result.data
}

/** Drives GameHub exactly as the renderer does: window.gamehub -> preload -> IPC -> Main. */
export class Driver {
  private constructor(
    readonly app: ElectronApplication,
    readonly shell: Page,
    readonly userDataDir: string,
  ) {}

  static async launch(userDataDir?: string): Promise<Driver> {
    const launched = await launchApp(userDataDir)
    const shell = await launched.app.firstWindow()
    await shell.getByTestId('app-root').waitFor()
    return new Driver(launched.app, shell, launched.userDataDir)
  }

  createGame(name: string, startUrl: string, allowedOrigins?: readonly string[]): Promise<GameSummary> {
    const input = allowedOrigins === undefined ? { name, startUrl } : { name, startUrl, allowedOrigins: [...allowedOrigins] }
    return this.shell.evaluate((i) => window.gamehub.games.create(i), input).then(unwrap)
  }

  createInstance(gameId: string, label: string): Promise<InstanceSummary> {
    return this.shell.evaluate((input) => window.gamehub.instances.create(input), { gameId, label }).then(unwrap)
  }

  start(id: string): Promise<InstanceSummary> {
    return this.shell.evaluate((i) => window.gamehub.instances.start(i), id).then(unwrap)
  }

  stop(id: string): Promise<InstanceSummary> {
    return this.shell.evaluate((i) => window.gamehub.instances.stop(i), id).then(unwrap)
  }

  restart(id: string): Promise<InstanceSummary> {
    return this.shell.evaluate((i) => window.gamehub.instances.restart(i), id).then(unwrap)
  }

  remove(id: string): Promise<null> {
    return this.shell.evaluate((i) => window.gamehub.instances.remove(i), id).then(unwrap)
  }

  list(): Promise<readonly InstanceSummary[]> {
    return this.shell.evaluate(() => window.gamehub.instances.list()).then(unwrap)
  }

  /** Raw results, for asserting on failures. */
  raw = {
    start: (instanceId: unknown): Promise<Result<InstanceSummary>> =>
      this.shell.evaluate((i) => (window.gamehub.instances.start as (x: unknown) => Promise<Result<InstanceSummary>>)(i), instanceId),
    create: (input: unknown): Promise<Result<InstanceSummary>> =>
      this.shell.evaluate((i) => (window.gamehub.instances.create as (x: unknown) => Promise<Result<InstanceSummary>>)(i), input),
  }

  gamePages(siteUrl: string): Page[] {
    return this.app.windows().filter((page) => page.url().startsWith(siteUrl))
  }

  /** Starts an instance and returns the page of the view it just created. */
  async startAndGetPage(id: string, siteUrl: string, known: readonly Page[]): Promise<Page> {
    const summary = await this.start(id)
    expect(summary.status).toBe('running')
    let found: Page | undefined
    await expect
      .poll(() => {
        found = this.gamePages(siteUrl).find((page) => !known.includes(page))
        return found !== undefined
      })
      .toBe(true)
    const page = found as Page
    await page.waitForSelector('body[data-ready="true"]')
    return page
  }

  async waitForStatuses(expected: Record<string, InstanceStatus>): Promise<void> {
    await expect
      .poll(async () => Object.fromEntries((await this.list()).map((i) => [i.label, i.status])))
      .toEqual(expected)
  }

  /** Live webContents count in Main (the shell is always 1). */
  webContentsCount(): Promise<number> {
    return this.app.evaluate(({ webContents }) => webContents.getAllWebContents().length)
  }

  async readLog(): Promise<string> {
    return readFile(join(this.userDataDir, 'logs', 'gamehub.log'), 'utf8').catch(() => '')
  }

  async logRecords(): Promise<Array<Record<string, unknown>>> {
    return (await this.readLog())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  async logEvents(): Promise<string[]> {
    return (await this.logRecords()).map((record) => String(record['event']))
  }

  close(): Promise<void> {
    return this.app.close()
  }
}

export function snapshot(page: Page): Promise<Snap> {
  return page.evaluate(() => (window as unknown as { snapshot(): Promise<Snap> }).snapshot())
}

export function setIdentity(page: Page, value: string): Promise<Snap> {
  return page.evaluate((v) => (window as unknown as { setIdentity(x: string): Promise<Snap> }).setIdentity(v), value)
}

export interface SessionInfo {
  storagePath: string | null
  isDefaultSession: boolean
  cookies: Array<{ name: string; value: string }>
}

/** Electron-level view of every game webContents: which session, which jar. */
export function sessionInfos(app: ElectronApplication, siteUrl: string): Promise<SessionInfo[]> {
  return app.evaluate(async ({ webContents, session }, url) => {
    const out: SessionInfo[] = []
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.getURL().startsWith(url)) continue
      const cookies = await wc.session.cookies.get({})
      out.push({
        storagePath: wc.session.storagePath ?? null,
        isDefaultSession: wc.session === session.defaultSession,
        cookies: cookies.map((c) => ({ name: c.name, value: c.value })),
      })
    }
    return out
  }, siteUrl)
}
