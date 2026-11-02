import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type TomoApi } from '@shared/ipc'

const api: TomoApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
}

contextBridge.exposeInMainWorld('tomo', api)
