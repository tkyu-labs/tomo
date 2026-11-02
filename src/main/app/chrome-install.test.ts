import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GOOGLE_TEAM_ID, installChrome, verifyApp, type InstallSteps } from './chrome-install'

const mac = process.platform === 'darwin'
const realChrome = '/Applications/Google Chrome.app'
const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-chrome-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function fakeVolume(): string {
  const vol = tmp()
  const app = join(vol, 'Google Chrome.app', 'Contents', 'MacOS')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(app, 'Google Chrome'), '#!/bin/sh\n')
  return vol
}

describe.skipIf(!mac)('Chrome install (macOS)', () => {
  it.skipIf(!existsSync(realChrome))('accepts Google-signed Chrome and rejects another signer', async () => {
    expect(await verifyApp(realChrome, GOOGLE_TEAM_ID)).toEqual({ ok: true })
    expect((await verifyApp(realChrome, 'ABCDEFGHIJ')).ok).toBe(false)
  })

  it('rejects an unsigned app', async () => {
    const res = await verifyApp(join(fakeVolume(), 'Google Chrome.app'), GOOGLE_TEAM_ID)
    expect(res.ok).toBe(false)
  })

  it('copies a verified app to the target and cleans up; refuses an unverified one', async () => {
    const vol = fakeVolume()
    const stages: string[] = []
    let unmounted = 0
    const steps = (ok: boolean): InstallSteps => ({
      download: async (_u, f) => writeFileSync(f, 'dmg'),
      mount: async () => vol,
      unmount: async () => { unmounted++ },
      verify: async () => (ok ? { ok: true } : { ok: false, reason: 'unexpected signer: none' }),
    })
    const target = join(tmp(), 'Applications')
    const exe = await installChrome(target, tmp(), steps(true), (s) => stages.push(s))
    expect(existsSync(exe)).toBe(true)
    expect(stages).toEqual(['download', 'verify', 'copy'])
    await expect(installChrome(join(tmp(), 'Applications'), tmp(), steps(false))).rejects.toThrow(/refusing to install/)
    expect(unmounted).toBe(2)
  })
})
