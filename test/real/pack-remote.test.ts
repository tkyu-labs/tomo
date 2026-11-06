// The real tomo-packs main branch: the commit and catalog, the source archive, and every file of the shonan-it pack
// checked against its pack.lock. Needs network. Run: TOMO_NET_TESTS=1 npx vitest run test/real/pack-remote.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lockDigest, remotePack, stageRemotePack } from '../../src/main/pack/remote'

const NET = !!process.env.TOMO_NET_TESTS
const dir = mkdtempSync(join(tmpdir(), 'tomo-remote-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!NET)('tomo-packs main', () => {
  it('stages shonan-it from main and every file matches pack.lock', async () => {
    const remote = await remotePack('shonan-it')
    expect(remote?.commit).toMatch(/^[0-9a-f]{40}$/)
    const pack = await stageRemotePack('shonan-it', remote!, dir, join(dir, 'stage'))
    expect(pack.manifest.id).toBe('shonan-it')
    expect(pack.manifest.version).toBe(remote!.version)
    expect(lockDigest(pack.dir)).toBe(remote!.lock)
  })
})
