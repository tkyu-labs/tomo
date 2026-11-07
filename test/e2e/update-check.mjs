// Update flow against a local feed: an installed (older) app finds the newer version, downloads it and reports the
// result in Settings. Usage: node test/e2e/update-check.mjs <app-binary> <feed-folder>
// (feed folder: an electron-builder output with latest*.yml and the update file, e.g. built with a higher version).
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { launchApp } from './cdp.mjs'
import { removeDir } from '../helpers/remove-dir.mjs'

const [bin, feed] = process.argv.slice(2)
const served = []
const server = createServer((req, res) => {
  const f = join(feed, basename(decodeURIComponent(req.url.split('?')[0])))
  served.push(basename(f))
  if (!existsSync(f) || !statSync(f).isFile()) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-length': statSync(f).size })
  createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`
const data = mkdtempSync(join(tmpdir(), 'tomo-update-'))
const app = await launchApp({ executable: bin, env: { TOMO_DATA_DIR: data, TOMO_UPDATE_URL: url, TOMO_NO_UPDATE_CHECKS: '' }, args: ['--use-mock-keychain'] })
const states = []
try {
  const end = Date.now() + 240_000
  while (Date.now() < end) {
    const s = await app.evaluate('window.tomo.updateStatus()').catch(() => null)
    if (s && JSON.stringify(s) !== JSON.stringify(states.at(-1))) states.push(s)
    if (s && (s.state === 'ready' || s.state === 'error' || s.state === 'up-to-date')) break
    await new Promise((r) => setTimeout(r, 500))
  }
  if (process.env.INSTALL && states.at(-1)?.state === 'ready') {
    await app.evaluate('window.tomo.installUpdate()').catch(() => undefined) // quits and installs
    await new Promise((r) => setTimeout(r, 25_000))
  }
  console.log(JSON.stringify({ served: [...new Set(served)], states: states.map((s) => `${s.state}${s.available ? ' ' + s.available : ''}${s.percent != null ? ' ' + s.percent + '%' : ''}${s.error ? ' — ' + s.error.slice(0, 120) : ''}`) }, null, 1))
} finally {
  await app.close()
  server.close()
  removeDir(data)
}
