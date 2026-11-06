// School pack updates from tomo-packs' main branch (src/main/pack/remote.ts). Checked at start (after a short delay)
// and every 6 hours, like the app itself. A changed pack is downloaded and checked against its pack.lock into a
// staging folder first:
// - "auto" mode installs it right away when it asks for no access the installed pack does not have, and says so;
// - an update that adds access (sites, personal data, computer use) always waits for the student's review;
// - "manual" mode only reports what is available.
// After an install the controller rebuilds SOUL.md and restarts the engine once no question is running, so the new
// skills apply from the next question.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { PackManifest } from '@shared/pack/types'
import type { PackUpdateMode, PackUpdateState } from '@shared/ipc'
import { installPack, loadPack, type LoadedPack } from './pack'
import { lockDigest, remotePack, stageRemotePack, tomoSatisfies, type RemotePack } from './remote'

const SIX_HOURS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY = 20_000

/** Access a new manifest asks for that the old one does not have (empty: the update keeps the same access). */
export function addedAccess(oldM: PackManifest, newM: PackManifest): string[] {
  const o = oldM.permissions, n = newM.permissions
  const added = (kind: string, a: string[] = [], b: string[] = []) => b.filter((x) => !a.includes(x)).map((x) => `${kind}: ${x}`)
  return [
    ...added('website', o.network, n.network),
    ...added('sign-in site', o.browser_origins, n.browser_origins),
    ...added('personal-data site', o.personal_origins, n.personal_origins),
    ...added('personal data', o.personal_data, n.personal_data),
    ...(n.computer_use && !o.computer_use ? ['computer use'] : []),
  ]
}

/** The notes of the newest section of a pack's CHANGELOG.md ("## 0.1.1 …" followed by "- …" lines). */
export function latestChangelog(packDir: string): string[] {
  const file = join(packDir, 'CHANGELOG.md')
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.startsWith('## '))
  if (start < 0) return []
  const notes: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith('## ')) break
    if (/^[-*] /.test(l)) notes.push(l.slice(2).trim())
    else if (/^\s+\S/.test(l) && notes.length) notes[notes.length - 1] += ' ' + l.trim()
  }
  return notes
}

export interface PackUpdaterOptions {
  dataDir: string
  /** The installed pack (or none). */
  installed: () => LoadedPack | undefined
  mode: () => PackUpdateMode
  /** A pack update was installed (the controller reloads the engine). */
  onInstalled: (pack: LoadedPack) => void | Promise<void>
  onState: (s: PackUpdateState) => void
  /** This Tomo's version (for the pack's `requires.tomo`). */
  tomoVersion: string
  remote?: (id: string) => Promise<RemotePack | null>
  stage?: (id: string, remote: RemotePack, stageDir: string) => Promise<LoadedPack>
}

export class PackUpdater {
  state: PackUpdateState = { checking: false }
  private staged?: LoadedPack
  private timers: ReturnType<typeof setTimeout>[] = []
  private running?: Promise<void>

  constructor(private readonly opts: PackUpdaterOptions) {}

  start(): void {
    this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_DELAY))
    this.timers.push(setInterval(() => void this.check(), SIX_HOURS))
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  /** One check (joins a running one). Never throws; errors land in the state. */
  check(): Promise<void> {
    this.running ??= this.doCheck().finally(() => { this.running = undefined })
    return this.running
  }

  private async doCheck(): Promise<void> {
    const pack = this.opts.installed()
    if (!pack) return
    const id = pack.manifest.id
    this.set({ checking: true, error: undefined })
    try {
      const remote = await (this.opts.remote ?? ((x) => remotePack(x)))(id)
      // same files as installed (pack.lock fingerprint), or not in the catalog: nothing to do
      if (!remote || remote.lock === lockDigest(pack.dir)) {
        this.staged = undefined
        return this.set({ checking: false, checkedAt: Date.now(), available: undefined, needsTomo: undefined })
      }
      if (!tomoSatisfies(remote.requiresTomo, this.opts.tomoVersion)) {
        this.staged = undefined
        return this.set({ checking: false, checkedAt: Date.now(), available: undefined, needsTomo: { version: remote.version, requires: remote.requiresTomo! } })
      }
      const stageDir = join(this.opts.dataDir, 'cache', 'pack-staging', `${id}-${remote.commit.slice(0, 12)}`)
      const staged = await (this.opts.stage ?? ((x, r, d) => stageRemotePack(x, r, this.opts.dataDir, d)))(id, remote, stageDir)
      this.staged = staged
      const access = addedAccess(pack.manifest, staged.manifest)
      const available = { version: remote.version, addedAccess: access, notes: latestChangelog(staged.dir), hatchChanged: staged.hatch.version !== pack.hatch.version }
      if (this.opts.mode() === 'auto' && access.length === 0) {
        this.set({ checking: false, checkedAt: Date.now() })
        await this.install()
      } else {
        this.set({ checking: false, checkedAt: Date.now(), available, needsTomo: undefined })
      }
    } catch (e) {
      this.set({ checking: false, checkedAt: Date.now(), error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Installs the staged update (after the student's OK, or automatically). */
  async install(): Promise<void> {
    const staged = this.staged
    if (!staged) throw new Error('No pack update is ready.')
    const before = this.opts.installed()
    const pack = installPack(staged.dir, this.opts.dataDir)
    rmSync(join(staged.dir, '..'), { recursive: true, force: true })
    this.staged = undefined
    const hatchChanged = !!before && before.hatch.version !== pack.hatch.version
    this.set({ available: undefined, installed: { version: pack.manifest.version, at: Date.now(), notes: latestChangelog(pack.dir), hatchChanged } })
    await this.opts.onInstalled(loadPack(pack.dir))
  }

  private set(patch: Partial<PackUpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.opts.onState(this.state)
  }
}
