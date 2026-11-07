import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppState, AnswerMode, ChatEvent, Connection, EngineProgress, EngineRequest, FallbackChoice, FinishTask, HistoryMessage, PackList, Prefs,
  MigrationState, MigrationTask, PackUpdateMode, PackUpdateState, ProviderChoice, ProviderId,
  Reasoning, SessionRow, TaskUpdate,
} from '@shared/ipc'
import { identifiersFrom } from '@shared/pack/hatch'
import { activeHatch } from '@shared/pack/core-hatch'
import type { Answers, Lang } from '@shared/pack/types'
import { Masker } from '@shared/privacy/masker'
import { HermesClient, toTurnEvent } from '../hermes/client'
import { buildHermesEnv } from '../hermes/env'
import { HermesProcess, type HermesRuntime } from '../hermes/process'
import type { GatewayEvent } from '../hermes/rpc'
import { compareVersions, installPack, loadPack, refreshBundledPack, type LoadedPack } from '../pack/pack'
import { PackUpdater, type PackUpdaterOptions } from '../pack/updater'
import type { TomoPaths } from '../paths'
import { SecretStore, type Encryptor } from '../secrets/store'
import type { PortableKey } from '../secrets/portable'
import { evacuateDotenv } from '../setup/home'
import { listModels, setModel, setReasoning } from '../setup/model'
import { privatePayload, refreshProfile, writeAnswerMode, writeConfig, writeProfile } from '../setup/profile'
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
  /** Development and tests: a local folder of `packs/<id>` directories. The app ships no packs. */
  packsSourceDir?: string
  /** Every pack tomo-packs main has, for the first-run choice (returns a folder of `<id>` dirs). */
  remotePacks?: () => Promise<string>
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
  /** "Documents/Tomo": files the student asked Tomo to keep (school PDFs, …). Default `<data>/documents`. */
  documentsDir?: string
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
    packUpdate?(s: PackUpdateState): void
    migration?(m: MigrationState): void
  }
  /** Windows portable build: the password-based key that is also `encryptor`. */
  portableKey?: PortableKey
  /** Test seams for the pack updater (default: tomo-packs releases on GitHub). */
  packUpdates?: Pick<PackUpdaterOptions, 'remote' | 'stage'>
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
  readonly packUpdater: PackUpdater
  /** A pack update was installed while a question was running: restart the engine when it ends. */
  private reloadPending = false

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
    this.packUpdater = new PackUpdater({
      dataDir: opts.paths.data,
      installed: () => (this.settings.read().setupDone ? this.installedPack() : undefined),
      mode: () => this.settings.read().packUpdateMode ?? 'auto',
      onState: (s) => this.opts.emit.packUpdate?.(s),
      onInstalled: () => this.reloadEngineWhenIdle(),
      tomoVersion: opts.appVersion ?? '0.0.0',
      ...opts.packUpdates,
    })
    this.study = new StudyLog(join(opts.paths.data, 'study', 'log.jsonl'), participant, () => {
      const s = this.settings.read()
      return { mode: s.answerMode, pack: s.packId ?? null, appVersion: opts.appVersion, model: s.provider ? `${s.provider.id}/${s.provider.model}` : null }
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
    // portable and still locked: the store cannot be read yet (no key hints until the student unlocks)
    const locked = !!this.opts.portableKey && !this.opts.portableKey.unlocked()
    const keys = locked ? {} : this.secrets.read().keys
    const hint = (id: ProviderId) => {
      const env = PROVIDER_KEY_ENV[id]
      const key = env ? keys[env] : undefined
      return key ? `${key.slice(0, 3)}…${key.slice(-4)}` : undefined
    }
    return {
      setupDone: s.setupDone,
      prefs: s.prefs,
      provider: s.provider,
      keyHint: s.provider ? hint(s.provider.id) : undefined,
      connections: connectionsOf(s).map((c) => ({ ...c, keyHint: hint(c.id) })),
      fallback: fallbackOf(s),
      gakuenAvailable: !!this.gakuenUrl(s),
      pack: pack ? { id: pack.manifest.id, manifest: pack.manifest, hatch: pack.hatch } : undefined,
      engine: { state: this.hermes?.state ?? 'stopped', version: HERMES_VERSION, installed: this.engineInstalled(), progress: this.opts.engine?.last },
      answerMode: s.answerMode,
      packUpdate: { ...this.packUpdater.state, mode: s.packUpdateMode ?? 'auto' },
      hatchPending: !!s.hatchPending,
      migration: this.migration,
      portable: this.opts.portableKey ? { enabled: true, hasPassword: this.opts.portableKey.hasPassword(), unlocked: this.opts.portableKey.unlocked() } : { enabled: false, hasPassword: false, unlocked: true },
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
  /** Where each pack offered by the last listPacks() comes from (the copy fetched from tomo-packs main, or a local dev folder). */
  private packSources = new Map<string, string>()

  /**
   * The packs a student can choose: what tomo-packs main has now (Tomo ships no packs, so a new school needs no Tomo
   * update), plus a local folder in development and tests (the newer version wins). `offline`: main could not be read
   * (no network, or nothing after 15 s); the student can try again or continue without a pack.
   */
  async listPacks(): Promise<PackList> {
    const found = new Map<string, LoadedPack>()
    const addFrom = (dir: string) => {
      if (!existsSync(dir)) return
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || !existsSync(join(dir, d.name, 'pack.yaml'))) continue
        try {
          const p = loadPack(join(dir, d.name))
          const have = found.get(p.manifest.id)
          if (!have || compareVersions(p.manifest.version, have.manifest.version) > 0) found.set(p.manifest.id, p)
        } catch { /* a pack this Tomo cannot read is not offered */ }
      }
    }
    if (this.opts.packsSourceDir) addFrom(this.opts.packsSourceDir)
    let offline = false
    if (this.opts.remotePacks) {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15_000).unref?.())
      try { addFrom(await Promise.race([this.opts.remotePacks(), timeout])) } catch { offline = true }
    }
    this.packSources = new Map([...found].map(([id, p]) => [id, p.dir]))
    return { packs: [...found.values()].map((p) => ({ id: p.manifest.id, manifest: p.manifest, hatch: p.hatch })), ...(offline ? { offline } : {}) }
  }

  selectPack(id: string | null): void {
    if (id) {
      const source = this.packSources.get(id) ?? (this.opts.packsSourceDir && join(this.opts.packsSourceDir, id))
      if (!source || !existsSync(join(source, 'pack.yaml'))) throw new Error(`The school pack ${id} is not available. Check the network and try again.`)
      installPack(source, this.opts.paths.data)
    }
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

  /** The connected provider becomes the one in use. In first-run setup it is the only connection. */
  connectProvider(choice: ProviderChoice, key?: string, models?: string[]): void {
    const sel = { ...choice }
    if (sel.id === 'gakuen') sel.baseUrl = this.gakuenUrl()
    providerConfig(sel) // throws early on a missing base URL
    const keyEnv = PROVIDER_KEY_ENV[sel.id]
    if (keyEnv && key) this.secrets.setKey(keyEnv, key.trim())
    this.settings.update((s) => {
      const conn = { ...sel, ...(models?.length ? { models } : {}) }
      s.connections = s.setupDone ? [...connectionsOf(s).filter((c) => c.id !== sel.id), conn] : [conn]
      s.provider = sel
    })
  }

  // ------------------------------------------------------------------ Settings → Model & usage
  async addProvider(choice: ProviderChoice, key?: string, models?: string[]): Promise<void> {
    this.connectProvider(choice, key, models)
    await this.applyProviders()
  }

  async useProvider(id: ProviderId): Promise<void> {
    this.settings.update((s) => {
      const conn = connectionsOf(s).find((c) => c.id === id)
      if (!conn) throw new Error('This provider is not connected.')
      const { models: _models, ...choice } = conn
      s.provider = choice
    })
    await this.applyProviders()
  }

  async removeProvider(id: ProviderId): Promise<void> {
    const s = this.settings.read()
    if (s.provider?.id === id) throw new Error('The provider in use cannot be removed; use another one first.')
    this.settings.update((st) => {
      st.connections = connectionsOf(st).filter((c) => c.id !== id)
      if (st.fallbackPick && st.fallbackPick !== 'off' && st.fallbackPick.id === id) delete st.fallbackPick
    })
    const keyEnv = PROVIDER_KEY_ENV[id]
    if (keyEnv) this.secrets.setKey(keyEnv, undefined)
    await this.applyProviders()
  }

  async setFallback(choice: FallbackChoice | null): Promise<void> {
    this.settings.update((s) => { s.fallbackPick = choice ?? 'off' })
    await this.applyProviders()
  }

  // ------------------------------------------------------------------ migration after an update
  private migration: MigrationState = { active: false, tasks: { engine: 'pending', tools: 'pending', data: 'pending', start: 'pending' }, percent: 0 }
  private migrating?: Promise<void>

  /** Something to do on this start after an update: another engine, extras or tools (first installs are not this). */
  migrationNeeded(): boolean {
    return this.settings.read().setupDone && !!this.opts.engine?.needsMigration()
  }

  private setMigration(patch: Partial<MigrationState>, task?: [MigrationTask, MigrationState['tasks'][MigrationTask]]): void {
    this.migration = { ...this.migration, ...patch, tasks: task ? { ...this.migration.tasks, [task[0]]: task[1] } : { ...this.migration.tasks, ...patch.tasks } }
    this.opts.emit.migration?.(this.migration)
  }

  private onMigrationProgress(p: EngineProgress): void {
    if (!this.migration.active || this.migration.error) return
    if (p.stage === 'browser') this.setMigration({ percent: 100, tasks: { ...this.migration.tasks, engine: 'done', tools: 'running' } })
    else if (p.stage !== 'done' && p.stage !== 'error') this.setMigration({ percent: p.percent }, ['engine', 'running'])
  }

  /** New engine (next to the old one), new tools, data format, start; the old engine is deleted only after the start. */
  migrate(): Promise<void> {
    this.migrating ??= this.doMigrate().finally(() => { this.migrating = undefined })
    return this.migrating
  }

  private async doMigrate(): Promise<void> {
    const engine = this.opts.engine!
    const s = this.settings.read()
    const app = this.opts.appVersion ? { from: s.lastAppVersion && s.lastAppVersion !== this.opts.appVersion ? s.lastAppVersion : undefined, to: this.opts.appVersion } : undefined
    this.setMigration({ active: true, error: undefined, rolledBack: false, percent: 0, engine: engine.versions(), app, tasks: { engine: 'running', tools: 'pending', data: 'pending', start: 'pending' } })
    let task: MigrationTask = 'engine'
    try {
      await this.prepareEngine()
      this.setMigration({ percent: 100, tasks: { engine: 'done', tools: 'done', data: 'running', start: 'pending' } })
      task = 'data'
      // data format changes go here (none yet); settings are read with defaults, so older files keep working
      this.setMigration({}, ['data', 'done'])
      task = 'start'
      this.setMigration({}, ['start', 'running'])
      await this.startEngine(true)
      engine.commit()
      this.settings.update((st) => { st.lastAppVersion = this.opts.appVersion })
      this.setMigration({ active: false }, ['start', 'done'])
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // the new engine did not work: back to the previous one, so Tomo stays usable while the student retries
      const rolledBack = engine.rollback()
      if (rolledBack) await this.startEngine(true).catch(() => undefined)
      this.setMigration({ error: message, rolledBack }, [task, 'error'])
    }
  }

  /** "Use Tomo anyway" after a rollback: close the screen (the next start offers the migration again). */
  dismissMigration(): void {
    if (this.migration.rolledBack) this.setMigration({ active: false })
  }

  // ------------------------------------------------------------------ Windows portable (password instead of DPAPI)
  private get portableKey(): PortableKey {
    if (!this.opts.portableKey) throw new Error('Not the portable build.')
    return this.opts.portableKey
  }

  /** First run: the password that protects the secret store from now on. */
  setPortablePassword(password: string): void {
    this.portableKey.create(password)
  }

  /** Every start: unlock, then start the engine (it needs the keys). */
  async unlockPortable(password: string): Promise<boolean> {
    if (!this.portableKey.unlock(password)) return false
    if (this.migrationNeeded()) void this.migrate()
    else if (this.settings.read().setupDone) await this.startEngine().catch(() => undefined)
    return true
  }

  changePortablePassword(current: string, next: string): boolean {
    return this.portableKey.change(current, next, () => JSON.stringify(this.secrets.read()), (plain) => this.secrets.write(JSON.parse(plain)))
  }

  /** Forgotten password: chats and memory stay; keys and identifiers go, and the first-run setup asks for them again. */
  async resetPortable(): Promise<void> {
    await this.stopEngine()
    rmSync(this.opts.paths.secretStore, { force: true })
    this.portableKey.reset()
    this.settings.update((s) => { s.setupDone = false; s.provider = undefined; s.connections = undefined })
  }

  // ------------------------------------------------------------------ school pack updates
  setPackUpdateMode(mode: PackUpdateMode): void {
    this.settings.update((s) => { s.packUpdateMode = mode })
  }

  /** A new pack is in place: SOUL.md and plugins are rebuilt at engine start, so restart it between questions. */
  async reloadEngineWhenIdle(): Promise<void> {
    if (!this.hermes || this.hermes.state === 'stopped') return
    if (this.runningTurns.size > 0) { this.reloadPending = true; return }
    this.reloadPending = false
    await this.startEngine(true)
  }

  /** Rewrites config.yaml for the provider in use and the fallback, and restarts a running engine (keys are env). */
  private async applyProviders(): Promise<void> {
    const s = this.settings.read()
    if (!s.setupDone || !s.provider) return
    writeConfig(this.opts.paths.hermesHome, s.provider, fallbackSelection(s), this.installedPack(s))
    if (this.hermes && this.hermes.state !== 'stopped') await this.startEngine(true)
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
        const hatch = activeHatch(pack?.hatch)
        const identifiers = identifiersFrom(hatch, answers)
        const idQuestions = new Set(hatch.questions.filter((q) => q.type === 'identifier').map((q) => q.id))
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
    this.settings.update((s) => { s.setupDone = true; delete s.hatchPending })
  }

  /**
   * One school pack at a time. Removing it deletes the pack and everything that came from it: its files (skills,
   * SOUL fragment), the answers to its Hatch and the identifiers it defined. Chats and Hermes' own memory of the
   * conversations stay. The general Hatch runs next (hatchPending); its Finish rewrites SOUL, USER.md and the config.
   */
  async removePack(): Promise<void> {
    const s = this.settings.read()
    if (!s.packId) return
    rmSync(join(this.opts.paths.data, 'packs', s.packId), { recursive: true, force: true })
    this.settings.update((st) => { st.packId = undefined; st.answers = {}; st.hatchPending = true })
    this.secrets.update((d) => { d.identifiers = [] })
    this.masker = new Masker([])
    this.packUpdater.state = { checking: false }
  }

  private writeProfile(answers?: Answers): string {
    const s = this.settings.read()
    const pack = this.installedPack(s)
    const full = { ...s.answers, ...(answers ?? {}) }
    // identifier answers come back from the secret store when not given (e.g. on a later config rewrite)
    if (!answers) {
      for (const q of activeHatch(pack?.hatch).questions.filter((x) => x.type === 'identifier')) {
        const entry = this.secrets.read().identifiers.find((i) => i.name === q.variable)
        if (entry) full[q.id] = entry.kind === 'name' ? { name: entry.values[0] ?? '', furigana: entry.values[1] ?? '' } : entry.values[0]
      }
    }
    const res = writeProfile({ hermesHome: this.opts.paths.hermesHome, pluginsSourceDir: this.opts.pluginsDir, pack, provider: s.provider!, fallback: fallbackSelection(s), answers: full, answerMode: s.answerMode, locale: s.prefs.locale })
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
    return this.opts.engine.prepare((p) => { this.opts.emit.engineProgress?.(p); this.onMigrationProgress(p) })
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
    this.opts.engine?.cleanupStale() // old engine folders a previous switch could not delete
    const moved = evacuateDotenv(this.opts.paths.hermesHome)
    if (Object.keys(moved).length) this.secrets.update((d) => { Object.assign(d.keys, moved) })
    const secrets = this.secrets.read()
    this.masker = new Masker(secrets.identifiers)
    const packId = this.settings.read().packId
    // development / tests: edits in the local packs folder reach the installed copy (the app updates from main instead)
    if (packId && this.opts.packsSourceDir) { try { refreshBundledPack(this.opts.packsSourceDir, this.opts.paths.data, packId) } catch { /* keep the installed copy */ } }
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
      folders: { downloads: join(this.opts.paths.data, 'downloads'), documents: this.opts.documentsDir ?? join(this.opts.paths.data, 'documents') },
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
    if (e.type === 'status.update') {
      // Hermes: "⚠️ Model fallback: <model> via <provider> unavailable (…); using <model> via <provider>." on the
      // first reply from the fallback (agent/chat_completion_helpers.py). Tomo has one fallback, so this is it.
      const text = String((e.payload as { text?: string })?.text ?? '')
      const s = this.settings.read()
      const fb = fallbackOf(s)
      if (/Model fallback:/.test(text) && fb && s.provider) {
        const ev: ChatEvent = { kind: 'fallback', provider: fb.id, model: fb.model, from: s.provider.id }
        this.study.event(raw.session_id, ev)
        this.opts.emit.chat(raw.session_id, ev)
      }
      return
    }
    const ev = toTurnEvent(e)
    if (!ev) return
    if (ev.kind === 'complete' || ev.kind === 'error') {
      this.runningTurns.delete(raw.session_id)
      if (this.reloadPending && this.runningTurns.size === 0) setTimeout(() => void this.reloadEngineWhenIdle(), 500)
    }
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
    this.settings.update((st) => {
      st.provider = { ...st.provider!, model }
      st.connections = connectionsOf(st).map((c) => (c.id === st.provider!.id ? { ...c, model } : c))
    })
  }

  async setReasoning(level: Reasoning): Promise<void> {
    await setReasoning(this.hermes!.rpc, level)
    this.settings.update((st) => {
      st.provider = { ...st.provider!, reasoning: level }
      st.connections = connectionsOf(st).map((c) => (c.id === st.provider!.id ? { ...c, reasoning: level } : c))
    })
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
    this.opts.portableKey?.reset()
  }
}

/** Connected providers; settings from before connections existed hold only the one in use. */
export function connectionsOf(s: Settings): Connection[] {
  return s.connections ?? (s.provider ? [s.provider] : [])
}

/** Fallback is on by default: the student's pick, else the first other connection with its model; 'off' turns it off. */
export function fallbackOf(s: Settings): FallbackChoice | null {
  if (s.fallbackPick === 'off' || !s.provider) return null
  const others = connectionsOf(s).filter((c) => c.id !== s.provider!.id)
  const picked = s.fallbackPick ? others.find((c) => c.id === (s.fallbackPick as FallbackChoice).id) : undefined
  if (picked) return { id: picked.id, model: (s.fallbackPick as FallbackChoice).model }
  const first = others[0]
  return first ? { id: first.id, model: first.model } : null
}

function fallbackSelection(s: Settings): ProviderChoice | undefined {
  const fb = fallbackOf(s)
  const conn = fb ? connectionsOf(s).find((c) => c.id === fb.id) : undefined
  if (!fb || !conn) return undefined
  const { models: _models, ...choice } = conn
  return { ...choice, model: fb.model }
}
