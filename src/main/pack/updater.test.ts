import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PackUpdateMode, PackUpdateState } from '@shared/ipc'
import { installPack, loadPack, type LoadedPack } from './pack'
import { latestPackRelease } from './release'
import { addedAccess, latestChangelog, PackUpdater } from './updater'

const fixture = resolve(import.meta.dirname, '../../../test/fixtures/packs/example-u')
const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-packupd-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** A copy of the fixture pack as a newer release would contain it. */
function release(version: string, edit: (yaml: string) => string = (y) => y, changelog = `# Changelog\n\n## ${version}\n\n- Clearer answers.\n- Fixed a typo\n  in the guide.\n\n## 0.0.1\n\n- First.\n`): (id: string, v: string, stageDir: string) => Promise<LoadedPack> {
  return async (_id, v, stageDir) => {
    const dir = join(stageDir, 'example-u')
    cpSync(fixture, dir, { recursive: true })
    writeFileSync(join(dir, 'pack.yaml'), edit(readFileSync(join(dir, 'pack.yaml'), 'utf8').replace('version: 0.0.1', `version: ${v}`)))
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog)
    return loadPack(dir)
  }
}

function setup(mode: PackUpdateMode, latest: string | null, stage = release(latest ?? '0.0.1')) {
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
    latest: async () => latest,
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

  it('picks the newest published release of the pack', async () => {
    const rows = [
      { tag_name: 'example-u/v0.1.0', draft: false, prerelease: false },
      { tag_name: 'example-u/v0.1.10', draft: false, prerelease: false },
      { tag_name: 'example-u/v0.1.9', draft: false, prerelease: false },
      { tag_name: 'example-u/v0.2.0', draft: true, prerelease: false },
      { tag_name: 'other/v9.0.0', draft: false, prerelease: false },
    ]
    const fetchFn = (async () => new Response(JSON.stringify(rows))) as unknown as typeof fetch
    expect(await latestPackRelease('example-u', fetchFn)).toBe('0.1.10') // 0.1.10 is newer than 0.1.9 (no carry-over)
    expect(await latestPackRelease('missing', fetchFn)).toBeNull()
  })

  it('automatic: installs an update with the same access and reports it', async () => {
    const t = setup('auto', '0.0.2')
    await t.up.check()
    expect(t.version()).toBe('0.0.2')
    expect(t.installed).toEqual(['0.0.2'])
    expect(t.up.state.installed).toMatchObject({ version: '0.0.2', notes: ['Clearer answers.', 'Fixed a typo in the guide.'], hatchChanged: false })
    expect(t.up.state.available).toBeUndefined()
  })

  it('automatic: an update that adds access waits for the review', async () => {
    const t = setup('auto', '0.1.0', release('0.1.0', (y) => y.replace('network: [www.example-u.ac.jp]', 'network: [www.example-u.ac.jp, lib.example-u.ac.jp]')))
    await t.up.check()
    expect(t.version()).toBe('0.0.1')
    expect(t.up.state.available).toMatchObject({ version: '0.1.0', addedAccess: ['website: lib.example-u.ac.jp'] })
    await t.up.install()
    expect(t.version()).toBe('0.1.0')
    expect(t.installed).toEqual(['0.1.0'])
  })

  it('manual: only reports; nothing newer: nothing to do', async () => {
    const m = setup('manual', '0.0.2')
    await m.up.check()
    expect(m.version()).toBe('0.0.1')
    expect(m.up.state.available?.version).toBe('0.0.2')
    const n = setup('auto', '0.0.1')
    await n.up.check()
    expect(n.up.state).toMatchObject({ checking: false, available: undefined })
    expect(n.up.state.checkedAt).toBeGreaterThan(0)
  })

  it('a failed check or signature leaves the pack as it is', async () => {
    const t = setup('auto', '0.0.2', async () => { throw new Error('The example-u pack failed its signature check: bad') })
    await t.up.check()
    expect(t.version()).toBe('0.0.1')
    expect(t.up.state.error).toMatch(/signature/)
  })
})
