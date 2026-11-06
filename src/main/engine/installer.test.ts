import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ENGINE_EXTRAS, EngineInstaller } from './installer'
import { HERMES_PIN } from './pin'

const root = resolve(import.meta.dirname, '../../..')
const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-engine-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('engine installer', () => {
  it('pins the same Hermes as scripts/hermes-pin.env', () => {
    const env = Object.fromEntries(readFileSync(join(root, 'scripts/hermes-pin.env'), 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => l.split('=') as [string, string]))
    expect(HERMES_PIN.commit).toBe(env.HERMES_COMMIT)
    expect(HERMES_PIN.tag).toBe(env.HERMES_TAG)
    expect(HERMES_PIN.python).toBe(env.HERMES_PYTHON)
    expect(HERMES_PIN.archiveSha256).toBe(env.HERMES_ARCHIVE_SHA256)
    expect(HERMES_PIN.archiveUrl).toContain(env.HERMES_COMMIT)
  })

  it('refuses a download whose hash does not match and installs nothing', async () => {
    const data = tmp()
    const fake = (async () => new Response('not hermes', { status: 200, headers: { 'content-length': '10' } })) as unknown as typeof fetch
    const inst = new EngineInstaller({ dataDir: data, hermesHome: join(data, 'hermes'), uv: 'uv', baseEnv: {}, fetchFn: fake })
    const seen: string[] = []
    await expect(inst.prepare((p) => seen.push(p.stage))).rejects.toThrow(/failed its check/)
    expect(seen.at(-1)).toBe('error')
    expect(inst.installed()).toBe(false)
    expect(existsSync(join(data, 'engine', 'hermes-src'))).toBe(false)
  })

  it('counts an install without the extras this Tomo needs as not installed (it is re-synced)', () => {
    const data = tmp()
    const inst = new EngineInstaller({ dataDir: data, hermesHome: join(data, 'hermes'), uv: 'uv', baseEnv: {}, platform: 'darwin' })
    mkdirSync(join(data, 'engine', 'venv', 'bin'), { recursive: true })
    writeFileSync(join(data, 'engine', 'venv', 'bin', 'python'), '')
    const mark = (extras?: string[]) => writeFileSync(join(data, 'engine', 'installed.json'), JSON.stringify({ commit: HERMES_PIN.commit, ...(extras ? { extras } : {}) }))
    mark()
    expect(inst.installed()).toBe(false)
    mark(ENGINE_EXTRAS)
    expect(inst.installed()).toBe(true)
  })
})
