// A local stand-in for Tomo's download mirror (tomo.gakuen.ac/downloads) serving school packs, for e2e tests: Tomo
// reads packs only from the network, so tests point TOMO_MIRROR_URL here. It turns a folder of packs into what the
// mirror serves: packs/main, packs/<commit>/catalog.json and packs/<commit>.tar.gz (pack.lock and lock_sha256 written
// the way tomo-packs' tools/validate.py writes them). Everything else answers 404.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { removeDir } from './remove-dir.mjs'

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const SKIP_DIRS = ['data/build', '__pycache__', '.venv']

/** Python's json.dumps(obj, sort_keys=True) for the ASCII-only objects a pack.lock holds. */
const pyJson = (v) => Array.isArray(v) ? `[${v.map(pyJson).join(', ')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}: ${pyJson(v[k])}`).join(', ')}}`
  : JSON.stringify(v)

function files(dir, root = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    const rel = relative(root, p).split('\\').join('/')
    if (SKIP_DIRS.some((d) => rel === d || rel.startsWith(d + '/') || `/${rel}/`.includes(`/${d}/`))) return []
    return statSync(p).isDirectory() ? files(p, root) : n === 'pack.lock' || n === '.DS_Store' ? [] : [rel]
  })
}

export async function startPackMirror(packsDir) {
  const work = mkdtempSync(join(tmpdir(), 'tomo-packmirror-'))
  const packs = readdirSync(packsDir).filter((n) => existsSync(join(packsDir, n, 'pack.yaml')))
  const entries = []
  const commit = sha256(packs.map((id) => files(join(packsDir, id)).map((f) => f + sha256(readFileSync(join(packsDir, id, f)))).join()).join()).slice(0, 40)
  const repo = join(work, `tomo-packs-${commit}`)
  for (const id of packs) {
    const dir = join(repo, 'packs', id)
    cpSync(join(packsDir, id), dir, { recursive: true })
    const version = readFileSync(join(dir, 'pack.yaml'), 'utf8').match(/^version:\s*["']?([^"'\s]+)/m)?.[1] ?? '0.0.0'
    const lock = { pack: id, version, files: Object.fromEntries(files(dir).sort().map((f) => [f, sha256(readFileSync(join(dir, f)))])) }
    writeFileSync(join(dir, 'pack.lock'), JSON.stringify(lock, null, 2) + '\n')
    entries.push({ id, version, lock_sha256: sha256(pyJson(lock)) })
  }
  const catalog = JSON.stringify({ schema: 1, packs: entries })
  mkdirSync(join(work, 'out'))
  const archive = join(work, 'out', `${commit}.tar.gz`)
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-czf', `out/${commit}.tar.gz`, `tomo-packs-${commit}`], { cwd: work })
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    const path = (req.url ?? '').split('?')[0]
    if (path === '/packs/main') return res.end(commit + '\n')
    if (path === `/packs/${commit}/catalog.json`) return res.end(catalog)
    if (path === `/packs/${commit}.tar.gz`) return res.end(readFileSync(archive))
    res.writeHead(404).end('not on this mirror')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`, commit, requests,
    close: () => new Promise((r) => server.close(() => { removeDir(work); r() })),
  }
}
