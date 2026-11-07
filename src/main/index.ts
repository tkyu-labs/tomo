import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IPC, type AppInfo, type FallbackChoice, type PackUpdateMode, type ProviderChoice, type ProviderId } from '@shared/ipc'
import { localeFromTag } from '@shared/locale'
import { AppController } from './app/controller'
import { Updater } from './app/updater'
import { TomoTray } from './app/tray'
import { readWindowState, restoreState, writeWindowState, type WindowState } from './app/window-state'
import { findBrowsers } from './app/browsers'
import { installChrome } from './app/chrome-install'
import { devRuntime } from './hermes/runtime'
import { EngineInstaller } from './engine/installer'
import { fetchCatalogPacks } from './pack/remote'
import { portableRoot, tomoDataDir, tomoPaths } from './paths'
import { PortableKey } from './secrets/portable'

const isDev = !app.isPackaged
const appRoot = resolve(app.getAppPath())
// Windows portable build: everything in <root>\Data, secrets protected by the student's password (src/main/paths.ts)
const portable = process.platform === 'win32' || process.env.TOMO_PORTABLE_ROOT ? portableRoot(process.execPath, process.env) : undefined
// TOMO_DATA_DIR: tests and e2e checks run against a throw-away folder.
const dataDir = process.env.TOMO_DATA_DIR || (portable ? join(portable, 'Data') : undefined) || tomoDataDir({
  platform: process.platform,
  env: process.env,
  home: app.getPath('home'),
  devRoot: isDev ? appRoot : undefined,
})
const paths = tomoPaths(dataDir)
const appIconDir = isDev ? join(appRoot, 'build-resources') : process.resourcesPath
// Chromium's own profile (cache, local storage) goes inside Tomo's folder, never next to it in the user's profile.
app.setPath('userData', join(dataDir, 'electron'))
app.setPath('sessionData', join(dataDir, 'electron'))

// One Tomo per data folder: starting it again brings the running window back (Electron keys the lock on userData).
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.exit(0)

let win: BrowserWindow | null = null
/** Set once Tomo really quits (tray Quit, ⌘Q, update install); until then closing the window only hides it. */
let quitting = false
const send = (channel: string, ...args: unknown[]) => win?.webContents.send(channel, ...args)
const updater = new Updater((s) => send(IPC.updateEvent, s), () => { quitting = true }, !!portable)
const portableKey = portable ? new PortableKey(join(paths.data, 'secret-key.json')) : undefined

// Development runs the engine from .dev/ (scripts/dev-hermes.sh). Installed apps — and development with
// TOMO_ENGINE=install — download Hermes from GitHub into Tomo's folder on first start, using the bundled uv.
const installEngine = !isDev || process.env.TOMO_ENGINE === 'install'
const uvBinary = join(isDev ? join(appRoot, 'build', 'uv') : join(process.resourcesPath, 'uv'), process.platform === 'win32' ? 'uv.exe' : 'uv')

const controller = new AppController({
  paths,
  systemLocale: () => localeFromTag(app.getPreferredSystemLanguages()[0]),
  // portable: kept documents travel with the folder
  documentsDir: portable ? join(portable, 'Documents') : join(app.getPath('documents'), 'Tomo'),
  portableKey,
  runtime: installEngine ? undefined : devRuntime(appRoot),
  engine: installEngine ? new EngineInstaller({ dataDir: paths.data, hermesHome: paths.hermesHome, uv: uvBinary, baseEnv: process.env }) : undefined,
  encryptor: portableKey ?? {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  },
  // the first-run choice lists what tomo-packs main has now (Tomo's mirror first, GitHub second)
  remotePacks: () => fetchCatalogPacks(paths.data, app.getVersion()),
  pluginsDir: isDev ? join(appRoot, 'plugins') : join(process.resourcesPath, 'plugins'),
  helpersDir: isDev ? join(appRoot, 'engine-helpers') : join(process.resourcesPath, 'engine-helpers'),
  runtimeDir: !installEngine && existsSync(join(appRoot, '.dev', 'home', 'tools')) ? join(appRoot, '.dev', 'home', 'tools') : undefined,
  baseEnv: process.env,
  appVersion: app.getVersion(),
  // GakuenAI relay: runtime environment first (TOMO_GAKUEN_URL, or GAKUEN_API_GATEWAY as set for development), then the
  // value baked into release builds at build time (MAIN_VITE_GAKUEN_URL). The URL is never part of the source.
  gakuenUrl: process.env.TOMO_GAKUEN_URL || process.env.GAKUEN_API_GATEWAY || import.meta.env.MAIN_VITE_GAKUEN_URL || undefined,
  emit: {
    chat: (sessionId, e) => send(IPC.chatEvent, sessionId, e),
    request: (r) => send(IPC.engineRequest, r),
    chatgptLogin: (e) => send(IPC.chatGptLogin, e),
    setupTask: (u) => send(IPC.setupTask, u),
    engineState: (s) => send(IPC.engineState, s),
    engineProgress: (p) => send(IPC.engineProgress, p),
    packUpdate: (s) => send(IPC.packUpdateEvent, s),
    migration: (m) => send(IPC.migrationEvent, m),
  },
})

