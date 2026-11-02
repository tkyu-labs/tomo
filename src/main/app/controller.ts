import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppState, AnswerMode, ChatEvent, EngineRequest, FinishTask, HistoryMessage, PackSummary, Prefs, ProviderChoice,
  Reasoning, SessionRow, TaskUpdate,
} from '@shared/ipc'
import { identifiersFrom } from '@shared/pack/hatch'
import type { Answers } from '@shared/pack/types'
import { Masker } from '@shared/privacy/masker'
import { HermesClient, toTurnEvent } from '../hermes/client'
import { buildHermesEnv } from '../hermes/env'
import { HermesProcess, type HermesRuntime } from '../hermes/process'
import type { GatewayEvent } from '../hermes/rpc'
import { installPack, loadPack, type LoadedPack } from '../pack/pack'
import type { TomoPaths } from '../paths'
import { SecretStore, type Encryptor } from '../secrets/store'
import { evacuateDotenv } from '../setup/home'
import { listModels, setModel, setReasoning } from '../setup/model'
import { privatePayload, writeProfile } from '../setup/profile'
import { PROVIDER_KEY_ENV, providerConfig } from '../setup/providers'
import { SettingsFile, type Settings } from './settings'

export const HERMES_VERSION = '0.21.7'

export interface ControllerOptions {
  paths: TomoPaths
  runtime: HermesRuntime
  encryptor: Encryptor
  /** Folder with tomo-packs `packs/<id>` directories (dev: the local checkout; app: bundled). */
  packsSourceDir: string
  /** Folder holding Tomo's Hermes plugins (`plugins/tomo-privacy`, …). */
  pluginsDir: string
  /** Base environment for the gateway (the app's own environment). */
  baseEnv: Record<string, string | undefined>
  gakuenUrl?: string
  /** UI sinks */
  emit: {
    chat(sessionId: string, e: ChatEvent): void
    request(r: EngineRequest): void
    setupTask(u: TaskUpdate): void
    engineState(state: AppState['engine']['state']): void
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

  constructor(private readonly opts: ControllerOptions) {
    mkdirSync(opts.paths.data, { recursive: true })
    this.settings = new SettingsFile(join(opts.paths.data, 'settings.json'))
    this.secrets = new SecretStore(opts.paths.secretStore, opts.encryptor)
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
      engine: { state: this.hermes?.state ?? 'stopped', version: HERMES_VERSION },
      answerMode: s.answerMode,
    }
  }

  setPrefs(prefs: Partial<Prefs>): void {
    this.settings.update((s) => { s.prefs = { ...s.prefs, ...prefs } })
  }

  setAnswerMode(mode: AnswerMode): void {
    this.settings.update((s) => { s.answerMode = mode })
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
      await step('engine', () => {
        if (!existsSync(this.opts.runtime.python)) throw new Error('The AI engine is missing from this installation.')
        return `Hermes ${HERMES_VERSION}`
      })
      const pack = this.installedPack()
      await step('settings', () => {
        const s = this.settings.read()
        if (!s.provider) throw new Error('No AI provider connected.')
        const keyEnv = PROVIDER_KEY_ENV[s.provider.id]
        if (keyEnv && !this.secrets.read().keys[keyEnv]) throw new Error('No key saved for the AI provider.')
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
    const res = writeProfile({ hermesHome: this.opts.paths.hermesHome, pluginsSourceDir: this.opts.pluginsDir, pack, provider: s.provider!, answers: full })
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
  async startEngine(restart = false): Promise<void> {
    const moved = evacuateDotenv(this.opts.paths.hermesHome)
    if (Object.keys(moved).length) this.secrets.update((d) => { Object.assign(d.keys, moved) })
    const secrets = this.secrets.read()
    this.masker = new Masker(secrets.identifiers)
    const pack = this.installedPack()
    const browsers = (await import('./browsers')).findBrowsers(process.platform, this.opts.baseEnv.HOME ?? '', this.opts.baseEnv)
    const env = buildHermesEnv({
      base: this.opts.baseEnv,
      hermesHome: this.opts.paths.hermesHome,
      cacheDir: join(this.opts.paths.data, 'cache'),
      keys: secrets.keys,
      privatePayload: privatePayload(secrets.identifiers, pack),
      browser: { executablePath: browsers[0]?.path, profileDir: this.opts.paths.browserProfile },
    })
    if (this.hermes && restart) await this.hermes.stopAndWait()
    if (!this.hermes || restart) {
      this.hermes = new HermesProcess({
        runtime: this.opts.runtime,
        env,
        autoRestart: true,
        onServerRequest: (method, params) => this.onServerRequest(method, params),
      })
      this.hermes.on('state', (st) => this.opts.emit.engineState(st))
      this.client = new HermesClient(this.hermes, this.masker)
      this.hermes.on('event', (raw) => this.forwardEvent(raw))
    }
    await this.hermes.start()
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
    if (ev) this.opts.emit.chat(raw.session_id, ev)
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

  async send(sessionId: string, text: string): Promise<void> {
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
