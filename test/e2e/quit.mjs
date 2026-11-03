// Nothing outlives Tomo: with Hermes, its browser (headed Chrome / Edge + agent-browser) and a background terminal
// command running, (A) quitting Tomo and (B) killing Tomo outright (crash, Task Manager) must leave no process behind.
// Starts from a set-up Tomo made by first-run.mjs (stub model on a fixed port). Needs network (opens example.com).
// Usage: npm run build && node test/e2e/quit.mjs   (TOMO_E2E_APP=<installed Tomo binary> to check a build)
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './cdp.mjs'
import { killAll, label, survivors, tomoProcesses } from './procs.mjs'
import { startStubModel } from '../stub-model/server.mjs'

const root = resolve(import.meta.dirname, '../..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const data = mkdtempSync(join(tmpdir(), 'tomo-quit-'))
const STUB_PORT = 39417
const INSPECT = 9364
const report = {}
let leftovers = []

// 1. a set-up Tomo (first run with the stub model), data kept in `data`
const setup = spawnSync(process.execPath, [join(root, 'test/e2e/first-run.mjs')], {
  env: { ...process.env, TOMO_E2E_DATA: data, TOMO_E2E_STUB_PORT: String(STUB_PORT) }, encoding: 'utf8', timeout: 600_000,
})
report.setup = (setup.stdout ?? '').trim().split('\n').at(-1)
if (report.setup !== 'E2E OK') { console.log(setup.stdout?.slice(-2000), setup.stderr?.slice(-2000)); throw new Error('first run failed') }

const stub = await startStubModel({ port: STUB_PORT })
const $ = (sel) => `document.querySelector(${JSON.stringify(sel)})`

async function mainEval(expression) {
  const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true } }))
  await sleep(300)
  ws.close()
}

/** Starts Tomo, opens the browser and a background command, returns the app and every process that belongs to it. */
async function busyTomo() {
  const app = await launchApp({
    executable: process.env.TOMO_E2E_APP,
    env: { TOMO_DATA_DIR: data, ...(process.env.TOMO_E2E_APP ? {} : { TOMO_PACKS_DIR: join(root, 'test/fixtures/packs') }) },
    args: ['--use-mock-keychain', `--inspect=${INSPECT}`],
  })
  await app.waitFor(`window.tomo.getState().then((s) => s.engine.state === 'ready')`, 120_000)
  const ask = async (text) => {
    const n = await app.evaluate(`document.querySelectorAll('[data-testid=assistant-message]').length`)
    await app.evaluate(`(() => { const el = ${$('[data-testid=composer]')}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await app.evaluate(`${$('[data-testid=send]')}.click(), true`)
    const end = Date.now() + 180_000
    while (Date.now() < end) {
      await app.evaluate(`${$('[data-testid=approval-allow]')}?.click(), true`) // allow if the engine asks
      const done = await app.evaluate(`document.querySelectorAll('[data-testid=assistant-message]').length > ${n} && !${$('[data-testid=stop]')}`)
      if (done) return
      await sleep(500)
    }
    throw new Error('turn did not finish: ' + text)
  }
  await ask('TOOL:browser_navigate ARGS:{"url":"https://example.com/"}')
  await ask('TOOL:terminal ARGS:{"command":"sleep 600","background":true}')
  await sleep(1500)
  const procs = tomoProcesses(app.pid, [data])
  return { app, procs }
}

const summary = (list) => [...new Set(list.map(label))].sort().join(', ')
const waitExit = async (pid, ms) => {
  const end = Date.now() + ms
  while (Date.now() < end) { try { process.kill(pid, 0) } catch { return true } await sleep(250) }
  return false
}

try {
  // A. normal quit (tray Quit / ⌘Q go through app.quit())
  let { app, procs } = await busyTomo()
  report.runningA = summary(procs)
  report.hasBrowserA = procs.some((p) => /chrome|msedge|Google Chrome|Microsoft Edge/i.test(p.cmd))
  report.hasSleepA = procs.some((p) => /sleep 600|sleep(\.exe)?"?\s+600/.test(p.cmd))
  const t0 = Date.now()
  await mainEval(`require('electron').app.quit()`)
  report.exitedA = await waitExit(app.pid, 30_000)
  report.quitSecondsA = Math.round((Date.now() - t0) / 100) / 10
  await sleep(3000)
  let left = survivors(procs)
  report.leftA = summary(left)
  leftovers.push(...left)
  killAll(left)
  await app.close()

  // B. Tomo killed outright: Hermes sees its stdin close and must clean up by itself
  ;({ app, procs } = await busyTomo())
  report.runningB = summary(procs)
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(app.pid), '/F'], { stdio: 'ignore' })
  else process.kill(app.pid, 'SIGKILL')
  await waitExit(app.pid, 10_000)
  await sleep(15_000)
  left = survivors(procs)
  report.leftB = summary(left)
  leftovers.push(...left)
  killAll(left)
  await app.close()
} finally {
  await stub.close()
  await sleep(1000)
  rmSync(data, { recursive: true, force: true })
}

console.log(JSON.stringify(report, null, 2))
if (leftovers.length) console.log('left behind:\n' + leftovers.map((p) => `  ${p.pid} ${p.cmd.slice(0, 160)}`).join('\n'))
const ok = report.hasBrowserA && report.hasSleepA && report.exitedA && !report.leftA && !report.leftB
console.log(ok ? 'QUIT OK' : 'QUIT FAILED')
process.exitCode = ok ? 0 : 1
