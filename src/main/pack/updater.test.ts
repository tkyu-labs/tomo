import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PackUpdateMode, PackUpdateState } from '@shared/ipc'
import { installPack, loadPack, type LoadedPack } from './pack'
import { lockDigest, pyJson, tomoSatisfies, verifyPackFiles, type RemotePack } from './remote'
import { addedAccess, latestChangelog, PackUpdater } from './updater'

const fixture = resolve(import.meta.dirname, '../../../test/fixtures/packs/example-u')
const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-packupd-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** A copy of the fixture pack as a newer release would contain it. */
function release(version: string, edit: (yaml: string) => string = (y) => y, changelog = `# Changelog\n\n## ${version}\n\n- Clearer answers.\n- Fixed a typo\n  in the guide.\n\n## 0.0.1\n\n- First.\n`): (id: string, r: RemotePack, stageDir: string) => Promise<LoadedPack> {
  return async (_id, r, stageDir) => {
    const v = r.version
    const dir = join(stageDir, 'example-u')
    cpSync(fixture, dir, { recursive: true })
    writeFileSync(join(dir, 'pack.yaml'), edit(readFileSync(join(dir, 'pack.yaml'), 'utf8').replace('version: 0.0.1', `version: ${v}`)))
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog)
    return loadPack(dir)
  }
}

const remote = (version: string, extra: Partial<RemotePack> = {}): RemotePack => ({ commit: 'a'.repeat(40), version, lock: 'changed', ...extra })

function setup(mode: PackUpdateMode, latest: RemotePack | null, stage = release(latest?.version ?? '0.0.1')) {
  const data = tmp()
  installPack(fixture, data)
  const states: PackUpdateState[] = []
  const installed: string[] = []
  const up = new PackUpdater({
    dataDir: data,
    installed: () => loadPack(join(data, 'packs', 'example-u')),
    mode: () => mode,
    onState: (s) => states.push(s),
    onInstalled: (p) => { installed.push(p.manifest.version) },
    tomoVersion: '0.1.0',
    remote: async () => latest,
    stage,
  })
  return { data, up, states, installed, version: () => loadPack(join(data, 'packs', 'example-u')).manifest.version }
}

describe('pack updates', () => {
  it('finds the access an update adds', () => {
    const a = loadPack(fixture).manifest
    const b = structuredClone(a)
    b.permissions.network = [...b.permissions.network, 'lib.example-u.ac.jp']
    b.permissions.personal_data = [...b.permissions.personal_data, 'library_loans']
    b.permissions.computer_use = true
    expect(addedAccess(a, a)).toEqual([])
    expect(addedAccess(a, b)).toEqual(['website: lib.example-u.ac.jp', 'personal data: library_loans', 'computer use'])
  })

  it('reads the newest changelog section', () => {
    const d = tmp()
    writeFileSync(join(d, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.1\n\n- One.\n- Two\n  continued.\n\n## 0.1.0\n\n- Old.\n')
    expect(latestChangelog(d)).toEqual(['One.', 'Two continued.'])
  })

  it('fingerprints pack.lock exactly like tools/validate.py (json.dumps sort_keys, ensure_ascii)', () => {
    expect(pyJson({ b: 1, a: 'é 学', c: [true, null] })).toBe('{"a": "\\u00e9 \\u5b66", "b": 1, "c": [true, null]}')
    // the real catalog of the tomo-packs checkout, when it is there
    const packs = resolve(import.meta.dirname, '../../../tomo-packs')
    if (existsSync(join(packs, 'catalog.json'))) {
      const entry = JSON.parse(readFileSync(join(packs, 'catalog.json'), 'utf8')).packs.find((p: { id: string }) => p.id === 'shonan-it')
      expect(lockDigest(join(packs, 'packs', 'shonan-it'))).toBe(entry.lock_sha256)
    }
  })

  it('accepts a folder only when every file matches pack.lock and the catalog', () => {
    const d = join(tmp(), 'example-u')
    cpSync(fixture, d, { recursive: true })
    const files = Object.fromEntries(['pack.yaml', 'hatch.yaml', 'soul.md'].map((f) => [f, createHash('sha256').update(readFileSync(join(d, f))).digest('hex')]))
    writeFileSync(join(d, 'pack.lock'), JSON.stringify({ pack: 'example-u', version: '0.0.1', files }))
    const lock = lockDigest(d)!
    expect(() => verifyPackFiles(d, lock)).not.toThrow()
    expect(() => verifyPackFiles(d, 'other')).toThrow(/catalog/)
    writeFileSync(join(d, 'soul.md'), 'changed')
    expect(() => verifyPackFiles(d, lock)).toThrow(/soul.md/)
  })

  it('respects requires.tomo', () => {
    expect(tomoSatisfies('>=0.1.0', '0.1.0')).toBe(true)
    expect(tomoSatisfies('>=0.1.10', '0.1.9')).toBe(false)
    expect(tomoSatisfies(undefined, '0.0.1')).toBe(true)
  })

  it('automatic: installs an update with the same access and reports it', async () => {
    const t = setup('auto', remote('0.0.2'))
    await t.up.check()
    expect(t.version()).toBe('0.0.2')
    expect(t.installed).toEqual(['0.0.2'])
    expect(t.up.state.installed).toMatchObject({ version: '0.0.2', notes: ['Clearer answers.', 'Fixed a typo in the guide.'], hatchChanged: false })
    expect(t.up.state.available).toBeUndefined()
  })

  it('automatic: an update that adds access waits for the review', async () => {
    const t = setup('auto', remote('0.1.0'), release('0.1.0', (y) => y.replace('network: [www.example-u.ac.jp]', 'network: [www.example-u.ac.jp, lib.example-u.ac.jp]')))
    await t.up.check()
    expect(t.version()).toBe('0.0.1')
    expect(t.up.state.available).toMatchObject({ version: '0.1.0', addedAccess: ['website: lib.example-u.ac.jp'] })
    await t.up.install()
    expect(t.version()).toBe('0.1.0')
    expect(t.installed).toEqual(['0.1.0'])
  })

  it('manual: only reports; nothing newer: nothing to do', async () => {
    const m = setup('manual', remote('0.0.2'))
    await m.up.check()
    expect(m.version()).toBe('0.0.1')
    expect(m.up.state.available?.version).toBe('0.0.2')
    // unchanged: the catalog fingerprint equals the installed pack.lock
    const n = setup('auto', null)
    writeFileSync(join(n.data, 'packs', 'example-u', 'pack.lock'), JSON.stringify({ pack: 'example-u', version: '0.0.1', files: {} }))
    n.up['opts'].remote = async () => remote('0.0.1', { lock: lockDigest(join(n.data, 'packs', 'example-u'))! })
    await n.up.check()
    expect(n.up.state).toMatchObject({ checking: false, available: undefined })
    expect(n.up.state.checkedAt).toBeGreaterThan(0)
  })

  it('a failed check or file check leaves the pack as it is; a newer Tomo requirement waits', async () => {
    const t = setup('auto', remote('0.0.2'), async () => { throw new Error('file does not match pack.lock: soul.md') })
    await t.up.check()
    expect(t.version()).toBe('0.0.1')
    expect(t.up.state.error).toMatch(/pack.lock/)
    // a pack that needs a newer Tomo waits
    const w = setup('auto', remote('0.2.0', { requiresTomo: '>=0.2.0' }))
    await w.up.check()
    expect(w.version()).toBe('0.0.1')
    expect(w.up.state.needsTomo).toEqual({ version: '0.2.0', requires: '>=0.2.0' })
  })
})
