import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppState, AnswerMode, ChatEvent, EngineProgress, EngineRequest, FinishTask, HistoryMessage, PackSummary, Prefs, ProviderChoice,
  Reasoning, SessionRow, TaskUpdate,
} from '@shared/ipc'
import { identifiersFrom } from '@shared/pack/hatch'
import type { Answers, Lang } from '@shared/pack/types'
import { Masker } from '@shared/privacy/masker'
import { HermesClient, toTurnEvent } from '../hermes/client'
import { buildHermesEnv } from '../hermes/env'
import { HermesProcess, type HermesRuntime } from '../hermes/process'
import type { GatewayEvent } from '../hermes/rpc'
import { installPack, loadPack, refreshBundledPack, type LoadedPack } from '../pack/pack'
import type { TomoPaths } from '../paths'
import { SecretStore, type Encryptor } from '../secrets/store'
import { evacuateDotenv } from '../setup/home'
import { listModels, setModel, setReasoning } from '../setup/model'
import { privatePayload, refreshProfile, writeAnswerMode, writeProfile } from '../setup/profile'
import { PROVIDER_KEY_ENV, providerConfig } from '../setup/providers'
import { SettingsFile, type Settings } from './settings'
import { StudyLog } from './study-log'
import type { EngineInstaller } from '../engine/installer'
import { ChatGptLogin, type LoginEvent } from './chatgpt-login'
import { listProviderModels } from './provider-check'

export const HERMES_VERSION = '0.21.7'

