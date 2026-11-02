import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installPackArchive, releaseAssets } from './release'

const root = resolve(import.meta.dirname, '../../..')
const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-rel-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function fixtureArchive(): string {
  const out = join(tmp(), 'example-u-0.0.1.tar.gz')
  // the same layout as tomo-packs' release workflow: tar -C packs <id>
  execFileSync('tar', ['-czf', out, '-C', join(root, 'test/fixtures/packs'), 'example-u'])
  return out
}

describe('pack releases', () => {
  it('names the release assets after the tag', () => {
    expect(releaseAssets('shonan-it', '0.1.0')).toEqual({
      api: 'https://api.github.com/repos/tkyu-labs/tomo-packs/releases/tags/shonan-it%2Fv0.1.0',
      file: 'shonan-it-0.1.0.tar.gz', bundle: 'shonan-it-0.1.0.tar.gz.sigstore.json',
    })
  })

  it('installs a verified archive and checks the pack identity', async () => {
    const data = tmp()
    const seen: string[] = []
    const pack = await installPackArchive(fixtureArchive(), 'bundle.json', 'example-u', '0.0.1', data, async (_a, _b, p) => { seen.push(p.identity); return { ok: true } })
    expect(pack.manifest.id).toBe('example-u')
    expect(existsSync(join(data, 'packs', 'example-u', 'hatch.yaml'))).toBe(true)
    expect(seen[0]).toBe('^https://github\\.com/tkyu-labs/tomo-packs/\\.github/workflows/release\\.yml@refs/tags/example-u/v0\\.0\\.1$')
    await expect(installPackArchive(fixtureArchive(), 'b', 'example-u', '9.9.9', tmp(), async () => ({ ok: true }))).rejects.toThrow(/expected example-u 9.9.9/)
  })

  it('installs nothing when the signature check fails', async () => {
    const data = tmp()
    await expect(installPackArchive(fixtureArchive(), 'b', 'example-u', '0.0.1', data, async () => ({ ok: false, reason: 'certificate identity mismatch' }))).rejects.toThrow(/signature check/)
    expect(existsSync(join(data, 'packs'))).toBe(false)
  })
})
