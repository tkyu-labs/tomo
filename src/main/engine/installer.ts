// The AI engine (Hermes Agent) is not shipped inside Tomo. On first start Tomo downloads the pinned Hermes source
// from GitHub, checks its SHA-256, and installs it with the uv that ships with Tomo into Tomo's own data folder:
//   <data>/engine/<commit12>/hermes-src   Hermes source at the pinned commit
//   <data>/engine/<commit12>/venv         Python environment with Hermes' locked dependencies (uv sync --frozen)
//   <data>/engine/python                  the Python that uv downloads (python-build-standalone), shared
//   <data>/engine/installed.json          marker: the engine in use (commit, extras, pm tools) and the previous one
// Then the browser runtime (agent-browser) and, on Windows, Git for Windows (for the terminal tool) come from Hermes'
// own package manager (into HERMES_HOME/tools, shared by every engine). An app update reuses the engine unless the
// pin, the extras or the tool list change; then Tomo's migration step installs the new engine next to the old one,
// switches to it, and only deletes the old one once the new one has started (rollback() otherwise). Installs from
// before versioned folders (hermes-src and venv directly in <data>/engine) are read as the previous engine.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { buildHermesEnv } from '../hermes/env'
import type { HermesRuntime } from '../hermes/process'
import { HERMES_PIN, type HermesPin } from './pin'

export type EngineStage = 'download' | 'unpack' | 'install' | 'browser' | 'done' | 'error'
export interface EngineProgress { stage: EngineStage; percent: number; detail?: string }

export interface EngineInstallerOptions {
  dataDir: string
  hermesHome: string
  /** The uv binary that ships with Tomo. */
  uv: string
  baseEnv: Record<string, string | undefined>
  platform?: NodeJS.Platform
  pin?: HermesPin
  fetchFn?: typeof fetch
}

/** Optional Hermes extras Tomo needs (pyproject.toml, locked in uv.lock): ddgs = DuckDuckGo web search, no key. */
export const ENGINE_EXTRAS = ['ddgs']
/** Tools from Hermes' package manager Tomo needs (adding one here makes the next start run the migration). */
export const enginePmPackages = (platform: NodeJS.Platform) => ['agent-browser', ...(platform === 'win32' ? ['git'] : [])]

interface EngineMarker {
  commit?: string
  tag?: string
  extras?: string[]
  pm?: string[]
  /** engine folder relative to <data>/engine ('' = the flat layout of older installs) */
  dir?: string
  installedAt?: string
  previous?: Omit<EngineMarker, 'previous'>
  /** old engine folders that could not be deleted yet (Windows: briefly locked); removed on a later start */
  stale?: string[]
}