export interface ControllerOptions {
  paths: TomoPaths
  /** A fixed engine (development: .dev/hermes-venv). Without it, `engine` installs Hermes into Tomo's folder. */
  runtime?: HermesRuntime
  engine?: EngineInstaller
  encryptor: Encryptor
  /** Folder with tomo-packs `packs/<id>` directories (dev: the local checkout; app: bundled). */
  packsSourceDir: string
  /** Folder holding Tomo's Hermes plugins (`plugins/tomo-privacy`, …). */
  pluginsDir: string
  /** Hermes tool runtime (agent-browser, …); default `<hermesHome>/tools`. Development reuses `.dev/home/tools`. */
  runtimeDir?: string
  /** engine-helpers folder (ChatGPT sign-in). */
  helpersDir?: string
  /** Base environment for the gateway (the app's own environment). */
  baseEnv: Record<string, string | undefined>
  gakuenUrl?: string
  /** Recorded in the study log. */
  appVersion?: string
  /** The OS language: the UI language until the student picks one. */
  systemLocale?: () => Lang
  /** UI sinks */
  emit: {
    chat(sessionId: string, e: ChatEvent): void
    request(r: EngineRequest): void
    chatgptLogin?(e: LoginEvent): void
    setupTask(u: TaskUpdate): void
    engineState(state: AppState['engine']['state']): void
    engineProgress?(p: EngineProgress): void
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/**
 * Everything the window needs, independent of Electron (so it is testable): settings, secrets, the pack, the
 * Hermes process and the privacy border. `src/main/index.ts` wires it to IPC.
 */
export class AppController {
  readonly settings: SettingsFile
  readonly secrets: SecretStore
  private hermes?: HermesProcess
  private client?: HermesClient
  private masker = new Masker([])
  private pendingRequests = new Map<string, Pending>()
  private requestSeq = 0
  readonly study: StudyLog

  constructor(private readonly opts: ControllerOptions) {
    mkdirSync(opts.paths.data, { recursive: true })
    this.settings = new SettingsFile(join(opts.paths.data, 'settings.json'), opts.systemLocale)
    this.secrets = new SecretStore(opts.paths.secretStore, opts.encryptor)
    let participant = this.settings.read().participantId
    if (!participant) {
      participant = StudyLog.newParticipantId()
      const id = participant
      this.settings.update((s) => { s.participantId = id })
    }
    // the engine is prepared in the background from the first screen on
    if (opts.engine && !opts.engine.installed()) void this.prepareEngine().catch(() => undefined)
    this.study = new StudyLog(join(opts.paths.data, 'study', 'log.jsonl'), participant, () => {
      const s = this.settings.read()
      return { mode: s.answerMode, pack: s.packId ?? null, appVersion: opts.appVersion }
    })
  }

  // ------------------------------------------------------------------ state
  private gakuenUrl(s: Settings = this.settings.read()): string | undefined {
    return this.opts.gakuenUrl || s.gakuenUrl || undefined
  }

  private installedPack(s: Settings = this.settings.read()): LoadedPack | undefined {
    if (!s.packId) return undefined
    const dir = join(this.opts.paths.data, 'packs', s.packId)
    return existsSync(join(dir, 'pack.yaml')) ? loadPack(dir) : undefined
  }

  getState(): AppState {
    const s = this.settings.read()
    const pack = this.installedPack(s)
    const keyEnv = s.provider ? PROVIDER_KEY_ENV[s.provider.id] : null
    const key = keyEnv ? this.secrets.read().keys[keyEnv] : undefined
    return {
      setupDone: s.setupDone,
      prefs: s.prefs,
      provider: s.provider,
      keyHint: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : undefined,
      gakuenAvailable: !!this.gakuenUrl(s),
      pack: pack ? { id: pack.manifest.id, manifest: pack.manifest, hatch: pack.hatch } : undefined,
      engine: { state: this.hermes?.state ?? 'stopped', version: HERMES_VERSION, installed: this.engineInstalled(), progress: this.opts.engine?.last },
      answerMode: s.answerMode,
    }
  }

  setPrefs(prefs: Partial<Prefs>): void {
    this.settings.update((s) => { s.prefs = { ...s.prefs, ...prefs } })
  }

  /** Chosen by the study operator; the tomo plugin reads it on every turn. */
  setAnswerMode(mode: AnswerMode): void {
    this.settings.update((s) => { s.answerMode = mode })
    writeAnswerMode(this.opts.paths.hermesHome, mode)
  }

  exportStudyLog(target: string): number {
    return this.study.export(target)
  }

  // ------------------------------------------------------------------ first run
  listPacks(): PackSummary[] {
    const dir = this.opts.packsSourceDir
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'pack.yaml')))
      .map((d) => {
        const p = loadPack(join(dir, d.name))
        return { id: p.manifest.id, manifest: p.manifest, hatch: p.hatch }
      })
  }

  selectPack(id: string | null): void {
    if (id) installPack(join(this.opts.packsSourceDir, id), this.opts.paths.data)
    this.settings.update((s) => { s.packId = id ?? undefined; s.answers = {} })
  }

  async listProviderModels(choice: ProviderChoice, key: string) {
    const sel = choice.id === 'gakuen' ? { ...choice, baseUrl: this.gakuenUrl() } : choice
    return listProviderModels(sel, key)
  }

  private login = new ChatGptLogin()

  /** ChatGPT sign-in; Hermes stores the tokens in HERMES_HOME/auth.json (never in Tomo's files). */
  async startChatGptLogin(): Promise<void> {
    await this.prepareEngine() // the sign-in runs Hermes' own code
    mkdirSync(this.opts.paths.hermesHome, { recursive: true })
    const env = buildHermesEnv({ base: this.opts.baseEnv, hermesHome: this.opts.paths.hermesHome, runtimeDir: this.runtimeDir(), cacheDir: join(this.opts.paths.data, 'cache') })
    const helper = join(this.helpersDir(), 'codex_login.py')
    this.login.start(this.runtime(), helper, env, (e) => this.opts.emit.chatgptLogin?.(e))
  }

  cancelChatGptLogin(): void {
    this.login.cancel()
  }

  connectProvider(choice: ProviderChoice, key?: string): void {
    const sel = { ...choice }
    if (sel.id === 'gakuen') sel.baseUrl = this.gakuenUrl()
    providerConfig(sel) // throws early on a missing base URL
    const keyEnv = PROVIDER_KEY_ENV[sel.id]
    if (keyEnv && key) this.secrets.setKey(keyEnv, key.trim())
    this.settings.update((s) => { s.provider = sel })
  }

  /** The five Finish tasks. Each reports progress; the first failure stops the run. */
  async finishSetup(answers: Answers): Promise<{ ok: boolean; failed?: FinishTask; message?: string }> {
    const step = async (task: FinishTask, fn: () => Promise<string | void> | string | void) => {
      this.opts.emit.setupTask({ task, state: 'running' })
      try {
        const detail = (await fn()) ?? undefined
        this.opts.emit.setupTask({ task, state: 'done', detail })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.opts.emit.setupTask({ task, state: 'error', detail: message })
        throw Object.assign(new Error(message), { task })
      }
    }
    try {
      await step('engine', async () => {
        await this.prepareEngine()
        if (!this.engineInstalled()) throw new Error('The AI engine could not be prepared.')
        const browser = this.opts.engine ? true : await this.ensureBrowserRuntime()
        return `Hermes ${HERMES_VERSION}${browser ? ' · browser tools ready' : ''}`
      })
      const pack = this.installedPack()
      await step('settings', () => {
        const s = this.settings.read()
        if (!s.provider) throw new Error('No AI provider connected.')
        const keyEnv = PROVIDER_KEY_ENV[s.provider.id]
        if (keyEnv && !this.secrets.read().keys[keyEnv]) throw new Error('No key saved for the AI provider.')
        if (s.provider.id === 'openai' && !existsSync(join(this.opts.paths.hermesHome, 'auth.json'))) throw new Error('Not signed in to ChatGPT.')
        // identifiers go to the encrypted store, everything else to settings.json
        const identifiers = pack ? identifiersFrom(pack.hatch, answers) : []
        const idQuestions = new Set(pack?.hatch.questions.filter((q) => q.type === 'identifier').map((q) => q.id))
        this.secrets.update((d) => { d.identifiers = identifiers })
        this.settings.update((st) => { st.answers = Object.fromEntries(Object.entries(answers).filter(([k]) => !idQuestions.has(k))) })
      })
      await step('profile', () => this.writeProfile(answers))
      await step('start', async () => { await this.startEngine(true) })
      await step('test', async () => this.testProvider())
      return { ok: true }
    } catch (err) {
      const e = err as Error & { task?: FinishTask }
      return { ok: false, failed: e.task, message: e.message }
    }
  }

  completeSetup(): void {
    this.settings.update((s) => { s.setupDone = true })
  }

  private writeProfile(answers?: Answers): string {
    const s = this.settings.read()
    const pack = this.installedPack(s)
    const full = { ...s.answers, ...(answers ?? {}) }
    // identifier answers come back from the secret store when not given (e.g. on a later config rewrite)
    if (!answers && pack) {
      for (const q of pack.hatch.questions.filter((x) => x.type === 'identifier')) {
        const entry = this.secrets.read().identifiers.find((i) => i.name === q.variable)
        if (entry) full[q.id] = entry.kind === 'name' ? { name: entry.values[0] ?? '', furigana: entry.values[1] ?? '' } : entry.values[0]
      }
    }
    const res = writeProfile({ hermesHome: this.opts.paths.hermesHome, pluginsSourceDir: this.opts.pluginsDir, pack, provider: s.provider!, answers: full, answerMode: s.answerMode })
    return `${res.userMdEntries.length} entries · ${res.identifiers.map((i) => `{{${i.name}}}`).join(', ') || 'no identifiers'}`
  }

  private async testProvider(): Promise<string> {
    const client = this.client!
    const { session_id } = await client.createSession({ hidden: true, title: 'Tomo provider check' })
    const events = await client.runTurn(session_id, 'Reply with the single word: ready', undefined, 90_000)
    const done = events.at(-1)
    if (!done || done.kind !== 'complete' || done.status === 'error' || done.error) {
      throw new Error(done && done.kind === 'complete' && done.error ? done.error : 'The provider did not answer.')
    }
    await client.close(session_id).catch(() => undefined)
    return 'ok'
  }

  // ------------------------------------------------------------------ engine
  /** The engine to run: the fixed development one, or the one installed into Tomo's folder. */
  runtime(): HermesRuntime {
    if (this.opts.runtime) return this.opts.runtime
    return this.opts.engine!.runtime()
  }

  engineInstalled(): boolean {
    if (this.opts.engine) return this.opts.engine.installed()
    const rt = this.opts.runtime!
    return existsSync(rt.python) && existsSync(join(rt.root, 'tui_gateway'))
  }

  /** Downloads and installs Hermes on first start (no-op when installed or when a fixed engine is used). */
  async prepareEngine(): Promise<HermesRuntime> {
    if (!this.opts.engine) return this.runtime()
    return this.opts.engine.prepare((p) => this.opts.emit.engineProgress?.(p))
  }

  private runtimeDir(): string {
    return this.opts.runtimeDir ?? join(this.opts.paths.hermesHome, 'tools')
  }

  /** agent-browser lives in Hermes' tool runtime; install it with Hermes' own package manager when missing. */
  async ensureBrowserRuntime(): Promise<boolean> {
    const dir = this.runtimeDir()
    const has = () => existsSync(dir) && readdirSync(dir).some((n) => n.startsWith('agent-browser-'))
    if (has()) return true
    const env = buildHermesEnv({ base: this.opts.baseEnv, hermesHome: this.opts.paths.hermesHome, runtimeDir: dir, cacheDir: join(this.opts.paths.data, 'cache') })
    mkdirSync(this.opts.paths.hermesHome, { recursive: true })
    await new Promise<void>((resolve) => {
      const child = spawn(this.runtime().python, ['-m', 'hermes_cli.main', 'pm', 'install', 'agent-browser'], { cwd: this.runtime().root, env, stdio: 'ignore', windowsHide: true })
      child.on('exit', () => resolve())
      child.on('error', () => resolve())
    })
    return has() // without it Tomo still works; only web tasks are off
  }

  async startEngine(restart = false): Promise<void> {
    const moved = evacuateDotenv(this.opts.paths.hermesHome)
    if (Object.keys(moved).length) this.secrets.update((d) => { Object.assign(d.keys, moved) })
    const secrets = this.secrets.read()
    this.masker = new Masker(secrets.identifiers)
    const packId = this.settings.read().packId
    if (packId) { try { refreshBundledPack(this.opts.packsSourceDir, this.opts.paths.data, packId) } catch { /* keep the installed copy */ } }
    const pack = this.installedPack()
    if (this.settings.read().setupDone) refreshProfile(this.opts.paths.hermesHome, this.opts.pluginsDir, pack, secrets.identifiers.map((i) => i.name))
    const browsers = (await import('./browsers')).findBrowsers(process.platform, this.opts.baseEnv.HOME ?? '', this.opts.baseEnv)
    const env = buildHermesEnv({
      base: this.opts.baseEnv,
      hermesHome: this.opts.paths.hermesHome,
      runtimeDir: this.runtimeDir(),
      cacheDir: join(this.opts.paths.data, 'cache'),
      keys: secrets.keys,
      privatePayload: privatePayload(secrets.identifiers, pack, this.settings.read().answers),
      browser: { executablePath: browsers[0]?.path, profileDir: this.opts.paths.browserProfile },
    })
    if (this.hermes && restart) await this.hermes.stopAndWait()
    if (!this.hermes || restart) {
      this.hermes = new HermesProcess({
        runtime: this.runtime(),
        env,
        // Windows: ties the browser and terminal commands to the engine's lifetime (see the script)
        launcher: join(this.helpersDir(), 'tomo_gateway.py'),
        autoRestart: true,
        onServerRequest: (method, params) => this.onServerRequest(method, params),
      })
      this.hermes.on('state', (st) => { if (st !== 'ready') this.runningTurns.clear(); this.opts.emit.engineState(st) })
      this.client = new HermesClient(this.hermes, this.masker)
      this.hermes.on('event', (raw) => this.forwardEvent(raw))
    }
    await this.hermes.start()
  }

  private helpersDir(): string {
    return this.opts.helpersDir ?? join(this.opts.pluginsDir, '..', 'engine-helpers')
  }

  async stopEngine(): Promise<void> {
    await this.hermes?.stopAndWait()
  }

  diagnostics(): string {
    // stderr can echo tool output; mask it like everything else that leaves the engine
    return this.masker.mask(this.hermes?.diagnostics() ?? 'engine not started')
  }

  private forwardEvent(raw: GatewayEvent): void {
    if (!raw.session_id) return
    const e = this.masker.maskAny(raw)
    if (e.type === 'session.info' || e.type === 'session.title') {
      const title = (e.payload as { title?: string })?.title
      if (title) this.opts.emit.chat(raw.session_id, { kind: 'title', title })
      return
    }
    const ev = toTurnEvent(e)
    if (!ev) return
    if (ev.kind === 'complete' || ev.kind === 'error') this.runningTurns.delete(raw.session_id)
    this.study.event(raw.session_id, ev)
    this.opts.emit.chat(raw.session_id, ev)
  }

  // ------------------------------------------------------------------ server → client requests
  private onServerRequest(method: string, params: unknown): Promise<unknown> {
    const p = this.masker.maskAny((params ?? {}) as Record<string, unknown>)
    if (method === 'approval' || method === 'clarify') {
      const id = `req-${++this.requestSeq}`
      return new Promise((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject })
        this.opts.emit.request({ id, method, sessionId: p.session_id as string | undefined, params: p })
      })
    }
    // `secret` would make Hermes write the value into HERMES_HOME/.env; keys are only set in Tomo's key sheet.
    // sudo, vault and desktop-window bridges do not exist in Tomo.
    return Promise.resolve({ value: '' })
  }

  respond(id: string, result: unknown): void {
    const p = this.pendingRequests.get(id)
    if (!p) return
    this.pendingRequests.delete(id)
    p.resolve(result)
  }

  // ------------------------------------------------------------------ chat
  displayValues(): Record<string, string> {
    return Object.fromEntries(this.secrets.read().identifiers.map((i) => [i.name, i.values[0] ?? '']))
  }

  private get rpcClient(): HermesClient {
    if (!this.client || this.hermes?.state !== 'ready') throw new Error('The AI engine is not running.')
    return this.client
  }

  async listSessions(): Promise<SessionRow[]> {
    const res = await this.hermes!.rpc.request('session.list', { limit: 50 })
    return res.sessions
      .filter((r) => r.title !== 'Tomo provider check')
      .map((r) => ({ id: r.id, title: this.masker.mask(r.title || r.preview || ''), startedAt: r.started_at, messageCount: r.message_count }))
  }

  async createSession(): Promise<string> {
    const { session_id } = await this.rpcClient.createSession()
    return session_id
  }

  async history(sessionId: string): Promise<HistoryMessage[]> {
    const res = await this.hermes!.rpc.request('session.resume', { session_id: sessionId })
    return res.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
      .filter((m) => m.display_kind !== 'hidden')
      .map((m) => ({ role: m.role as HistoryMessage['role'], text: this.masker.mask(String(m.text ?? '')), name: m.name ?? undefined }))
      .filter((m) => m.role !== 'assistant' || m.text.trim())
  }

  /** Sessions with a turn in progress (asked before quitting on close). */
  private readonly runningTurns = new Set<string>()
  get busy(): boolean {
    return this.runningTurns.size > 0 && this.hermes?.state === 'ready'
  }

  async send(sessionId: string, text: string, topic?: string): Promise<void> {
    this.runningTurns.add(sessionId)
    this.study.turnStarted(sessionId, topic ?? null)
    await this.rpcClient.submit(sessionId, text) // masked inside HermesClient
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.rpcClient.interrupt(sessionId)
  }

  // ------------------------------------------------------------------ settings
  async listModels() {
    return listModels(this.hermes!.rpc)
  }

  async setModel(model: string): Promise<void> {
    const s = this.settings.read()
    if (!s.provider) throw new Error('No provider')
    const provider = providerConfig(s.provider).model.provider as string
    const sessionId = await this.createSession()
    await setModel(this.hermes!.rpc, sessionId, model, provider)
    this.settings.update((st) => { st.provider = { ...st.provider!, model } })
  }

  async setReasoning(level: Reasoning): Promise<void> {
    await setReasoning(this.hermes!.rpc, level)
    this.settings.update((st) => { st.provider = { ...st.provider!, reasoning: level } })
  }

  userMemory(): string[] {
    const file = join(this.opts.paths.hermesHome, 'memories', 'USER.md')
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8').split('\n§\n').map((e) => e.trim()).filter(Boolean)
  }

  /** Export: settings (no secrets), what Tomo remembers, and the chat list — identifiers stay placeholders. */
  async exportData(target: string): Promise<string> {
    const data = {
      exported_at: new Date().toISOString(),
      settings: { ...this.settings.read() },
      memory: this.userMemory(),
      chats: this.hermes?.state === 'ready' ? await this.listSessions() : [],
    }
    writeFileSync(target, JSON.stringify(data, null, 2))
    return target
  }

  async deleteData(scope: 'chats' | 'everything'): Promise<void> {
    await this.stopEngine()
    if (scope === 'chats') {
      for (const f of ['state.db', 'state.db-wal', 'state.db-shm', 'sessions']) rmSync(join(this.opts.paths.hermesHome, f), { recursive: true, force: true })
      await this.startEngine(true)
      return
    }
    for (const name of readdirSync(this.opts.paths.data)) rmSync(join(this.opts.paths.data, name), { recursive: true, force: true })
  }
}
