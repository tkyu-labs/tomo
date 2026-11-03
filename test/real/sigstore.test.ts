// Pack release verification with a real keyless bundle (network for Sigstore's TUF trust root; opt-in:
// TOMO_NETWORK_TESTS=1). The fixture is signed by the same action tomo-packs' release workflow uses.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { packReleasePolicy, verifyArtifact } from '../../src/main/pack/verify'
import { repoRoot } from '../helpers/hermes'

const fx = join(repoRoot, 'test/fixtures/sigstore')
const identity = '^https://github\\.com/sigstore/gh-action-sigstore-python/\\.github/workflows/release\\.yml@refs/tags/v3\\.5\\.0$'

describe.skipIf(!process.env.TOMO_NETWORK_TESTS)('Sigstore verification', () => {
  // created in beforeAll: the describe body also runs when the suite is skipped
  let tuf = ''
  beforeAll(() => { tuf = mkdtempSync(join(tmpdir(), 'tomo-tuf-')) })
  afterAll(() => rmSync(tuf, { recursive: true, force: true }))
  it('accepts the genuine artifact for the expected workflow identity', async () => {
    expect(await verifyArtifact(join(fx, 'action.py'), join(fx, 'action.py.sigstore.json'), { identity }, tuf)).toEqual({ ok: true })
  }, 120_000)
  it('rejects a modified artifact', async () => {
    const bad = join(tuf, 'action.py')
    writeFileSync(bad, readFileSync(join(fx, 'action.py'), 'utf8') + '\n# tampered\n')
    expect((await verifyArtifact(bad, join(fx, 'action.py.sigstore.json'), { identity }, tuf)).ok).toBe(false)
  }, 120_000)
  it('rejects another signer (e.g. a pack release policy)', async () => {
    const res = await verifyArtifact(join(fx, 'action.py'), join(fx, 'action.py.sigstore.json'), packReleasePolicy('shonan-it', '0.1.0'), tuf)
    expect(res.ok).toBe(false)
  }, 120_000)
})
