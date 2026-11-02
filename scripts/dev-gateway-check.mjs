// M0 check: start the pinned Hermes gateway over stdio with Tomo's isolation variables, wait for
// gateway.ready, send `ping`, then verify nothing was written to the (temporary) home directory, i.e.
// no ~/.hermes or ~/.local/state/hermes. Usage: node scripts/dev-gateway-check.mjs (after dev-hermes.sh)
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dev = join(root, '.dev')
const fakeHome = mkdtempSync(join(tmpdir(), 'tomo-home-'))
const home = join(dev, 'home')
const env = {
  PATH: process.env.PATH,
  HOME: fakeHome, // any write outside HERMES_HOME would show up here
  HERMES_HOME: home,
  HERMES_RUNTIME_DIR: join(home, 'tools'),
  HERMES_GATEWAY_LOCK_DIR: join(home, 'locks'),
  npm_config_cache: join(dev, 'cache/npm'),
  UV_CACHE_DIR: join(dev, 'cache/uv'),
  UV_PYTHON_INSTALL_DIR: join(dev, 'python'),
  TMPDIR: process.env.TMPDIR,
}
const proc = spawn(join(dev, 'hermes-venv/bin/python'), ['-m', 'tui_gateway.entry'], {
  cwd: join(dev, 'hermes-src'), env, stdio: ['pipe', 'pipe', 'pipe'],
})
let buf = '', stderr = ''
const fail = (msg) => { console.error('FAIL', msg, stderr.slice(-2000)); proc.kill(); process.exit(1) }
const timer = setTimeout(() => fail('timeout'), 60000)
proc.stderr.on('data', (d) => { stderr += d })
proc.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    if (msg.method === 'event' && msg.params?.type === 'gateway.ready') {
      console.log('gateway.ready')
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }) + '\n')
    } else if (msg.id === 1) {
      if (!msg.result?.pong) fail('unexpected ping reply ' + line)
      console.log('ping -> pong')
      clearTimeout(timer)
      proc.stdin.end()
      setTimeout(() => proc.kill(), 3000)
    }
  }
})
proc.on('exit', () => {
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n); return statSync(p).isDirectory() ? [p + '/', ...walk(p)] : [p]
  })
  const written = walk(fakeHome).map((p) => p.slice(fakeHome.length))
  rmSync(fakeHome, { recursive: true, force: true })
  if (written.length) fail('written outside HERMES_HOME: ' + written.join(', '))
  console.log('home untouched: OK')
  process.exit(0)
})
