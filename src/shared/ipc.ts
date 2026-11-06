// The typed bridge between the renderer and the main process. The renderer never sees Node, the file system or
// the Hermes process; everything goes through `window.tomo`.
import type { Answers, Hatch, Lang, PackManifest } from './pack/types'

export interface AppInfo {
  version: string
  platform: 'darwin' | 'win32' | 'linux'
  dataDir: string
}

export type Theme = 'light' | 'dark'
export type UiScale = 'auto' | number
export type ProviderId = 'gakuen' | 'openai' | 'openai-api' | 'openrouter' | 'deepseek' | 'custom'
export type Reasoning = 'off' | 'low' | 'medium' | 'high'
export type AnswerMode = 'direct' | 'chain'

export interface ProviderChoice {
  id: ProviderId
  model: string
  baseUrl?: string
  customKind?: 'openai' | 'anthropic'
  reasoning?: Reasoning
}

/** A connected provider (the key itself stays in the main process). `models`: the list seen when it was tested. */
export interface Connection extends ProviderChoice {
  models?: string[]
}

/** The provider that answers when the one in use can't (rate limit, outage, rejected key). */
export interface FallbackChoice {
  id: ProviderId
  model: string
}

/** School pack updates: installed automatically (unless they add access) or only reported. */
export type PackUpdateMode = 'auto' | 'manual'
export interface PackUpdateState {
  checking: boolean
  checkedAt?: number
  /** A newer release, verified and waiting: for the student's OK (it adds access) or because updates are manual. */
  available?: { version: string; addedAccess: string[]; notes: string[]; hatchChanged: boolean }
  /** The update installed last (automatically or after the OK): shown once as "updated". */
  installed?: { version: string; at: number; notes: string[]; hatchChanged: boolean }
  error?: string
}

/** What closing the main window does: keep running in the tray / menu bar, or quit Tomo. */
export type CloseAction = 'tray' | 'quit'

export interface Prefs {
  locale: Lang
  theme: Theme
  uiScale: UiScale
  closeAction: CloseAction
}

export type ChatGptLoginEvent =
  | { event: 'code'; user_code: string; verification_url: string }
  | { event: 'approved'; models: string[] }
  | { event: 'expired' }
  | { event: 'error'; message: string }

export interface UpdateStatus {
  /** portable-available: the Windows portable build found a newer release (downloaded by the student) */
  state: 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'portable-available' | 'error'
  current: string
  available?: string
  percent?: number
  error?: string
}

export interface PackSummary {
  id: string
  manifest: PackManifest
  hatch: Hatch
}

export type EngineState = 'stopped' | 'starting' | 'ready' | 'crashed'
/** First-start preparation of the engine (download from GitHub, install into Tomo's folder). */
export interface EngineProgress { stage: 'download' | 'unpack' | 'install' | 'browser' | 'done' | 'error'; percent: number; detail?: string }

export interface AppState {
  setupDone: boolean
  prefs: Prefs
  provider?: ProviderChoice
  /** Masked key hint, e.g. "gk-…a1b2" (the key itself never reaches the renderer). */
  keyHint?: string
  /** Every connected provider, the one in use included, with masked key hints. */
  connections: (Connection & { keyHint?: string })[]
  /** The fallback in effect (on by default with a second connection), or null. */
  fallback: FallbackChoice | null
  /** The GakuenAI relay URL is configured in this build. */
  gakuenAvailable: boolean
  pack?: PackSummary
  /** installed: the engine files exist in this installation (checked at start, not assumed) */
  engine: { state: EngineState; version: string; installed: boolean; progress?: EngineProgress }
  answerMode: AnswerMode
  packUpdate: PackUpdateState & { mode: PackUpdateMode }
  /** Windows portable build: the secret store is protected by the student's password, entered at every start. */
  portable: { enabled: boolean; hasPassword: boolean; unlocked: boolean }
}

export type FinishTask = 'engine' | 'settings' | 'profile' | 'start' | 'test'
export type TaskState = 'pending' | 'running' | 'done' | 'error'
export interface TaskUpdate {
  task: FinishTask
  state: TaskState
  detail?: string
}

export interface BrowserInfo {
  name: 'Google Chrome' | 'Microsoft Edge'
  path: string
}

export interface SessionRow {
  id: string
  title: string
  startedAt?: number
  messageCount?: number
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool'
  text: string
  name?: string
}

export type ChatEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool.start'; toolId: string; name: string; args?: Record<string, unknown> | null }
  | { kind: 'tool.complete'; toolId: string; name: string; summary?: string | null; durationS?: number | null }
  | { kind: 'complete'; text: string; status?: string | null; error?: string | null }
  | { kind: 'error'; message: string }
  | { kind: 'title'; title: string }
  /** This turn was answered by the fallback provider (the one in use could not answer). */
  | { kind: 'fallback'; provider: ProviderId; model: string; from: ProviderId }

/** A question from the engine that the student answers (approval, clarify). */
export interface EngineRequest {
  id: string
  method: 'approval' | 'clarify' | 'secret'
  sessionId?: string
  params: Record<string, unknown>
}

export interface ModelList {
  provider?: string
  model?: string
  models: string[]
}

export interface TomoApi {
  appInfo(): Promise<AppInfo>
  getState(): Promise<AppState>
  setPrefs(prefs: Partial<Prefs>): Promise<void>

