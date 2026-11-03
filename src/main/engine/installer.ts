// The AI engine (Hermes Agent) is not shipped inside Tomo. On first start Tomo downloads the pinned Hermes source
// from GitHub, checks its SHA-256, and installs it with the uv that ships with Tomo into Tomo's own data folder:
//   <data>/engine/hermes-src   Hermes source at the pinned commit
//   <data>/engine/venv         Python environment with Hermes' locked dependencies (uv sync --frozen)
//   <data>/engine/python       the Python that uv downloads (python-build-standalone)
//   <data>/engine/installed.json  marker: which commit is installed
// Then the browser runtime (agent-browser) and, on Windows, Git for Windows (for the terminal tool) come from Hermes'
// own package manager. An app update reuses the engine unless the pinned commit changes.
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

  runtime(): HermesRuntime {
    const python = this.platform === 'win32' ? join(this.dir, 'venv', 'Scripts', 'python.exe') : join(this.dir, 'venv', 'bin', 'python')
    return { python, root: join(this.dir, 'hermes-src') }
  }

  /** The pinned engine is installed and complete. */
  installed(): boolean {
    try {
      const m = JSON.parse(readFileSync(join(this.dir, 'installed.json'), 'utf8')) as { commit?: string }
      return m.commit === this.pin.commit && existsSync(this.runtime().python)
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

  private env(): Record<string, string> {
    return {
      ...buildHermesEnv({ base: this.opts.baseEnv, hermesHome: this.opts.hermesHome, cacheDir: join(this.opts.dataDir, 'cache') }),
      UV_PYTHON_INSTALL_DIR: join(this.dir, 'python'),
      UV_PROJECT_ENVIRONMENT: join(this.dir, 'venv'),
      UV_PYTHON_PREFERENCE: 'only-managed', // never pick up a Python the user installed
      UV_NO_PROGRESS: '1',
    }
  }

  private async install(report: (p: EngineProgress) => void): Promise<HermesRuntime> {
    mkdirSync(this.dir, { recursive: true })
    rmSync(join(this.dir, 'installed.json'), { force: true })

    // 1. download and verify the source archive (0–30 %)
    report({ stage: 'download', percent: 0 })
    const archive = join(this.dir, 'hermes-src.tar.gz')
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
    const tmp = join(this.dir, 'unpack')
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp)
    await run(TAR(this.platform), ['-xzf', archive, '-C', tmp])
    const src = join(this.dir, 'hermes-src')
    rmSync(src, { recursive: true, force: true })
    renameSync(join(tmp, `hermes-agent-${this.pin.commit}`), src)
    rmSync(tmp, { recursive: true, force: true })
    rmSync(archive, { force: true })

    // 3. Python + locked dependencies (35–90 %): uv sync --frozen checks every package hash in uv.lock
    report({ stage: 'install', percent: 35 })
    let lines = 0
    await run(this.opts.uv, ['sync', '--frozen', '--no-dev', '--python', this.pin.python], { cwd: src, env: this.env() }, () => {
      lines++
      report({ stage: 'install', percent: Math.min(88, 35 + lines) })
    })
    if (!existsSync(this.runtime().python)) throw new Error('Hermes was installed but its Python is missing')

    // 4. browser runtime and, on Windows, Git Bash for the terminal tool (90–100 %)
    report({ stage: 'browser', percent: 90 })
    const pm = (pkg: string) => run(this.runtime().python, ['-m', 'hermes_cli.main', 'pm', 'install', pkg], { cwd: src, env: this.env() }).catch(() => undefined)
    await pm('agent-browser')
    if (this.platform === 'win32') await pm('git')

    writeFileSync(join(this.dir, 'installed.json'), JSON.stringify({ commit: this.pin.commit, tag: this.pin.tag, installedAt: new Date().toISOString() }))
    report({ stage: 'done', percent: 100 })
    return this.runtime()
  }
}

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
