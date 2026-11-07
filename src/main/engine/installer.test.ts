import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ENGINE_EXTRAS, EngineInstaller, enginePmPackages } from './installer'
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
    const urls: string[] = []
    const fake = (async (u: string) => { urls.push(u); return new Response('not hermes', { status: 200, headers: { 'content-length': '10' } }) }) as unknown as typeof fetch
    const inst = new EngineInstaller({ dataDir: data, hermesHome: join(data, 'hermes'), uv: 'uv', baseEnv: {}, fetchFn: fake })
    const seen: string[] = []
    await expect(inst.prepare((p) => seen.push(p.stage))).rejects.toThrow(/failed its check/)
    expect(seen.at(-1)).toBe('error')
    expect(inst.installed()).toBe(false)
    expect(existsSync(join(data, 'engine', 'hermes-src'))).toBe(false)
    // Tomo's mirror first; a file failing the pinned hash there sends it to GitHub, which fails the check too
    expect(urls).toEqual([`https://tomo.gakuen.ac/downloads/hermes/${HERMES_PIN.commit}.tar.gz`, HERMES_PIN.archiveUrl])
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

  // fake engine folders: only the files installed()/runtime() look at
  const fakeEngine = (data: string, folder: string) => {
    mkdirSync(join(data, 'engine', folder, 'venv', 'bin'), { recursive: true })
    writeFileSync(join(data, 'engine', folder, 'venv', 'bin', 'python'), '')
    mkdirSync(join(data, 'engine', folder, 'hermes-src'), { recursive: true })
  }
  const markerOf = (data: string) => JSON.parse(readFileSync(join(data, 'engine', 'installed.json'), 'utf8'))

  it('an older engine (flat layout, other commit) means a migration; the runtime stays on it until the switch', () => {
    const data = tmp()
    const inst = new EngineInstaller({ dataDir: data, hermesHome: join(data, 'hermes'), uv: 'uv', baseEnv: {}, platform: 'darwin' })
    expect(inst.needsMigration()).toBe(false) // nothing installed yet: a first install, not a migration
    fakeEngine(data, '')
    writeFileSync(join(data, 'engine', 'installed.json'), JSON.stringify({ commit: 'old', tag: 'v0.20.0', extras: [] }))
    expect(inst.installed()).toBe(false)
    expect(inst.needsMigration()).toBe(true)
    expect(inst.versions()).toEqual({ from: 'v0.20.0', to: HERMES_PIN.tag })
    expect(inst.runtime().python).toBe(join(data, 'engine', 'venv', 'bin', 'python'))
  })

  it('rollback goes back to the previous engine; commit deletes it (flat layout: source and venv only)', () => {
    const data = tmp()
    const inst = new EngineInstaller({ dataDir: data, hermesHome: join(data, 'hermes'), uv: 'uv', baseEnv: {}, platform: 'darwin' })
    const dir = HERMES_PIN.commit.slice(0, 12)
    fakeEngine(data, '')
    fakeEngine(data, dir)
    mkdirSync(join(data, 'engine', 'python'), { recursive: true }) // shared Python stays
    const switched = { commit: HERMES_PIN.commit, tag: HERMES_PIN.tag, extras: ENGINE_EXTRAS, pm: enginePmPackages('darwin'), dir, previous: { commit: 'old', tag: 'v0.20.0', extras: [] } }
    writeFileSync(join(data, 'engine', 'installed.json'), JSON.stringify(switched))
    expect(inst.installed()).toBe(true)
    expect(inst.runtime().python).toBe(join(data, 'engine', dir, 'venv', 'bin', 'python'))
    // the new engine did not start
    expect(inst.rollback()).toBe(true)
    expect(inst.runtime().python).toBe(join(data, 'engine', 'venv', 'bin', 'python'))
    expect(inst.needsMigration()).toBe(true)
    // it did start
    writeFileSync(join(data, 'engine', 'installed.json'), JSON.stringify(switched))
    inst.commit()
    expect(existsSync(join(data, 'engine', 'hermes-src'))).toBe(false)
    expect(existsSync(join(data, 'engine', 'venv'))).toBe(false)
    expect(existsSync(join(data, 'engine', 'python'))).toBe(true)
    expect(existsSync(join(data, 'engine', dir, 'venv'))).toBe(true)
    expect(markerOf(data).previous).toBeUndefined()
    expect(inst.rollback()).toBe(false)
  })

  it('a new tool in the list means a migration', () => {
    const data = tmp()
    const inst = new EngineInstaller({ dataDir: data, hermesHome: join(data, 'hermes'), uv: 'uv', baseEnv: {}, platform: 'darwin' })
    fakeEngine(data, 'x')
    writeFileSync(join(data, 'engine', 'installed.json'), JSON.stringify({ commit: HERMES_PIN.commit, extras: ENGINE_EXTRAS, pm: [], dir: 'x' }))
    expect(inst.needsMigration()).toBe(true)
  })

  it('a locked old folder never fails the switch: it is deleted on a later start', () => {
    const data = tmp()
    const inst = new EngineInstaller({ dataDir: data, hermesHome: join(data, 'hermes'), uv: 'uv', baseEnv: {}, platform: 'darwin' })
    const dir = HERMES_PIN.commit.slice(0, 12)
    fakeEngine(data, dir)
    fakeEngine(data, 'old')
    writeFileSync(join(data, 'engine', 'installed.json'), JSON.stringify({ commit: HERMES_PIN.commit, extras: ENGINE_EXTRAS, pm: enginePmPackages('darwin'), dir, stale: ['old'] }))
    inst.cleanupStale()
    expect(existsSync(join(data, 'engine', 'old'))).toBe(false)
    expect(markerOf(data).stale).toBeUndefined()
    expect(inst.installed()).toBe(true)
  })
})