  // first run
  listPacks(): Promise<PackSummary[]>
  selectPack(id: string | null): Promise<void>
  connectProvider(choice: ProviderChoice, key?: string, models?: string[]): Promise<void>
  /** "Test": ask the provider for its models with this key (nothing is saved). */
  listProviderModels(choice: ProviderChoice, key: string): Promise<{ ok: boolean; models?: string[]; error?: 'wrong-key' | 'unreachable' | 'no-models'; detail?: string }>
  /** ChatGPT sign-in (OpenAI, device code). Events: code → approved (with models) | expired | error. */
  startChatGptLogin(): Promise<void>
  cancelChatGptLogin(): Promise<void>
  onChatGptLogin(cb: (e: ChatGptLoginEvent) => void): () => void
  findBrowsers(): Promise<BrowserInfo[]>
  /** macOS only: download Google Chrome, verify Google's signature, copy to ~/Applications. */
  installChrome(): Promise<{ ok: boolean; message?: string }>
  onChromeStage(cb: (stage: string) => void): () => void
  finishSetup(answers: Answers): Promise<{ ok: boolean; failed?: FinishTask; message?: string }>
  completeSetup(): Promise<void>
  onSetupTask(cb: (u: TaskUpdate) => void): () => void

  // chat
  /** Real identifier values for on-screen display only (renderer unmasks placeholders). */
  displayValues(): Promise<Record<string, string>>
  listSessions(): Promise<SessionRow[]>
  createSession(): Promise<string>
  history(sessionId: string): Promise<HistoryMessage[]>
  send(sessionId: string, text: string, topic?: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  onChatEvent(cb: (sessionId: string, e: ChatEvent) => void): () => void
  onEngineRequest(cb: (r: EngineRequest) => void): () => void
  respond(id: string, result: unknown): Promise<void>

  // settings
  listModels(): Promise<ModelList>
  /** Settings → Model & usage: connect another provider (it becomes the one in use), switch, remove, fallback. */
  addProvider(choice: ProviderChoice, key?: string, models?: string[]): Promise<void>
  useProvider(id: ProviderId): Promise<void>
  removeProvider(id: ProviderId): Promise<void>
  /** null turns the fallback off. */
  setFallback(choice: FallbackChoice | null): Promise<void>
  setModel(model: string): Promise<void>
  setReasoning(level: Reasoning): Promise<void>
  userMemory(): Promise<string[]>
  restartEngine(): Promise<void>
  diagnostics(): Promise<string>
  exportData(): Promise<string | null>
  deleteData(scope: 'chats' | 'everything'): Promise<void>
  setAnswerMode(mode: AnswerMode): Promise<void>
  exportStudyLog(): Promise<{ path: string; records: number } | null>
  onEngineState(cb: (state: EngineState) => void): () => void
  onEngineProgress(cb: (p: EngineProgress) => void): () => void
  updateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  retryEnginePrep(): Promise<void>
  setPortablePassword(password: string): Promise<void>
  unlockPortable(password: string): Promise<boolean>
  changePortablePassword(current: string, next: string): Promise<boolean>
  resetPortable(): Promise<void>
  checkPackUpdate(): Promise<void>
  installPackUpdate(): Promise<void>
  setPackUpdateMode(mode: PackUpdateMode): Promise<void>
  onPackUpdate(cb: (s: PackUpdateState) => void): () => void
  /** The tray menu asks the window to show a page. */
  onNavigate(cb: (page: 'settings') => void): () => void
}

export const IPC = {
  appInfo: 'tomo:app-info',
  getState: 'tomo:get-state',
  setPrefs: 'tomo:set-prefs',
  listPacks: 'tomo:list-packs',
  selectPack: 'tomo:select-pack',
  connectProvider: 'tomo:connect-provider',
  listProviderModels: 'tomo:list-provider-models',
  startChatGptLogin: 'tomo:chatgpt-login-start',
  cancelChatGptLogin: 'tomo:chatgpt-login-cancel',
  chatGptLogin: 'tomo:chatgpt-login',
  findBrowsers: 'tomo:find-browsers',
  installChrome: 'tomo:install-chrome',
  chromeStage: 'tomo:chrome-stage',
  finishSetup: 'tomo:finish-setup',
  completeSetup: 'tomo:complete-setup',
  setupTask: 'tomo:setup-task',
  displayValues: 'tomo:display-values',
  listSessions: 'tomo:list-sessions',
  createSession: 'tomo:create-session',
  history: 'tomo:history',
  send: 'tomo:send',
  interrupt: 'tomo:interrupt',
  chatEvent: 'tomo:chat-event',
  engineRequest: 'tomo:engine-request',
  respond: 'tomo:respond',
  listModels: 'tomo:list-models',
  setModel: 'tomo:set-model',
  addProvider: 'tomo:add-provider',
  useProvider: 'tomo:use-provider',
  removeProvider: 'tomo:remove-provider',
  setFallback: 'tomo:set-fallback',
  setReasoning: 'tomo:set-reasoning',
  userMemory: 'tomo:user-memory',
  restartEngine: 'tomo:restart-engine',
  diagnostics: 'tomo:diagnostics',
  exportData: 'tomo:export-data',
  deleteData: 'tomo:delete-data',
  engineState: 'tomo:engine-state',
  engineProgress: 'tomo:engine-progress',
  updateStatus: 'tomo:update-status',
  checkForUpdates: 'tomo:check-updates',
  installUpdate: 'tomo:install-update',
  updateEvent: 'tomo:update-event',
  retryEnginePrep: 'tomo:retry-engine-prep',
  setAnswerMode: 'tomo:set-answer-mode',
  exportStudyLog: 'tomo:export-study-log',
  navigate: 'tomo:navigate',
  setPortablePassword: 'tomo:portable-set-password',
  unlockPortable: 'tomo:portable-unlock',
  changePortablePassword: 'tomo:portable-change-password',
  resetPortable: 'tomo:portable-reset',
  checkPackUpdate: 'tomo:check-pack-update',
  installPackUpdate: 'tomo:install-pack-update',
  setPackUpdateMode: 'tomo:set-pack-update-mode',
  packUpdateEvent: 'tomo:pack-update-event',
} as const
