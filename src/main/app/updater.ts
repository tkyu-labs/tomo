// Silent app updates from GitHub Releases (electron-updater; feed: the `publish` block in electron-builder.yml).
// Checks after start and every 6 hours, downloads in the background, installs when Tomo quits; Settings shows the
// state and offers "Restart now". macOS can only apply updates to a signed app — unsigned builds report the error and
// keep running. The AI engine is not part of the app: a new Hermes pin is installed by the engine step after restart.
import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/ipc'

const { autoUpdater } = electronUpdater
const SIX_HOURS = 6 * 60 * 60 * 1000
const RELEASES = 'https://api.github.com/repos/tkyu-labs/tomo/releases/latest'

const newer = (a: string, b: string) => {
  const p = (v: string) => v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [p(a), p(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

export class Updater {
  status: UpdateStatus = { state: 'idle', current: app.getVersion() }
  private timer?: NodeJS.Timeout

  /** beforeInstall: lets the window close for real (closing normally only hides it to the tray). */
  private portableUrl?: string

  /** portable: the Windows portable build cannot replace itself; it only reports a newer release and opens its page. */
  constructor(private readonly emit: (s: UpdateStatus) => void, private readonly beforeInstall: () => void = () => undefined, private readonly portable = false) {}

  start(): void {
    if (this.portable) {
      if (!app.isPackaged && !process.env.TOMO_UPDATE_URL) return
      void this.check()
      this.timer = setInterval(() => void this.check(), SIX_HOURS)
      return
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    // development / tests: TOMO_UPDATE_URL points at a local feed (generic provider)
    if (process.env.TOMO_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.TOMO_UPDATE_URL })
    if (!app.isPackaged && !process.env.TOMO_UPDATE_URL) return
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'up-to-date' }))
    autoUpdater.on('update-available', (i) => this.set({ state: 'downloading', available: i.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', available: i.version }))
    autoUpdater.on('error', (e) => this.set({ state: 'error', error: e.message.split('\n')[0] }))
    void this.check()
    this.timer = setInterval(() => void this.check(), SIX_HOURS)
  }

  async check(): Promise<void> {
    if (this.portable) return this.checkPortable()
    try { await autoUpdater.checkForUpdates() } catch { /* reported through the error event */ }
  }

  private async checkPortable(): Promise<void> {
    this.set({ state: 'checking' })
    try {
      const res = await fetch(process.env.TOMO_UPDATE_URL || RELEASES, { headers: { accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error(`releases unavailable (${res.status})`)
      const rel = (await res.json()) as { tag_name: string; html_url: string }
      if (newer(rel.tag_name, app.getVersion())) {
        this.portableUrl = rel.html_url
        this.set({ state: 'portable-available', available: rel.tag_name.replace(/^v/, '') })
      } else this.set({ state: 'up-to-date' })
    } catch (e) {
      this.set({ state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Quit and install the downloaded update now (otherwise it installs on the next quit). */
  installNow(): void {
    if (this.status.state === 'portable-available' && this.portableUrl) { void shell.openExternal(this.portableUrl); return }
    if (this.status.state !== 'ready') return
    this.beforeInstall()
    autoUpdater.quitAndInstall(true, true)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, current: app.getVersion() }
    this.emit(this.status)
  }
}
