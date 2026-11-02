// The typed bridge between the renderer and the main process. The renderer never sees Node, the file system
// or the Hermes process; everything goes through `window.tomo`.
export interface AppInfo {
  version: string
  platform: 'darwin' | 'win32' | 'linux'
  dataDir: string
}

export interface TomoApi {
  appInfo(): Promise<AppInfo>
}

export const IPC = {
  appInfo: 'tomo:app-info',
} as const
