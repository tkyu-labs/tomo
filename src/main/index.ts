import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IPC, type AppInfo } from '@shared/ipc'
import { AppController } from './app/controller'
import { findBrowsers } from './app/browsers'
import { installChrome } from './app/chrome-install'
import { devRuntime } from './hermes/runtime'
import { EngineInstaller } from './engine/installer'
import { tomoDataDir, tomoPaths } from './paths'

const isDev = !app.isPackaged
const appRoot = resolve(app.getAppPath())
// TOMO_DATA_DIR: tests and e2e checks run against a throw-away folder.
const dataDir = process.env.TOMO_DATA_DIR || tomoDataDir({
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

function packsSourceDir(): string {
  if (process.env.TOMO_PACKS_DIR) return process.env.TOMO_PACKS_DIR
  if (!isDev) return join(process.resourcesPath, 'packs')
  const checkout = join(appRoot, 'tomo-packs', 'packs')
  return existsSync(checkout) ? checkout : join(appRoot, 'test', 'fixtures', 'packs')
}

let win: BrowserWindow | null = null
const send = (channel: string, ...args: unknown[]) => win?.webContents.send(channel, ...args)

// Development runs the engine from .dev/ (scripts/dev-hermes.sh). Installed apps — and development with
// TOMO_ENGINE=install — download Hermes from GitHub into Tomo's folder on first start, using the bundled uv.
const installEngine = !isDev || process.env.TOMO_ENGINE === 'install'
const uvBinary = join(isDev ? join(appRoot, 'build', 'uv') : join(process.resourcesPath, 'uv'), process.platform === 'win32' ? 'uv.exe' : 'uv')

const controller = new AppController({
  paths,
  runtime: installEngine ? undefined : devRuntime(appRoot),
  engine: installEngine ? new EngineInstaller({ dataDir: paths.data, hermesHome: paths.hermesHome, uv: uvBinary, baseEnv: process.env }) : undefined,
  encryptor: {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  },
  packsSourceDir: packsSourceDir(),
  pluginsDir: isDev ? join(appRoot, 'plugins') : join(process.resourcesPath, 'plugins'),
  helpersDir: isDev ? join(appRoot, 'engine-helpers') : join(process.resourcesPath, 'engine-helpers'),
  runtimeDir: !installEngine && existsSync(join(appRoot, '.dev', 'home', 'tools')) ? join(appRoot, '.dev', 'home', 'tools') : undefined,
  baseEnv: process.env,
  // GakuenAI relay: runtime environment first (TOMO_GAKUEN_URL, or GAKUEN_API_GATEWAY as set for development), then the
  // value baked into tester builds at build time (MAIN_VITE_GAKUEN_URL). The URL is never part of the source.
  gakuenUrl: process.env.TOMO_GAKUEN_URL || process.env.GAKUEN_API_GATEWAY || import.meta.env.MAIN_VITE_GAKUEN_URL || undefined,
  emit: {
    chat: (sessionId, e) => send(IPC.chatEvent, sessionId, e),
    request: (r) => send(IPC.engineRequest, r),
    chatgptLogin: (e) => send(IPC.chatGptLogin, e),
    setupTask: (u) => send(IPC.setupTask, u),
    engineState: (s) => send(IPC.engineState, s),
    engineProgress: (p) => send(IPC.engineProgress, p),
  },
})

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    autoHideMenuBar: true,
    icon: join(appIconDir, 'icon.png'),
    width: 950,
    height: 600,
    minWidth: 720,
    minHeight: 480,
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
  w.once('ready-to-show', () => w.show())
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
handle(IPC.setPrefs, (p: Parameters<AppController['setPrefs']>[0]) => controller.setPrefs(p))
handle(IPC.listPacks, () => controller.listPacks())
handle(IPC.selectPack, (id: string | null) => controller.selectPack(id))
handle(IPC.connectProvider, (c: Parameters<AppController['connectProvider']>[0], key?: string) => controller.connectProvider(c, key))
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
handle(IPC.completeSetup, () => controller.completeSetup())
handle(IPC.displayValues, () => controller.displayValues())
handle(IPC.listSessions, () => controller.listSessions())
handle(IPC.createSession, () => controller.createSession())
handle(IPC.history, (id: string) => controller.history(id))
handle(IPC.send, (id: string, text: string, topic?: string) => controller.send(id, text, topic))
handle(IPC.interrupt, (id: string) => controller.interrupt(id))
handle(IPC.respond, (id: string, result: unknown) => controller.respond(id, result))
handle(IPC.listModels, () => controller.listModels())
handle(IPC.setModel, (m: string) => controller.setModel(m))
handle(IPC.setReasoning, (l: Parameters<AppController['setReasoning']>[0]) => controller.setReasoning(l))
handle(IPC.userMemory, () => controller.userMemory())
handle(IPC.restartEngine, () => controller.startEngine(true))
handle(IPC.diagnostics, () => controller.diagnostics())
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
 * fields. macOS always shows the system menu bar; keep only the app menu and Edit (⌘C / ⌘V need the Edit roles).
 */
function setMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
  ]))
}

app.whenReady().then(async () => {
  setMenu()
  if (isDev && process.platform === 'darwin') app.dock?.setIcon(join(appIconDir, 'icon.png')) // packaged builds use icon.icns
  win = createWindow()
  if (controller.getState().setupDone) await controller.startEngine().catch(() => undefined)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { void controller.stopEngine() })
