// macOS: install Google Chrome into ~/Applications without an administrator password.
// Download Google's official dmg, mount it read-only, verify the app's signature and Google's Team ID, copy it,
// unmount. Files Tomo downloads itself carry no quarantine flag, so the signature check replaces Gatekeeper's.
import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
export const CHROME_DMG_URL = 'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg'
export const GOOGLE_TEAM_ID = 'EQHXZ8M8AV'
export const CHROME_APP = 'Google Chrome.app'

/** codesign --verify (deep, strict) and the signing Team ID must match. */
export async function verifyApp(appPath: string, teamId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    await run('codesign', ['--verify', '--deep', '--strict', appPath])
  } catch (e) {
    return { ok: false, reason: `signature invalid: ${(e as { stderr?: string }).stderr?.trim() || String(e)}` }
  }
  const { stderr } = await run('codesign', ['-dv', '--verbose=2', appPath]).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }))
  const team = stderr.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim()
  return team === teamId ? { ok: true } : { ok: false, reason: `unexpected signer: ${team ?? 'none'}` }
}

export interface InstallSteps {
  download(url: string, file: string): Promise<void>
  mount(dmg: string): Promise<string>
  unmount(volume: string): Promise<void>
  verify(app: string): Promise<{ ok: boolean; reason?: string }>
}

export const realSteps: InstallSteps = {
  async download(url, file) {
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file))
  },
  async mount(dmg) {
    const { stdout } = await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-plist', dmg])
    const point = [...stdout.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1]!).at(-1)
    if (!point) throw new Error('could not mount the Chrome disk image')
    return point
  },
  async unmount(volume) {
    await run('hdiutil', ['detach', '-quiet', volume]).catch(() => run('hdiutil', ['detach', '-force', '-quiet', volume]))
  },
  verify: (app) => verifyApp(app, GOOGLE_TEAM_ID),
}

/** Returns the installed app's executable. `targetDir` is ~/Applications (created if missing). */
export async function installChrome(targetDir: string, workDir: string, steps: InstallSteps = realSteps, onStage?: (s: string) => void): Promise<string> {
  mkdirSync(workDir, { recursive: true })
  const dmg = join(workDir, 'googlechrome.dmg')
  onStage?.('download')
  await steps.download(CHROME_DMG_URL, dmg)
  onStage?.('verify')
  const volume = await steps.mount(dmg)
  try {
    const source = join(volume, CHROME_APP)
    if (!existsSync(source)) throw new Error('the disk image does not contain Google Chrome')
    const check = await steps.verify(source)
    if (!check.ok) throw new Error(`refusing to install: ${check.reason}`)
    onStage?.('copy')
    mkdirSync(targetDir, { recursive: true })
    const target = join(targetDir, CHROME_APP)
    rmSync(target, { recursive: true, force: true })
    await run('ditto', [source, target]) // keeps the signature and extended attributes intact
    const again = await steps.verify(target)
    if (!again.ok) { rmSync(target, { recursive: true, force: true }); throw new Error(`copied app failed verification: ${again.reason}`) }
    return join(target, 'Contents/MacOS/Google Chrome')
  } finally {
    await steps.unmount(volume)
    rmSync(dmg, { force: true })
  }
}
