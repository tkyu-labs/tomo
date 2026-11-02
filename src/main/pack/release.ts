// Installing a school pack from a signed tomo-packs release (tag `<id>/v<version>`, assets `<id>-<version>.tar.gz`
// and `<id>-<version>.tar.gz.sigstore.json`, see tomo-packs .github/workflows/release.yml).
import { execFile } from 'node:child_process'
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { installPack, type LoadedPack } from './pack'
import { packReleasePolicy, verifyArtifact, type SignerPolicy } from './verify'

const run = promisify(execFile)
export const PACKS_REPO = 'tkyu-labs/tomo-packs'

/** The release is looked up by tag through the GitHub API (tags contain a slash: `<id>/v<version>`). */
export function releaseAssets(id: string, version: string, repo = PACKS_REPO) {
  const file = `${id}-${version}.tar.gz`
  return { api: `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(`${id}/v${version}`)}`, file, bundle: `${file}.sigstore.json` }
}

type Verifier = (archive: string, bundle: string, policy: SignerPolicy) => Promise<{ ok: boolean; reason?: string }>

/** Verify, unpack (the archive holds `<id>/…`), install into `<dataDir>/packs/<id>`. Nothing is installed on failure. */
export async function installPackArchive(archive: string, bundle: string, id: string, version: string, dataDir: string, verifier: Verifier): Promise<LoadedPack> {
  const check = await verifier(archive, bundle, packReleasePolicy(id, version))
  if (!check.ok) throw new Error(`The ${id} pack failed its signature check: ${check.reason}`)
  const tmp = mkdtempSync(join(dataDir, '.unpack-'))
  try {
    await run('tar', ['-xzf', archive, '-C', tmp]) // bsdtar on macOS, tar.exe on Windows 10+
    const pack = installPack(join(tmp, id), dataDir)
    if (pack.manifest.id !== id || pack.manifest.version !== version) throw new Error(`archive holds ${pack.manifest.id} ${pack.manifest.version}, expected ${id} ${version}`)
    return pack
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export async function downloadPackRelease(id: string, version: string, dataDir: string): Promise<LoadedPack> {
  const { api, file, bundle } = releaseAssets(id, version)
  const rel = await fetch(api, { headers: { accept: 'application/vnd.github+json' } })
  if (!rel.ok) throw new Error(`no ${id} ${version} release (${rel.status})`)
  const assets = ((await rel.json()) as { assets: { name: string; browser_download_url: string }[] }).assets
  const url = (name: string) => assets.find((x) => x.name === name)?.browser_download_url ?? (() => { throw new Error(`release asset missing: ${name}`) })()
  const dir = join(dataDir, 'cache', 'pack-downloads')
  mkdirSync(dir, { recursive: true })
  const get = async (url: string, to: string) => {
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status}): ${url}`)
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to))
  }
  const a = join(dir, file)
  const b = `${a}.sigstore.json`
  await get(url(file), a)
  await get(url(bundle), b)
  return installPackArchive(a, b, id, version, dataDir, (x, y, p) => verifyArtifact(x, y, p, join(dataDir, 'cache', 'sigstore-tuf')))
}
