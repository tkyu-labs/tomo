import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { IPC, type AppInfo } from '@shared/ipc'
import { tomoDataDir, tomoPaths } from './paths'

const isDev = !app.isPackaged
const dataDir = tomoDataDir({
  platform: process.platform,
  env: process.env,
  home: app.getPath('home'),
  devRoot: isDev ? resolve(app.getAppPath()) : undefined,
})
export const paths = tomoPaths(dataDir)

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 950,
    height: 600,
    minWidth: 720,
    minHeight: 480,
    title: 'Tomo（伴）',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  // External links open in the system browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

ipcMain.handle(IPC.appInfo, (): AppInfo => ({
  version: app.getVersion(),
  platform: process.platform as AppInfo['platform'],
  dataDir: paths.data,
}))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
