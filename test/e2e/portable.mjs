// Windows portable mode (simulated with TOMO_PORTABLE_ROOT on any OS): the first-run sets a password, the secret
// store is encrypted with it (no plain key on disk), every start shows the unlock screen and the engine waits for it,
// a wrong password is refused, and changing the password re-encrypts the store.
// Usage: npm run build && node test/e2e/portable.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './cdp.mjs'
import { startStubModel } from '../stub-model/server.mjs'
import { removeDir } from '../helpers/remove-dir.mjs'

const root = resolve(import.meta.dirname, '../..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const data = mkdtempSync(join(tmpdir(), 'tomo-portable-'))
const STUB_PORT = 39418
const FIRST = 'first portable pw', SECOND = 'second portable pw'
const report = {}

const setup = spawnSync(process.execPath, [join(root, 'test/e2e/first-run.mjs')], {
  env: { ...process.env, TOMO_E2E_DATA: data, TOMO_E2E_STUB_PORT: String(STUB_PORT), TOMO_E2E_PORTABLE: FIRST }, encoding: 'utf8', timeout: 600_000,
})
report.setup = (setup.stdout ?? '').trim().split('\n').at(-1)
if (report.setup !== 'E2E OK') { console.log(setup.stdout?.slice(-2500), setup.stderr?.slice(-1500)); throw new Error('first run failed') }

// on disk: a key file without the password, a store without the plain key (first-run.mjs connects with "stub-key")
report.keyFile = existsSync(join(data, 'secret-key.json')) && !readFileSync(join(data, 'secret-key.json'), 'utf8').includes(FIRST)
report.storeEncrypted = existsSync(join(data, 'secrets.bin')) && !readFileSync(join(data, 'secrets.bin')).includes('stub-key')

const stub = await startStubModel({ port: STUB_PORT })
const env = { TOMO_DATA_DIR: data, TOMO_PORTABLE_ROOT: data }
const setInput = (app, sel, v) => app.evaluate(`(() => { const el = document.querySelector('${sel}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const unlock = async (app, pw) => {
  await setInput(app, '[data-testid=unlock-password]', pw)
  await app.evaluate(`document.querySelector('[data-testid=unlock-open]').click(), true`)
  await sleep(1500)
}

let app
try {
  app = await launchApp({ env, args: ['--use-mock-keychain'] })
  await app.waitFor(`!!document.querySelector('[data-testid=unlock]')`, 30000)
  await sleep(1500)
  report.engineWaits = await app.evaluate(`window.tomo.getState().then((s) => s.engine.state !== 'ready')`)
  await unlock(app, 'not the password')
  report.wrongRefused = await app.evaluate(`!!document.querySelector('[data-testid=unlock-wrong]') && !!document.querySelector('[data-testid=unlock]')`)
  await unlock(app, FIRST)
  await app.waitFor(`window.tomo.getState().then((s) => s.engine.state === 'ready')`, 120000)
  report.unlocked = await app.evaluate(`!document.querySelector('[data-testid=unlock]') && !!document.querySelector('[data-testid=sidebar]')`)
  // change the password in Settings
  await app.evaluate(`window.tomo.setPrefs({ locale: 'en' }).then(() => location.reload())`); await sleep(1500)
  await app.waitFor(`!!document.querySelector('[data-testid=nav-settings]')`)
  await app.evaluate(`document.querySelector('[data-testid=nav-settings]').click(), true`); await sleep(500)
  report.passwordRow = await app.evaluate(`!!document.querySelector('[data-testid=portable-password]')`)
  await app.evaluate(`document.querySelector('[data-testid=change-password-open]').click(), true`); await sleep(300)
  await setInput(app, '[data-testid=pw-current]', FIRST)
  await setInput(app, '[data-testid=pw-new]', SECOND)
  await setInput(app, '[data-testid=pw-confirm]', SECOND)
  await app.evaluate(`document.querySelector('[data-testid=pw-change]').click(), true`); await sleep(800)
  report.changed = await app.evaluate(`!document.querySelector('[data-testid=change-password]') && document.body.innerText.includes('Password changed.')`)
  await app.close(); app = undefined
  await sleep(1500)
  // next start: the old password no longer works, the new one does, and the keys are still there
  app = await launchApp({ env, args: ['--use-mock-keychain'] })
  await app.waitFor(`!!document.querySelector('[data-testid=unlock]')`, 30000)
  await unlock(app, FIRST)
  report.oldRefused = await app.evaluate(`!!document.querySelector('[data-testid=unlock-wrong]')`)
  await unlock(app, SECOND)
  await app.waitFor(`window.tomo.getState().then((s) => s.engine.state === 'ready')`, 120000)
  report.keysKept = await app.evaluate(`window.tomo.getState().then((s) => !!s.keyHint)`)
} finally {
  await app?.close().catch(() => undefined)
  await stub.close()
  await sleep(1000)
  removeDir(data)
}
console.log(JSON.stringify(report, null, 2))
const ok = Object.entries(report).every(([k, v]) => (k === 'setup' ? v === 'E2E OK' : v === true))
console.log(ok ? 'PORTABLE OK' : 'PORTABLE FAILED')
process.exitCode = ok ? 0 : 1
