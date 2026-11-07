// School packs come from the tomo-packs repository's main branch (through Tomo's download mirror first, GitHub second;
// src/main/net/sources.ts): there are no pack releases, main is the current
// version (packs need no build). One check = the commit main points to + that commit's catalog.json. A pack has an
// update when the catalog's `lock_sha256` (the fingerprint of its pack.lock, written by tools/validate.py) differs from
// the installed copy's. The download is the same commit's source archive; every file is checked against pack.lock
// before anything is installed. The first-run pack choice also lists every pack main has (fetchCatalogPacks), so a
// new school needs no Tomo update. Trust comes from the repository (reviewed pull requests into main); pack.lock makes
// sure Tomo installs exactly that commit's files.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { fetchFirst, sources } from '../net/sources'
import { compareVersions, loadPack, type LoadedPack } from './pack'

const run = promisify(execFile)
// Windows: always the system bsdtar (a Git Bash GNU tar on PATH would read `C:` as a remote host)
export const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
export const PACKS_REPO = 'tkyu-labs/tomo-packs'

/** Python's json.dumps(obj, sort_keys=True) (default separators, ensure_ascii), as tools/validate.py hashes it. */
export function pyJson(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : JSON.stringify(v)
  if (typeof v === 'string') return '"' + [...v].map((ch) => {
    const code = ch.codePointAt(0)!
    if (ch === '"') return '\\"'
    if (ch === '\\') return '\\\\'
    if (ch === '\n') return '\\n'
    if (ch === '\r') return '\\r'
    if (ch === '\t') return '\\t'
    if (ch === '\b') return '\\b'
    if (ch === '\f') return '\\f'
    if (code < 0x20 || code > 0x7e) {
      const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code]
      return units.map((u) => '\\u' + u.toString(16).padStart(4, '0')).join('')
    }
    return ch
  }).join('') + '"'
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map((k) => `${pyJson(k)}: ${pyJson(o[k])}`).join(', ') + '}'
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

/** The catalog fingerprint of a pack folder's pack.lock (null when the folder has none). */
export function lockDigest(packDir: string): string | null {
  const file = join(packDir, 'pack.lock')
  return existsSync(file) ? sha256(pyJson(JSON.parse(readFileSync(file, 'utf8')))) : null
}

/** `requires.tomo` of the form ">=x.y.z" (other forms are not restrictions Tomo understands; they pass). */
export function tomoSatisfies(requires: string | undefined, tomoVersion: string): boolean {
  const m = requires?.trim().match(/^>=\s*(\d+\.\d+\.\d+)$/)
  return !m || compareVersions(tomoVersion, m[1]!) >= 0
}

export interface RemotePack { commit: string; version: string; lock: string; requiresTomo?: string }
interface CatalogEntry { id: string; version: string; lock_sha256: string; requires?: { tomo?: string } }
export interface RemoteCatalog { commit: string; packs: CatalogEntry[] }

const COMMIT = /^[0-9a-f]{40}$/

/** The commit main points to (mirror `packs/main`, else GitHub's API). */
async function mainCommit(fetchFn: typeof fetch, repo: string): Promise<string> {
  for (const url of sources('packs/main', `https://api.github.com/repos/${repo}/commits/main`)) {
    try {
      const commit = (await (await fetchFirst([url], { headers: { accept: 'application/vnd.github.sha' } }, fetchFn)).text()).trim()
      if (COMMIT.test(commit)) return commit
    } catch { /* next source */ }
  }
  throw new Error('tomo-packs unavailable (mirror and GitHub)')
}

/** The commit main points to and that commit's catalog.json (mirror first, GitHub second). Two small requests. */
export async function remoteCatalog(fetchFn: typeof fetch = fetch, repo = PACKS_REPO): Promise<RemoteCatalog> {
  const commit = await mainCommit(fetchFn, repo)
  const cat = await fetchFirst(sources(`packs/${commit}/catalog.json`, `https://raw.githubusercontent.com/${repo}/${commit}/catalog.json`), {}, fetchFn)
  return { commit, packs: ((await cat.json()) as { packs?: CatalogEntry[] }).packs ?? [] }
}

/** What main holds for this pack now (null: not in the catalog). */
export async function remotePack(id: string, fetchFn: typeof fetch = fetch, repo = PACKS_REPO): Promise<RemotePack | null> {
  const { commit, packs } = await remoteCatalog(fetchFn, repo)
  const entry = packs.find((p) => p.id === id)
  return entry ? { commit, version: entry.version, lock: entry.lock_sha256, requiresTomo: entry.requires?.tomo } : null
}

