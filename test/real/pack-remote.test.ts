// The real tomo-packs main branch: the commit and catalog, the source archive, and every file of the shonan-it pack
// checked against its pack.lock; the full catalog for the first-run choice. Needs network. Run: TOMO_NET_TESTS=1 npx vitest run test/real/pack-remote.test.ts
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fetchCatalogPacks, lockDigest, remotePack, stageRemotePack } from '../../src/main/pack/remote'
import { removeDir } from '../helpers/remove-dir.mjs'

const NET = !!process.env.TOMO_NET_TESTS
const dir = mkdtempSync(join(tmpdir(), 'tomo-remote-'))
afterAll(() => removeDir(dir))

describe.skipIf(!NET)('tomo-packs main', () => {
  it('stages shonan-it from main and every file matches pack.lock', async () => {
    const remote = await remotePack('shonan-it')
    expect(remote?.commit).toMatch(/^[0-9a-f]{40}$/)
    const pack = await stageRemotePack('shonan-it', remote!, dir, join(dir, 'stage'))
    expect(pack.manifest.id).toBe('shonan-it')
    expect(pack.manifest.version).toBe(remote!.version)
    expect(lockDigest(pack.dir)).toBe(remote!.lock)
  })
  it('offers every pack on main for the first-run choice, each matching its pack.lock', async () => {
    const packs = await fetchCatalogPacks(join(dir, 'catalog'), '0.1.0')
    expect(readdirSync(packs)).toEqual(expect.arrayContaining(['keio', 'shonan-it']))
  })
})
