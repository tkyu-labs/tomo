// Puts the pinned uv binary (scripts/uv-pin.json) for the build target into build/uv, after checking its SHA-256.
// The app uses it on first start to install Hermes into Tomo's data folder.
// Usage: node scripts/fetch-uv.mjs [platform-arch]   (default: this machine, e.g. darwin-arm64, win32-x64)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pin = JSON.parse(readFileSync(join(root, 'scripts/uv-pin.json'), 'utf8'))
const target = process.argv[2] ?? `${process.platform}-${process.arch}`
const asset = pin.assets[target]
if (!asset) throw new Error(`no uv asset pinned for ${target}`)
const res = await fetch(`https://github.com/astral-sh/uv/releases/download/${pin.version}/${asset.file}`)
if (!res.ok) throw new Error(`uv download failed: ${res.status}`)
const buf = Buffer.from(await res.arrayBuffer())
const sha = createHash('sha256').update(buf).digest('hex')
if (sha !== asset.sha256) throw new Error(`uv ${asset.file}: SHA-256 mismatch (${sha})`)
const tmp = mkdtempSync(join(tmpdir(), 'tomo-uv-'))
writeFileSync(join(tmp, asset.file), buf)
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
execFileSync(tar, ['-xf', join(tmp, asset.file), '-C', tmp])
const exe = target.startsWith('win32') ? 'uv.exe' : 'uv'
const find = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? find(p) : n === exe ? [p] : [] })
const found = find(tmp)[0]
if (!found) throw new Error('uv binary not found in archive')
const out = join(root, 'build', 'uv')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(found, join(out, exe))
if (exe === 'uv') chmodSync(join(out, exe), 0o755)
writeFileSync(join(out, 'VERSION'), `${pin.version} ${target}\n`)
rmSync(tmp, { recursive: true, force: true })
console.log(`uv ${pin.version} (${target}) verified → ${join(out, exe)}`, existsSync(join(out, exe)) ? '' : 'MISSING')
