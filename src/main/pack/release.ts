// Installing a school pack from a signed tomo-packs release (tag `<id>/v<version>`, assets `<id>-<version>.tar.gz`
// and `<id>-<version>.tar.gz.sigstore.json`, see tomo-packs .github/workflows/release.yml).
import { execFile } from 'node:child_process'
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { compareVersions, installPack, loadPack, type LoadedPack } from './pack'
import { packReleasePolicy, verifyArtifact, type SignerPolicy } from './verify'

const run = promisify(execFile)
// Windows: always the system bsdtar (a Git Bash GNU tar on PATH would read `C:` as a remote host)
export const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
export const PACKS_REPO = 'tkyu-labs/tomo-packs'

/** The release is looked up by tag through the GitHub API (tags contain a slash: `<id>/v<version>`). */
export function releaseAssets(id: string, version: string, repo = PACKS_REPO) {
  const file = `${id}-${version}.tar.gz`
  return { api: `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(`${id}/v${version}`)}`, file, bundle: `${file}.sigstore.json` }
}

export type Verifier = (archive: string, bundle: string, policy: SignerPolicy) => Promise<{ ok: boolean; reason?: string }>

/**
 * The newest published release of a pack (`<id>/v<version>`, not a draft or pre-release), or null. One unauthenticated
 * GitHub API call (60 per hour per IP; Tomo checks every 6 hours).
 */
export async function latestPackRelease(id: string, fetchFn: typeof fetch = fetch, repo = PACKS_REPO): Promise<string | null> {
  const res = await fetchFn(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers: { accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`pack releases unavailable (${res.status})`)
  const rows = (await res.json()) as { tag_name: string; draft: boolean; prerelease: boolean }[]
  const prefix = `${id}/v`
  const versions = rows.filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(prefix)).map((r) => r.tag_name.slice(prefix.length))
  return versions.sort(compareVersions).at(-1) ?? null
}

/** Verify and unpack an archive into `stageDir/<id>` without installing it; returns the unpacked pack. */
export async function stagePackArchive(archive: string, bundle: string, id: string, version: string, stageDir: string, verifier: Verifier): Promise<LoadedPack> {
  const check = await verifier(archive, bundle, packReleasePolicy(id, version))
  if (!check.ok) throw new Error(`The ${id} pack failed its signature check: ${check.reason}`)
  rmSync(stageDir, { recursive: true, force: true })
  mkdirSync(stageDir, { recursive: true })
  await run(TAR, ['-xzf', archive, '-C', stageDir])
  const pack = loadPack(join(stageDir, id))
  if (pack.manifest.id !== id || pack.manifest.version !== version) throw new Error(`archive holds ${pack.manifest.id} ${pack.manifest.version}, expected ${id} ${version}`)
  return pack
}

/** Download a release's archive and Sigstore bundle, verify and unpack them into `stageDir` (nothing installed). */
export async function stagePackRelease(id: string, version: string, dataDir: string, stageDir: string, fetchFn: typeof fetch = fetch): Promise<LoadedPack> {
  const { api, file, bundle } = releaseAssets(id, version)
  const rel = await fetchFn(api, { headers: { accept: 'application/vnd.github+json' } })
  if (!rel.ok) throw new Error(`no ${id} ${version} release (${rel.status})`)
  const assets = ((await rel.json()) as { assets: { name: string; browser_download_url: string }[] }).assets
  const url = (name: string) => assets.find((x) => x.name === name)?.browser_download_url ?? (() => { throw new Error(`release asset missing: ${name}`) })()
  const dir = join(dataDir, 'cache', 'pack-downloads')
  mkdirSync(dir, { recursive: true })
  const get = async (from: string, to: string) => {
    const res = await fetchFn(from)
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status}): ${from}`)
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to))
  }
  const a = join(dir, file)
  const b = `${a}.sigstore.json`
  await get(url(file), a)
  await get(url(bundle), b)
  return stagePackArchive(a, b, id, version, stageDir, (x, y, p) => verifyArtifact(x, y, p, join(dataDir, 'cache', 'sigstore-tuf')))
}

/** Verify, unpack (the archive holds `<id>/…`), install into `<dataDir>/packs/<id>`. Nothing is installed on failure. */
export async function installPackArchive(archive: string, bundle: string, id: string, version: string, dataDir: string, verifier: Verifier): Promise<LoadedPack> {
  const check = await verifier(archive, bundle, packReleasePolicy(id, version))
  if (!check.ok) throw new Error(`The ${id} pack failed its signature check: ${check.reason}`)
  const tmp = mkdtempSync(join(dataDir, '.unpack-'))
  try {
    await run(TAR, ['-xzf', archive, '-C', tmp]) // bsdtar on macOS and Windows 10+
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
