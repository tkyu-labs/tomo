// The first start after an update that brings another Hermes: the migration screen installs the pinned engine next
// to the old one, starts it, and only then deletes the old one. Needs a packaged app (the installer is not used in
// development) and network. The "old" engine is the one first-run.mjs installed, moved to engine/oldengine and
// recorded as an older Hermes.
// Usage: TOMO_E2E_APP=<packaged Tomo binary> node test/e2e/migration.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './cdp.mjs'
import { startStubModel } from '../stub-model/server.mjs'
import { removeDir } from '../helpers/remove-dir.mjs'

const APP = process.env.TOMO_E2E_APP
if (!APP) throw new Error('TOMO_E2E_APP (a packaged Tomo) is required')
const root = resolve(import.meta.dirname, '../..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// TOMO_E2E_DATA: a folder a packaged first-run.mjs already set up (skips the first run; the folder is kept)
const reuse = !!process.env.TOMO_E2E_DATA && existsSync(join(process.env.TOMO_E2E_DATA, 'engine', 'installed.json'))
const data = reuse ? process.env.TOMO_E2E_DATA : mkdtempSync(join(tmpdir(), 'tomo-migrate-'))
const STUB_PORT = 39419
const report = {}

if (reuse) report.setup = 'E2E OK'
else {
  const setup = spawnSync(process.execPath, [join(root, 'test/e2e/first-run.mjs')], {
    env: { ...process.env, TOMO_E2E_DATA: data, TOMO_E2E_STUB_PORT: String(STUB_PORT), TOMO_E2E_PACK: process.env.TOMO_E2E_PACK ?? 'shonan-it' }, encoding: 'utf8', timeout: 1_200_000,
  })
  report.setup = (setup.stdout ?? '').trim().split('\n').at(-1)
  if (report.setup !== 'E2E OK') { console.log(setup.stdout, setup.stderr?.slice(-3000)); throw new Error('first run failed') }
}

// pretend an older Hermes is installed: move the engine away and describe it as v0.0.0
const engine = join(data, 'engine')
const marker = JSON.parse(readFileSync(join(engine, 'installed.json'), 'utf8'))
renameSync(join(engine, marker.dir), join(engine, 'oldengine'))
writeFileSync(join(engine, 'installed.json'), JSON.stringify({ ...marker, commit: '0'.repeat(40), tag: 'v0.0.0-test', dir: 'oldengine' }))

const stub = await startStubModel({ port: STUB_PORT })
let app
try {
  app = await launchApp({ executable: APP, env: { TOMO_DATA_DIR: data }, args: ['--use-mock-keychain'] })
  await app.waitFor(`!!document.querySelector('[data-testid=migration]')`, 60000)
  report.screen = true
  const seen = new Set()
  const end = Date.now() + 900_000
  while (Date.now() < end) {
    const s = await app.evaluate(`(() => { const m = document.querySelector('[data-testid=migration]'); if (!m) return null; return { h: m.querySelector('h1')?.textContent, tasks: ['engine','tools','data','start'].map((t) => document.querySelector('[data-testid=migration-' + t + ']')?.className.replace('task ', '')), text: document.querySelector('[data-testid=migration-engine] span:last-child')?.textContent } })()`).catch(() => null)
    if (!s) break
    seen.add(s.tasks.join(','))
    if (s.text?.includes('v0.0.0-test')) report.versionsShown = s.text.replace(/\s*·\s*\d+%$/, '')
    if (s.tasks.includes('error')) { report.error = s; break }
    await sleep(1000)
  }
  report.states = [...seen]
  await app.waitFor(`window.tomo.getState().then((s) => s.engine.state === 'ready' && !s.migration.active)`, 120000)
  report.chatAfter = await app.evaluate(`!!document.querySelector('[data-testid=sidebar]')`)
  const now = JSON.parse(readFileSync(join(engine, 'installed.json'), 'utf8'))
  report.newEngine = now.dir !== 'oldengine' && now.commit !== '0'.repeat(40) && !now.previous
  report.oldDeletedRightAway = !existsSync(join(engine, 'oldengine'))
  if (!report.oldDeletedRightAway) {
    // Windows can keep the old folder locked while Tomo runs: it is remembered and deleted on the next start
    report.staleRecorded = (now.stale ?? []).includes('oldengine')
    await app.close(); app = undefined
    await sleep(2000)
    app = await launchApp({ executable: APP, env: { TOMO_DATA_DIR: data }, args: ['--use-mock-keychain'] })
    await app.waitFor(`window.tomo.getState().then((s) => s.engine.state === 'ready')`, 180000)
    report.noMigrationAgain = await app.evaluate(`!document.querySelector('[data-testid=migration]')`)
  }
  report.oldDeleted = !existsSync(join(engine, 'oldengine')) && !JSON.parse(readFileSync(join(engine, 'installed.json'), 'utf8')).stale
} finally {
  await app?.close().catch(() => undefined)
  await stub.close()
  await sleep(1000)
  if (!reuse) removeDir(data)
}
console.log(JSON.stringify(report, null, 2))
const ok = report.setup === 'E2E OK' && report.screen && !report.error && report.chatAfter && report.newEngine && report.oldDeleted && !!report.versionsShown && (report.oldDeletedRightAway || (report.staleRecorded && report.noMigrationAgain))
console.log(ok ? 'MIGRATION OK' : 'MIGRATION FAILED')
process.exitCode = ok ? 0 : 1
