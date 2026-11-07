// fetchCatalogPacks against a fake GitHub: main's commit, its catalog.json and the source archive (a real tar.gz made
// from the example-u fixture). A pack that matches its pack.lock is kept; a tampered one, one that needs a newer Tomo,
// and anything not in the catalog are left out; the same commit is not downloaded twice.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { removeDir } from '../../../test/helpers/remove-dir.mjs'
import { fetchCatalogPacks, lockDigest, TAR } from './remote'

const fixture = join(__dirname, '../../../test/fixtures/packs/example-u')
const work = mkdtempSync(join(tmpdir(), 'tomo-catalog-'))
afterAll(() => removeDir(work))
const COMMIT = 'a'.repeat(40)
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

function files(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((n) => statSync(join(dir, n)).isDirectory() ? files(join(dir, n), root) : [relative(root, join(dir, n)).split('\\').join('/')])
}
/** A pack folder with a pack.lock the way tools/validate.py writes it. */
function makePack(dir: string, id: string, version = '0.1.0') {
  cpSync(fixture, dir, { recursive: true })
  writeFileSync(join(dir, 'pack.yaml'), readFileSync(join(dir, 'pack.yaml'), 'utf8').replace(/^id: .*$/m, `id: ${id}`).replace(/^version: .*$/m, `version: ${version}`))
  const lock = { pack: id, version, files: Object.fromEntries(files(dir).sort().map((f) => [f, sha(readFileSync(join(dir, f)))])) }
  writeFileSync(join(dir, 'pack.lock'), JSON.stringify(lock, null, 2) + '\n')
}

describe('pack catalog from tomo-packs main', () => {
  // repository snapshot: three packs, one of them changed after its pack.lock was written
  const repo = join(work, 'src', `tomo-packs-${COMMIT}`)
  for (const id of ['first-u', 'tampered-u', 'future-u', 'unlisted-u']) makePack(join(repo, 'packs', id), id)
  const catalog = { schema: 1, packs: ['first-u', 'tampered-u', 'future-u'].map((id) => ({ id, version: '0.1.0', lock_sha256: lockDigest(join(repo, 'packs', id)), ...(id === 'future-u' ? { requires: { tomo: '>=9.0.0' } } : {}) })) }
  writeFileSync(join(repo, 'packs', 'tampered-u', 'soul.md'), 'changed after review\n')
  const archive = join(work, 'archive.tar.gz')
  mkdirSync(join(work, 'src'), { recursive: true })
  execFileSync(TAR, ['-czf', archive, '-C', join(work, 'src'), `tomo-packs-${COMMIT}`])

  const calls: string[] = []
  const fake = (async (url: string) => {
    calls.push(url)
    if (url.startsWith('https://tomo.gakuen.ac/')) return new Response('mirror down', { status: 503 })
    if (url.includes('/commits/main')) return new Response(COMMIT)
    if (url.endsWith('/catalog.json')) return new Response(JSON.stringify(catalog))
    if (url.includes('codeload.github.com')) return new Response(readFileSync(archive))
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  it('reads the mirror first and touches GitHub only for what the mirror does not have', async () => {
    const mirrorCalls: string[] = []
    const mirror = (async (url: string) => {
      mirrorCalls.push(url)
      if (url === 'https://tomo.gakuen.ac/downloads/packs/main') return new Response(COMMIT + '\n')
      if (url === `https://tomo.gakuen.ac/downloads/packs/${COMMIT}/catalog.json`) return new Response(JSON.stringify(catalog))
      if (url === `https://tomo.gakuen.ac/downloads/packs/${COMMIT}.tar.gz`) return new Response(readFileSync(archive))
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    expect(readdirSync(await fetchCatalogPacks(join(work, 'data-mirror'), '0.1.0', mirror)).filter((n) => !n.startsWith('.'))).toEqual(['first-u'])
    expect(mirrorCalls.every((u) => u.startsWith('https://tomo.gakuen.ac/'))).toBe(true)
    // the mirror is down: everything from GitHub (the fake below answers 404 for the mirror's URLs)
    calls.length = 0
    await fetchCatalogPacks(join(work, 'data-github'), '0.1.0', fake)
    expect(calls.filter((u) => u.startsWith('https://api.github.com/') || u.startsWith('https://raw.githubusercontent.com/') || u.startsWith('https://codeload.github.com/')).length).toBe(3)
  })

  it('keeps the packs that match pack.lock and this Tomo, once per commit', async () => {
    calls.length = 0
    const data = join(work, 'data')
    const dir = await fetchCatalogPacks(data, '0.1.0', fake)
    expect(readdirSync(dir).filter((n) => !n.startsWith('.')).sort()).toEqual(['first-u'])
    expect(existsSync(join(dir, 'first-u', 'skills'))).toBe(true)
    expect(calls.filter((u) => u.includes('codeload')).length).toBe(1)
    // same commit again: no second download
    expect(await fetchCatalogPacks(data, '0.1.0', fake)).toBe(dir)
    expect(calls.filter((u) => u.includes('codeload')).length).toBe(1)
    // a Tomo new enough for future-u gets it too (other data folder: fresh download)
    expect(readdirSync(await fetchCatalogPacks(join(work, 'data2'), '9.0.0', fake)).filter((n) => !n.startsWith('.')).sort()).toEqual(['first-u', 'future-u'])
  })
})