const windowStateFile = join(paths.data, 'window-state.json')
const WINDOW_DEFAULT = { width: 950, height: 600 }
const WINDOW_MIN = { width: 720, height: 480 }

function showWindow(page?: 'settings'): void {
  if (!win) win = createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (page) send(IPC.navigate, page)
}

const tray = new TomoTray(appIconDir, {
  open: () => showWindow(),
  settings: () => showWindow('settings'),
  quit: () => { quitting = true; app.quit() },
  locale: () => controller.getState().prefs.locale,
  canOpenSettings: () => controller.getState().setupDone,
})

const QUIT_COPY = {
  en: { message: 'Tomo is still working', detail: 'An answer or an action is in progress. Quitting stops it.', quit: 'Quit anyway', keep: 'Keep running' },
  zh: { message: 'Tomo 还在工作', detail: '有回答或操作正在进行，退出会中断它。', quit: '仍然退出', keep: '继续运行' },
  ja: { message: 'Tomo はまだ作業中です', detail: '回答または操作が進行中です。終了すると中断されます。', quit: '終了する', keep: '実行を続ける' },
}

async function quitFromClose(w: BrowserWindow): Promise<void> {
  if (controller.busy) {
    const t = QUIT_COPY[controller.getState().prefs.locale] ?? QUIT_COPY.en
    const { response } = await dialog.showMessageBox(w, { type: 'question', message: t.message, detail: t.detail, buttons: [t.quit, t.keep], defaultId: 1, cancelId: 1, noLink: true })
    if (response !== 0) return
  }
  quitting = true
  app.quit()
}

function createWindow(): BrowserWindow {
  const start = restoreState(readWindowState(windowStateFile), screen.getAllDisplays().map((d) => d.workArea), WINDOW_DEFAULT, WINDOW_MIN)
  const w = new BrowserWindow({
    autoHideMenuBar: true,
    icon: join(appIconDir, 'icon.png'),
    width: start.width,
    height: start.height,
    ...(start.x !== undefined && start.y !== undefined ? { x: start.x, y: start.y } : { center: true }),
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    title: 'Tomo（伴）',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 18 } } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  w.once('ready-to-show', () => {
    if (start.maximized) w.maximize()
    w.show()
  })
  // remember size and position (normal bounds, so un-maximising later returns to the student's size)
  let saveTimer: NodeJS.Timeout | undefined
  const save = () => {
    if (w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return
    const b = w.getNormalBounds()
    const state: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.isMaximized() }
    try { writeWindowState(windowStateFile, state) } catch { /* not worth interrupting the student */ }
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400) }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) w.on(ev as 'resize', saveSoon)
  // Windows: never hold up a sign-out or shutdown
  w.on('query-session-end', () => { quitting = true })
  // closing hides the window; Tomo keeps running in the tray (chats and actions continue)
  w.on('close', (e) => {
    clearTimeout(saveTimer)
    save()
    if (quitting) return
    e.preventDefault()
    // Settings → Window → "When you close the window": quit (asking first while Tomo is working) or keep running
    if (controller.getState().prefs.closeAction === 'quit') {
      void quitFromClose(w)
      return
    }
    w.hide()
    if (process.platform === 'win32' && !controller.settings.read().trayHintShown) {
      tray.showCloseHint()
      controller.settings.update((st) => { st.trayHintShown = true })
    }
  })
  // External links open in the system browser; the app window never navigates away.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) e.preventDefault()
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  w.on('closed', () => { win = null })
  return w
}

const handle = (channel: string, fn: (...args: never[]) => unknown) =>
  ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))

handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), platform: process.platform as AppInfo['platform'], dataDir: paths.data }))
handle(IPC.getState, () => controller.getState())
handle(IPC.setPrefs, async (p: Parameters<AppController['setPrefs']>[0]) => { await controller.setPrefs(p); tray.refresh() })
handle(IPC.listPacks, () => controller.listPacks())
handle(IPC.selectPack, (id: string | null) => controller.selectPack(id))
handle(IPC.connectProvider, (c: Parameters<AppController['connectProvider']>[0], key?: string, models?: string[]) => controller.connectProvider(c, key, models))
handle(IPC.listProviderModels, (c: Parameters<AppController['listProviderModels']>[0], key: string) => controller.listProviderModels(c, key))
handle(IPC.startChatGptLogin, () => controller.startChatGptLogin())
handle(IPC.cancelChatGptLogin, () => controller.cancelChatGptLogin())
handle(IPC.findBrowsers, () => findBrowsers(process.platform, app.getPath('home'), process.env))
handle(IPC.installChrome, async () => {
  if (process.platform !== 'darwin') return { ok: false, message: 'Only needed on macOS; Windows uses Microsoft Edge.' }
  try {
    await installChrome(join(app.getPath('home'), 'Applications'), join(paths.data, 'cache', 'chrome-download'), undefined, (s) => send(IPC.chromeStage, s))
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
})
handle(IPC.finishSetup, (answers: Parameters<AppController['finishSetup']>[0]) => controller.finishSetup(answers))
handle(IPC.completeSetup, async () => { const r = await controller.completeSetup(); tray.refresh(); return r })
handle(IPC.displayValues, () => controller.displayValues())
handle(IPC.listSessions, () => controller.listSessions())
handle(IPC.createSession, () => controller.createSession())
handle(IPC.history, (id: string) => controller.history(id))
handle(IPC.send, (id: string, text: string, topic?: string) => controller.send(id, text, topic))
handle(IPC.interrupt, (id: string) => controller.interrupt(id))
handle(IPC.respond, (id: string, result: unknown) => controller.respond(id, result))
handle(IPC.listModels, () => controller.listModels())
handle(IPC.setModel, (m: string) => controller.setModel(m))
handle(IPC.addProvider, (choice: ProviderChoice, key?: string, models?: string[]) => controller.addProvider(choice, key, models))
handle(IPC.useProvider, (id: ProviderId) => controller.useProvider(id))
handle(IPC.removeProvider, (id: ProviderId) => controller.removeProvider(id))
handle(IPC.setFallback, (f: FallbackChoice | null) => controller.setFallback(f))
handle(IPC.setPortablePassword, (pw: string) => controller.setPortablePassword(pw))
handle(IPC.unlockPortable, (pw: string) => controller.unlockPortable(pw))
handle(IPC.changePortablePassword, (cur: string, next: string) => controller.changePortablePassword(cur, next))
handle(IPC.resetPortable, () => controller.resetPortable())
handle(IPC.removePack, () => controller.removePack())
handle(IPC.setPersonalConsent, (allowed: boolean) => controller.setPersonalConsent(allowed))
handle(IPC.runMigration, () => controller.migrate())
handle(IPC.dismissMigration, () => controller.dismissMigration())
handle(IPC.checkPackUpdate, () => controller.packUpdater.check())
handle(IPC.installPackUpdate, () => controller.packUpdater.install())
handle(IPC.setPackUpdateMode, (m: PackUpdateMode) => controller.setPackUpdateMode(m))
handle(IPC.setReasoning, (l: Parameters<AppController['setReasoning']>[0]) => controller.setReasoning(l))
handle(IPC.userMemory, () => controller.userMemory())
handle(IPC.restartEngine, () => controller.startEngine(true))
handle(IPC.diagnostics, () => controller.diagnostics())
handle(IPC.updateStatus, () => updater.status)
handle(IPC.checkForUpdates, () => updater.check())
handle(IPC.installUpdate, () => updater.installNow())
handle(IPC.retryEnginePrep, () => controller.prepareEngine().then(() => undefined))
handle(IPC.exportData, async () => {
  const res = await dialog.showSaveDialog(win!, { defaultPath: 'tomo-export.json' })
  return res.canceled || !res.filePath ? null : controller.exportData(res.filePath)
})
handle(IPC.deleteData, (scope: 'chats' | 'everything') => controller.deleteData(scope))
handle(IPC.setAnswerMode, (m: Parameters<AppController['setAnswerMode']>[0]) => controller.setAnswerMode(m))
handle(IPC.exportStudyLog, async () => {
  const res = await dialog.showSaveDialog(win!, { defaultPath: 'tomo-study-log.jsonl' })
  return res.canceled || !res.filePath ? null : { path: res.filePath, records: controller.exportStudyLog(res.filePath) }
})

/**
 * No menu bar (UI decision: no menu for now). Windows / Linux: none at all — editing shortcuts still work in text
 * fields. macOS always shows the system menu bar; keep only the app menu, Edit (⌘C / ⌘V need the Edit roles) and Window
 * (⌘W / ⌘M).
 */
function setMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    // ⌘W closes (hides) the window like any Mac app; ⌘M minimises
    { role: 'windowMenu', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }] },
  ]))
}

app.whenReady().then(async () => {
  if (!primaryInstance) return
  setMenu()
  updater.start()
  // school pack updates from the tomo-packs main branch (mirror first, GitHub second)
  controller.packUpdater.start()
  if (isDev && process.platform === 'darwin') app.dock?.setIcon(join(appIconDir, 'icon.png')) // packaged builds use icon.icns
  win = createWindow()
  tray.create()
  // portable: the engine needs the keys, so it starts after the student unlocks (IPC.unlockPortable)
  // after an update that needs it, the migration screen updates the engine first (it starts the engine itself)
  if (!portableKey || portableKey.unlocked()) {
    if (controller.migrationNeeded()) void controller.migrate()
    else if (controller.getState().setupDone) { await controller.startEngine().catch(() => undefined); controller.settings.update((s) => { s.lastAppVersion = app.getVersion() }) }
  }
  // macOS: clicking the Dock icon brings the hidden window back
  app.on('activate', () => showWindow())
})

app.on('second-instance', () => showWindow())

// the window is only hidden on close, so this runs only when it was destroyed during quitting
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitting) app.quit()
})

// ⌘Q, tray Quit, Windows shutdown and the updater all pass through here
app.on('before-quit', () => {
  quitting = true
  controller.packUpdater.stop()
  tray.destroy()
  void controller.stopEngine()
})