const TAR = (platform: NodeJS.Platform) => (platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar')

export class EngineInstaller {
  readonly dir: string
  private readonly platform: NodeJS.Platform
  private readonly pin: HermesPin
  private running?: Promise<HermesRuntime>
  last: EngineProgress = { stage: 'download', percent: 0 }

  constructor(private readonly opts: EngineInstallerOptions) {
    this.dir = join(opts.dataDir, 'engine')
    this.platform = opts.platform ?? process.platform
    this.pin = opts.pin ?? HERMES_PIN
  }

  /** The engine folder a marker points to (the flat older layout when it has no `dir`). */
  private folder(m: EngineMarker | null): string {
    return m?.dir ? join(this.dir, m.dir) : this.dir
  }

  private runtimeIn(folder: string): HermesRuntime {
    const python = this.platform === 'win32' ? join(folder, 'venv', 'Scripts', 'python.exe') : join(folder, 'venv', 'bin', 'python')
    return { python, root: join(folder, 'hermes-src') }
  }

  /** The engine in use (after an install: the new one). */
  runtime(): HermesRuntime {
    return this.runtimeIn(this.folder(this.marker()))
  }

  private marker(): EngineMarker | null {
    try { return JSON.parse(readFileSync(join(this.dir, 'installed.json'), 'utf8')) as EngineMarker } catch { return null }
  }

  private writeMarker(m: EngineMarker): void {
    writeFileSync(join(this.dir, 'installed.json'), JSON.stringify(m, null, 2))
  }

  /** The pinned engine is installed and complete, with the extras and tools this Tomo needs. */
  installed(): boolean {
    const m = this.marker()
    return !!m && m.commit === this.pin.commit && sameSet(m.extras ?? [], ENGINE_EXTRAS) && sameSet(m.pm ?? enginePmPackages(this.platform), enginePmPackages(this.platform))
      && existsSync(this.runtime().python)
  }

  /** An engine is installed, but not the one this Tomo needs: the migration step updates it (vs. a first install). */
  needsMigration(): boolean {
    const m = this.marker()
    return !!m?.commit && !this.installed()
  }

  /** What the migration changes, for the progress screen. */
  versions(): { from?: string; to: string } {
    const m = this.marker()
    return { from: m?.tag, to: this.pin.tag }
  }

  /** The new engine did not start: use the previous one again (its folder is still there). */
  rollback(): boolean {
    const m = this.marker()
    if (!m?.previous || !existsSync(this.runtimeIn(this.folder(m.previous)).python)) return false
    this.writeMarker({ ...m.previous })
    return true
  }

  /**
   * The new engine started: delete the previous one. Never throws: a folder Windows keeps locked for a moment is
   * remembered in `stale` and removed by cleanupStale() on a later start.
   */
  commit(): void {
    const m = this.marker()
    if (!m?.previous) return
    const old = this.folder(m.previous)
    const { previous: _previous, ...current } = m
    const stale = new Set(current.stale ?? [])
    if (old !== this.folder(m) && !this.remove(old)) stale.add(m.previous.dir ?? '')
    this.writeMarker({ ...current, ...(stale.size ? { stale: [...stale] } : { stale: undefined }) })
  }

  /** Engine folders left over from an earlier switch (see commit). */
  cleanupStale(): void {
    const m = this.marker()
    if (!m?.stale?.length) return
    const left = m.stale.filter((dir) => this.folder({ dir }) !== this.folder(m) && !this.remove(this.folder({ dir })))
    this.writeMarker({ ...m, stale: left.length ? left : undefined })
  }

  /** Deletes an engine folder (the flat older layout: only its source and venv); false when it is locked. */
  private remove(folder: string): boolean {
    try {
      const opts = { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }
      if (folder === this.dir) for (const name of ['hermes-src', 'venv']) rmSync(join(folder, name), opts)
      else rmSync(folder, opts)
      return true
    } catch {
      return false
    }
  }

  /** Starts (or joins) the preparation; resolves with the runtime. Safe to call many times. */
  prepare(onProgress?: (p: EngineProgress) => void): Promise<HermesRuntime> {
    const report = (p: EngineProgress) => { this.last = p; onProgress?.(p) }
    if (this.installed()) { report({ stage: 'done', percent: 100 }); return Promise.resolve(this.runtime()) }
    this.running ??= this.install(report).catch((e: unknown) => {
      this.running = undefined
      report({ stage: 'error', percent: this.last.percent, detail: e instanceof Error ? e.message : String(e) })
      throw e
    })
    return this.running
  }

  private env(folder: string): Record<string, string> {
    return {
      ...buildHermesEnv({ base: this.opts.baseEnv, hermesHome: this.opts.hermesHome, cacheDir: join(this.opts.dataDir, 'cache') }),
      UV_PYTHON_INSTALL_DIR: join(this.dir, 'python'),
      UV_PROJECT_ENVIRONMENT: join(folder, 'venv'),
      UV_PYTHON_PREFERENCE: 'only-managed', // never pick up a Python the user installed
      UV_NO_PROGRESS: '1',
    }
  }

  private async install(report: (p: EngineProgress) => void): Promise<HermesRuntime> {
    mkdirSync(this.dir, { recursive: true })
    const m = this.marker()
    // same commit, other extras or tools (an app update that needs another optional part): only those steps, in place
    const sameCommit = m?.commit === this.pin.commit && existsSync(join(this.folder(m), 'hermes-src', 'pyproject.toml'))
    const folder = sameCommit ? this.folder(m) : join(this.dir, this.pin.commit.slice(0, 12))
    const src = join(folder, 'hermes-src')
    if (!sameCommit) {
      rmSync(folder, { recursive: true, force: true })
      mkdirSync(folder, { recursive: true })
      await this.fetchSource(report, src)
    }

    // 3. Python + locked dependencies (35–90 %): uv sync --frozen checks every package hash in uv.lock
    report({ stage: 'install', percent: 35 })
    let lines = 0
    await run(this.opts.uv, ['sync', '--frozen', '--no-dev', ...ENGINE_EXTRAS.flatMap((x) => ['--extra', x]), '--python', this.pin.python], { cwd: src, env: this.env(folder) }, () => {
      lines++
      report({ stage: 'install', percent: Math.min(88, 35 + lines) })
    })
    const rt = this.runtimeIn(folder)
    if (!existsSync(rt.python)) throw new Error('Hermes was installed but its Python is missing')

    // 4. tools from Hermes' package manager: browser runtime and, on Windows, Git Bash for the terminal tool (90–100 %)
    report({ stage: 'browser', percent: 90 })
    for (const pkg of enginePmPackages(this.platform)) {
      await run(rt.python, ['-m', 'hermes_cli.main', 'pm', 'install', pkg], { cwd: src, env: this.env(folder) }).catch(() => undefined)
    }

    // switch: the previous engine stays recorded (and on disk) until commit() after a successful start
    const strip = (x: EngineMarker): Omit<EngineMarker, 'previous'> => { const { previous: _p, ...rest } = x; return rest }
    const previous = m?.commit && !sameCommit ? strip(m) : m?.previous
    this.writeMarker({
      commit: this.pin.commit, tag: this.pin.tag, extras: ENGINE_EXTRAS, pm: enginePmPackages(this.platform),
      dir: folder === this.dir ? '' : folder.slice(this.dir.length + 1), installedAt: new Date().toISOString(),
      ...(previous ? { previous } : {}),
    })
    report({ stage: 'done', percent: 100 })
    return rt
  }

  /** Steps 1–2: download, verify and unpack the pinned source. */
  private async fetchSource(report: (p: EngineProgress) => void, src: string): Promise<void> {
    // 1. download and verify the source archive (0–30 %)
    report({ stage: 'download', percent: 0 })
    const archive = join(src, '..', 'hermes-src.tar.gz')
    const res = await (this.opts.fetchFn ?? fetch)(this.pin.archiveUrl)
    if (!res.ok || !res.body) throw new Error(`Could not download Hermes (${res.status}) from ${this.pin.archiveUrl}`)
    const total = Number(res.headers.get('content-length')) || 0
    const hash = createHash('sha256')
    let got = 0
    await pipeline(
      Readable.fromWeb(res.body as never),
      new Transform({
        transform(chunk: Buffer, _e, cb) {
          hash.update(chunk)
          got += chunk.length
          if (total) report({ stage: 'download', percent: Math.min(30, Math.round((got / total) * 30)) })
          cb(null, chunk)
        },
      }),
      createWriteStream(archive),
    )
    const sha = hash.digest('hex')
    if (sha !== this.pin.archiveSha256) { rmSync(archive, { force: true }); throw new Error(`Hermes download failed its check (SHA-256 ${sha.slice(0, 12)}…)`) }

    // 2. unpack (30–35 %)
    report({ stage: 'unpack', percent: 30 })
    const tmp = join(src, '..', 'unpack')
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp)
    await run(TAR(this.platform), ['-xzf', archive, '-C', tmp])
    rmSync(src, { recursive: true, force: true })
    renameSync(join(tmp, `hermes-agent-${this.pin.commit}`), src)
    rmSync(tmp, { recursive: true, force: true })
    rmSync(archive, { force: true })
  }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}, onLine?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    const onData = (d: Buffer) => { const s = d.toString(); err = (err + s).slice(-2000); for (const _ of s.split('\n').slice(1)) onLine?.() }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd.split(/[\\/]/).at(-1)} ${args[0]} failed (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`))))
  })
}
