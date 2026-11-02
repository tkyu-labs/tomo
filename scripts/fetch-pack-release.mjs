// Downloads a signed tomo-packs release, verifies its Sigstore bundle against the release workflow identity and
// unpacks it, so the app build can bundle exactly what was signed:
//   node scripts/fetch-pack-release.mjs shonan-it 0.1.0 [outDir]   → then TOMO_PACKS_SRC=<outDir> npm run dist:mac
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verify } from 'sigstore'

const [id, version, outArg] = process.argv.slice(2)
if (!id || !version) { console.error('usage: fetch-pack-release.mjs <id> <version> [outDir]'); process.exit(2) }
const root = resolve(import.meta.dirname, '..')
const out = resolve(outArg ?? join(root, 'build', 'pack-releases'))
const repo = process.env.TOMO_PACKS_REPO ?? 'tkyu-labs/tomo-packs'
const file = `${id}-${version}.tar.gz`
const api = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(`${id}/v${version}`)}`
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
mkdirSync(join(out, 'downloads'), { recursive: true })
const rel = await fetch(api, { headers: { accept: 'application/vnd.github+json' } })
if (!rel.ok) throw new Error(`no release ${id}/v${version} (${rel.status})`)
const { assets } = await rel.json()
const get = async (name) => {
  const asset = assets.find((x) => x.name === name)
  if (!asset) throw new Error(`release asset missing: ${name}`)
  const res = await fetch(asset.browser_download_url)
  if (!res.ok) throw new Error(`${res.status} ${asset.browser_download_url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(join(out, 'downloads', name), buf)
  return buf
}
const archive = await get(file)
const bundle = JSON.parse((await get(`${file}.sigstore.json`)).toString())
await verify(bundle, archive, {
  certificateIdentityURI: `^${esc(`https://github.com/${repo}/.github/workflows/release.yml@refs/tags/${id}/v${version}`)}$`,
  certificateIssuer: 'https://token.actions.githubusercontent.com',
  tufCachePath: join(root, '.dev', 'cache', 'sigstore-tuf'),
})
mkdirSync(join(out, 'packs'), { recursive: true })
execFileSync('tar', ['-xzf', join(out, 'downloads', file), '-C', join(out, 'packs')])
const manifest = readFileSync(join(out, 'packs', id, 'pack.yaml'), 'utf8')
if (!new RegExp(`^version: ${esc(version)}$`, 'm').test(manifest)) throw new Error('pack.yaml version does not match the release tag')
console.log(`verified and unpacked ${id} ${version} → ${join(out, 'packs')}`)
