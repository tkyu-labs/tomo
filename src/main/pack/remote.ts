// School packs come from the tomo-packs repository's main branch: there are no pack releases, main is the current
// version (packs need no build). One check = the commit main points to + that commit's catalog.json. A pack has an
// update when the catalog's `lock_sha256` (the fingerprint of its pack.lock, written by tools/validate.py) differs from
// the installed copy's. The download is the same commit's source archive; every file is checked against pack.lock
// before anything is installed. Trust comes from the repository (reviewed pull requests into main); pack.lock makes
// sure Tomo installs exactly that commit's files.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { compareVersions, loadPack, type LoadedPack } from './pack'
import { TAR } from './release'

const run = promisify(execFile)
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

/** What main holds for this pack now (null: not in the catalog). Two small requests. */
export async function remotePack(id: string, fetchFn: typeof fetch = fetch, repo = PACKS_REPO): Promise<RemotePack | null> {
  const c = await fetchFn(`https://api.github.com/repos/${repo}/commits/main`, { headers: { accept: 'application/vnd.github.sha' } })
  if (!c.ok) throw new Error(`tomo-packs unavailable (${c.status})`)
  const commit = (await c.text()).trim()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('tomo-packs: unexpected commit id')
  const cat = await fetchFn(`https://raw.githubusercontent.com/${repo}/${commit}/catalog.json`)
  if (!cat.ok) throw new Error(`tomo-packs catalog unavailable (${cat.status})`)
  const entry = ((await cat.json()) as { packs: { id: string; version: string; lock_sha256: string; requires?: { tomo?: string } }[] }).packs.find((p) => p.id === id)
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

/** Download the commit's source archive, take `packs/<id>` into `stageDir/<id>` and verify it (nothing installed). */
export async function stageRemotePack(id: string, remote: RemotePack, dataDir: string, stageDir: string, fetchFn: typeof fetch = fetch, repo = PACKS_REPO): Promise<LoadedPack> {
  const dir = join(dataDir, 'cache', 'pack-downloads')
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, `tomo-packs-${remote.commit}.tar.gz`)
  const res = await fetchFn(`https://codeload.github.com/${repo}/tar.gz/${remote.commit}`)
  if (!res.ok || !res.body) throw new Error(`pack download failed (${res.status})`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(archive))
  const tmp = join(dir, `unpack-${remote.commit}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    await run(TAR, ['-xzf', archive, '-C', tmp])
    const top = readdirSync(tmp).find((n) => existsSync(join(tmp, n, 'packs', id, 'pack.yaml')))
    if (!top) throw new Error(`the archive has no packs/${id}`)
    rmSync(stageDir, { recursive: true, force: true })
    mkdirSync(stageDir, { recursive: true })
    renameSync(join(tmp, top, 'packs', id), join(stageDir, id))
    verifyPackFiles(join(stageDir, id), remote.lock)
    const pack = loadPack(join(stageDir, id))
    if (pack.manifest.id !== id) throw new Error(`archive holds ${pack.manifest.id}, expected ${id}`)
    return pack
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(archive, { force: true })
  }
}
