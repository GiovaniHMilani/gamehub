import { app, session, type Session } from 'electron'
import { join } from 'node:path'
import { EVENTS } from '@shared/ipc/channels'
import { InstanceEventPublisher } from './ipc/event-publisher'
import { applySessionPolicies } from './browser-sessions/session-policies'
import { SessionManager } from './browser-sessions/session-manager'
import { InstanceManager } from './instances/instance-manager'
import { registerIpc } from './ipc/register'
import { createLogger, fileSink, multiSink, stderrSink } from './logging/logger'
import { NoticeBroker } from './notices/notice-broker'
import { openDatabase } from './persistence/db'
import { createRepositories } from './persistence/repositories'
import { processTombstones } from './persistence/tombstones'
import { installAppProtocol, registerAppScheme } from './platform/app-protocol'
import { configureUserDataPath, logsDirectory, migrationsDirectory } from './platform/paths'
import { installGlobalGuards } from './security/guards'
import { WindowManager } from './window/window-manager'

// ---- pre-ready ---------------------------------------------------------
configureUserDataPath()
app.enableSandbox()
registerAppScheme() // before ready: gives app:// its privileges

// Two GameHub processes on one userData would corrupt the DB and partitions (ADR-0013).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void main()
}

async function main(): Promise<void> {
  await app.whenReady()

  const sinks = app.isPackaged ? [fileSink(logsDirectory())] : [fileSink(logsDirectory()), stderrSink()]
  const log = createLogger('app', multiSink(...sinks))
  installGlobalGuards(log.child('security'))
  installAppProtocol(join(import.meta.dirname, '../renderer'), log.child('app-protocol'))

  // ---- startup order (docs/architecture/overview.md §6) -----------------
  const userData = app.getPath('userData')
  const opened = openDatabase(join(userData, 'gamehub.db'), migrationsDirectory())
  const repos = createRepositories(opened.db)
  // Tombstones first: before any session.fromPartition, so no partition is loaded yet.
  await processTombstones(userData, repos.tombstones, log.child('persistence'))

  const sessions = new SessionManager<Session>({
    resolvePartitionId: (accountId) => repos.instances.getPartitionId(accountId),
    fromPartition: (name) => session.fromPartition(name),
    configure: applySessionPolicies,
    log: log.child('session'),
  })
  const windows = new WindowManager(log.child('window'))
  const manager = new InstanceManager<Session>({ repos, sessions, host: windows, log: log.child('instance') })

  const publisher = new InstanceEventPublisher()
  const notices = new NoticeBroker({
    repos,
    applyOrigins: (gameId) => manager.applyAllowedOrigins(gameId),
    publish: (list) => {
      const target = windows.mainWindow
      if (target !== null && !target.isDestroyed()) target.webContents.send(EVENTS.noticesChanged, list)
    },
    log: log.child('notices'),
  })
  windows.blockedHandler = (request) => notices.request(request)
  const shell = windows.createMainWindow()
  const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
  registerIpc({ getShellWindow: () => windows.mainWindow, manager, publisher, notices, stage: windows, repos, log: log.child('ipc'), devServerUrl })

  // Main owns `seq`: every state change and removal is sequenced here, then pushed to the shell.
  manager.onChange((instance) => {
    publisher.publish({ type: 'instance.changed', instance })
    // A view that is gone cannot redo a refused navigation: drop what depended on it.
    if (instance.status === 'stopped' || instance.status === 'crashed' || instance.status === 'error') {
      notices.clearForInstance(instance.id)
    }
  })
  manager.onRemoved((instanceId) => {
    publisher.publish({ type: 'instance.removed', instanceId })
    notices.clearForInstance(instanceId)
  })
  publisher.subscribe((event) => {
    const target = windows.mainWindow
    if (target !== null && !target.isDestroyed()) target.webContents.send(EVENTS.instancesEvent, event)
  })

  // Restore after the shell has loaded so its UI can observe the states.
  shell.webContents.once('did-finish-load', () => void manager.restore())

  app.on('second-instance', () => {
    const target = windows.mainWindow
    if (target === null) return
    if (target.isMinimized()) target.restore()
    target.focus()
  })

  // Closing the shell closes the app on every platform for now: views belong to
  // that window and renderer-driven layout (phase 7) does not exist yet.
  app.on('window-all-closed', () => app.quit())

  // ---- shutdown: stop views, flush sessions, keep restore intent --------
  let shuttingDown = false
  let shutdownComplete = false
  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    log.info('app.shutdown')
    void manager
      .shutdown()
      .catch((error: unknown) => log.error('app.shutdown_failed', { error }))
      .finally(() => {
        opened.close()
        shutdownComplete = true
        app.quit()
      })
  })

  log.info('app.ready', { userData })
}