/** Checks a folder against its pack.lock and the catalog fingerprint; throws on any difference. */
export function verifyPackFiles(packDir: string, expectedLock: string): void {
  if (lockDigest(packDir) !== expectedLock) throw new Error('pack.lock does not match the catalog')
  const lock = JSON.parse(readFileSync(join(packDir, 'pack.lock'), 'utf8')) as { files: Record<string, string> }
  for (const [rel, hash] of Object.entries(lock.files)) {
    const file = join(packDir, ...rel.split('/'))
    if (!existsSync(file) || sha256(readFileSync(file)) !== hash) throw new Error(`file does not match pack.lock: ${rel}`)
  }
}

/** Downloads the commit's source archive and unpacks it; `use` gets the repository folder inside. */
async function withArchive<T>(commit: string, dataDir: string, fetchFn: typeof fetch, repo: string, use: (root: string) => T | Promise<T>): Promise<T> {
  const dir = join(dataDir, 'cache', 'pack-downloads')
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, `tomo-packs-${commit}.tar.gz`)
  const res = await fetchFirst(sources(`packs/${commit}.tar.gz`, `https://codeload.github.com/${repo}/tar.gz/${commit}`), {}, fetchFn)
  if (!res.body) throw new Error('pack download failed (empty answer)')
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(archive))
  const tmp = join(dir, `unpack-${commit}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    await run(TAR, ['-xzf', archive, '-C', tmp])
    const top = readdirSync(tmp).find((n) => existsSync(join(tmp, n, 'packs')))
    if (!top) throw new Error('the archive has no packs folder')
    return await use(join(tmp, top))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(archive, { force: true })
  }
}

/** Download the commit's source archive, take `packs/<id>` into `stageDir/<id>` and verify it (nothing installed). */
export async function stageRemotePack(id: string, remote: RemotePack, dataDir: string, stageDir: string, fetchFn: typeof fetch = fetch, repo = PACKS_REPO): Promise<LoadedPack> {
  return withArchive(remote.commit, dataDir, fetchFn, repo, (root) => {
    if (!existsSync(join(root, 'packs', id, 'pack.yaml'))) throw new Error(`the archive has no packs/${id}`)
    rmSync(stageDir, { recursive: true, force: true })
    mkdirSync(stageDir, { recursive: true })
    renameSync(join(root, 'packs', id), join(stageDir, id))
    verifyPackFiles(join(stageDir, id), remote.lock)
    const pack = loadPack(join(stageDir, id))
    if (pack.manifest.id !== id) throw new Error(`archive holds ${pack.manifest.id}, expected ${id}`)
    return pack
  })
}

/**
 * Every pack main lists, for the first-run pack choice: new schools appear without a Tomo update. Kept per commit in
 * `<data>/cache/pack-catalog/<commit>/<id>` (one download per new commit; older copies removed). A pack whose files do
 * not match pack.lock, or that needs a newer Tomo (`requires.tomo`), is left out. Returns the folder.
 */
export async function fetchCatalogPacks(dataDir: string, tomoVersion: string, fetchFn: typeof fetch = fetch, repo = PACKS_REPO): Promise<string> {
  const cat = await remoteCatalog(fetchFn, repo)
  const base = join(dataDir, 'cache', 'pack-catalog')
  const target = join(base, cat.commit)
  if (existsSync(join(target, '.complete'))) return target
  await withArchive(cat.commit, dataDir, fetchFn, repo, (root) => {
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    for (const entry of cat.packs) {
      const src = join(root, 'packs', entry.id)
      if (!/^[a-z0-9-]+$/.test(entry.id) || !existsSync(join(src, 'pack.yaml')) || !tomoSatisfies(entry.requires?.tomo, tomoVersion)) continue
      try {
        verifyPackFiles(src, entry.lock_sha256)
        if (loadPack(src).manifest.id !== entry.id) continue
        renameSync(src, join(target, entry.id))
      } catch { /* a pack that does not match its pack.lock is not offered */ }
    }
  })
  writeFileSync(join(target, '.complete'), cat.commit)
  for (const old of readdirSync(base)) if (old !== cat.commit) rmSync(join(base, old), { recursive: true, force: true })
  return target
}
