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

export interface Prefs {
  locale: Lang
  theme: Theme
  uiScale: UiScale
}

export interface PackSummary {
  id: string
  manifest: PackManifest
  hatch: Hatch
}

export type EngineState = 'stopped' | 'starting' | 'ready' | 'crashed'

export interface AppState {
  setupDone: boolean
  prefs: Prefs
  provider?: ProviderChoice
  /** Masked key hint, e.g. "gk-…a1b2" (the key itself never reaches the renderer). */
  keyHint?: string
  /** The GakuenAI relay URL is configured in this build. */
  gakuenAvailable: boolean
  pack?: PackSummary
  engine: { state: EngineState; version: string }
  answerMode: AnswerMode
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
  connectProvider(choice: ProviderChoice, key?: string): Promise<void>
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
}

export const IPC = {
  appInfo: 'tomo:app-info',
  getState: 'tomo:get-state',
  setPrefs: 'tomo:set-prefs',
  listPacks: 'tomo:list-packs',
  selectPack: 'tomo:select-pack',
  connectProvider: 'tomo:connect-provider',
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
  setReasoning: 'tomo:set-reasoning',
  userMemory: 'tomo:user-memory',
  restartEngine: 'tomo:restart-engine',
  diagnostics: 'tomo:diagnostics',
  exportData: 'tomo:export-data',
  deleteData: 'tomo:delete-data',
  engineState: 'tomo:engine-state',
  setAnswerMode: 'tomo:set-answer-mode',
  exportStudyLog: 'tomo:export-study-log',
} as const
