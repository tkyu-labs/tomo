// Silent app updates (electron-updater): Tomo's download mirror first (a "generic" feed with the GitHub release's files,
// src/main/net/sources.ts), the GitHub release second.
// Checks after start and every 6 hours, downloads in the background, installs when Tomo quits; Settings shows the
// state and offers "Restart now". macOS can only apply updates to a signed app — unsigned builds report the error and
// keep running. The AI engine is not part of the app: a new Hermes pin is installed by the engine step after restart.
import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/ipc'
import { fetchFirst, mirrorBase } from '../net/sources'

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
  /** an earlier feed failed and a later one will be tried: its error is not the student's */
  private quiet = false

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
    if (!app.isPackaged && !process.env.TOMO_UPDATE_URL) return
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'up-to-date' }))
    autoUpdater.on('update-available', (i) => this.set({ state: 'downloading', available: i.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', available: i.version }))
    autoUpdater.on('error', (e) => { if (!this.quiet) this.set({ state: 'error', error: e.message.split('\n')[0] }) })
    void this.check()
    this.timer = setInterval(() => void this.check(), SIX_HOURS)
  }

  /** development / tests: TOMO_UPDATE_URL (a local generic feed) only; otherwise the mirror, then GitHub. */
  private feeds(): Parameters<typeof autoUpdater.setFeedURL>[0][] {
    if (process.env.TOMO_UPDATE_URL) return [{ provider: 'generic', url: process.env.TOMO_UPDATE_URL }]
    const m = mirrorBase()
    return [...(m ? [{ provider: 'generic' as const, url: `${m}/tomo` }] : []), { provider: 'github' as const, owner: 'tkyu-labs', repo: 'tomo' }]
  }

  async check(): Promise<void> {
    if (this.portable) return this.checkPortable()
    const feeds = this.feeds()
    for (const [i, feed] of feeds.entries()) {
      this.quiet = i < feeds.length - 1
      autoUpdater.setFeedURL(feed)
      try {
        await autoUpdater.checkForUpdates()
        this.quiet = false
        return
      } catch { /* next feed; the last one's error is reported through the error event */ }
    }
    this.quiet = false
  }

  private async checkPortable(): Promise<void> {
    this.set({ state: 'checking' })
    try {
      // the mirror's release.json ({ tag }) or GitHub's latest release ({ tag_name }), both with html_url
      const m = mirrorBase()
      const urls = process.env.TOMO_UPDATE_URL ? [process.env.TOMO_UPDATE_URL] : [...(m ? [`${m}/tomo/release.json`] : []), RELEASES]
      const res = await fetchFirst(urls, { headers: { accept: 'application/vnd.github+json' } })
      const rel = (await res.json()) as { tag_name?: string; tag?: string; html_url: string }
      const tag = rel.tag_name ?? rel.tag ?? ''
      if (newer(tag, app.getVersion())) {
        this.portableUrl = rel.html_url
        this.set({ state: 'portable-available', available: tag.replace(/^v/, '') })
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
