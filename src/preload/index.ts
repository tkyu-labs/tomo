import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type TomoApi } from '@shared/ipc'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: TomoApi = {
  appInfo: invoke(IPC.appInfo) as TomoApi['appInfo'],
  getState: invoke(IPC.getState) as TomoApi['getState'],
  setPrefs: invoke(IPC.setPrefs) as TomoApi['setPrefs'],
  listPacks: invoke(IPC.listPacks) as TomoApi['listPacks'],
  selectPack: invoke(IPC.selectPack) as TomoApi['selectPack'],
  connectProvider: invoke(IPC.connectProvider) as TomoApi['connectProvider'],
  listProviderModels: invoke(IPC.listProviderModels) as TomoApi['listProviderModels'],
  startChatGptLogin: invoke(IPC.startChatGptLogin) as TomoApi['startChatGptLogin'],
  cancelChatGptLogin: invoke(IPC.cancelChatGptLogin) as TomoApi['cancelChatGptLogin'],
  onChatGptLogin: (cb) => listen(IPC.chatGptLogin, cb),
  findBrowsers: invoke(IPC.findBrowsers) as TomoApi['findBrowsers'],
  installChrome: invoke(IPC.installChrome) as TomoApi['installChrome'],
  onChromeStage: (cb) => listen(IPC.chromeStage, cb),
  finishSetup: invoke(IPC.finishSetup) as TomoApi['finishSetup'],
  completeSetup: invoke(IPC.completeSetup) as TomoApi['completeSetup'],
  onSetupTask: (cb) => listen(IPC.setupTask, cb),
  displayValues: invoke(IPC.displayValues) as TomoApi['displayValues'],
  listSessions: invoke(IPC.listSessions) as TomoApi['listSessions'],
  createSession: invoke(IPC.createSession) as TomoApi['createSession'],
  history: invoke(IPC.history) as TomoApi['history'],
  send: invoke(IPC.send) as TomoApi['send'],
  interrupt: invoke(IPC.interrupt) as TomoApi['interrupt'],
  onChatEvent: (cb) => listen(IPC.chatEvent, cb),
  onEngineRequest: (cb) => listen(IPC.engineRequest, cb),
  respond: invoke(IPC.respond) as TomoApi['respond'],
  listModels: invoke(IPC.listModels) as TomoApi['listModels'],
  setModel: invoke(IPC.setModel) as TomoApi['setModel'],
  addProvider: invoke(IPC.addProvider) as TomoApi['addProvider'],
  useProvider: invoke(IPC.useProvider) as TomoApi['useProvider'],
  removeProvider: invoke(IPC.removeProvider) as TomoApi['removeProvider'],
  setFallback: invoke(IPC.setFallback) as TomoApi['setFallback'],
  setPortablePassword: invoke(IPC.setPortablePassword) as TomoApi['setPortablePassword'],
  unlockPortable: invoke(IPC.unlockPortable) as TomoApi['unlockPortable'],
  changePortablePassword: invoke(IPC.changePortablePassword) as TomoApi['changePortablePassword'],
  resetPortable: invoke(IPC.resetPortable) as TomoApi['resetPortable'],
  checkPackUpdate: invoke(IPC.checkPackUpdate) as TomoApi['checkPackUpdate'],
  installPackUpdate: invoke(IPC.installPackUpdate) as TomoApi['installPackUpdate'],
  setPackUpdateMode: invoke(IPC.setPackUpdateMode) as TomoApi['setPackUpdateMode'],
  onPackUpdate: (cb) => listen(IPC.packUpdateEvent, cb),
  setReasoning: invoke(IPC.setReasoning) as TomoApi['setReasoning'],
  userMemory: invoke(IPC.userMemory) as TomoApi['userMemory'],
  restartEngine: invoke(IPC.restartEngine) as TomoApi['restartEngine'],
  diagnostics: invoke(IPC.diagnostics) as TomoApi['diagnostics'],
  exportData: invoke(IPC.exportData) as TomoApi['exportData'],
  deleteData: invoke(IPC.deleteData) as TomoApi['deleteData'],
  onEngineState: (cb) => listen(IPC.engineState, cb),
  onEngineProgress: (cb) => listen(IPC.engineProgress, cb),
  updateStatus: invoke(IPC.updateStatus) as TomoApi['updateStatus'],
  checkForUpdates: invoke(IPC.checkForUpdates) as TomoApi['checkForUpdates'],
  installUpdate: invoke(IPC.installUpdate) as TomoApi['installUpdate'],
  onUpdateStatus: (cb) => listen(IPC.updateEvent, cb),
  retryEnginePrep: invoke(IPC.retryEnginePrep) as TomoApi['retryEnginePrep'],
  setAnswerMode: invoke(IPC.setAnswerMode) as TomoApi['setAnswerMode'],
  exportStudyLog: invoke(IPC.exportStudyLog) as TomoApi['exportStudyLog'],
  onNavigate: (cb) => listen(IPC.navigate, cb),
}

contextBridge.exposeInMainWorld('tomo', api)
