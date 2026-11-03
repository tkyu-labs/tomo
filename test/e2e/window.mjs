// Window behaviour without screenshots: the saved size and position come back, resizing is saved, closing only hides
// the window (Tomo keeps running in the tray), and starting Tomo again brings the hidden window back.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './cdp.mjs'

const require = createRequire(import.meta.url)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const data = mkdtempSync(join(tmpdir(), 'tomo-window-'))
const env = { TOMO_DATA_DIR: data }
const stateFile = join(data, 'window-state.json')
const report = {}
const near = (a, b) => Math.abs(a - b) <= 2

mkdirSync(data, { recursive: true })
writeFileSync(stateFile, JSON.stringify({ x: 120, y: 140, width: 800, height: 520, maximized: false }))
const bounds = (app) => app.evaluate(`({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight })`)

// the main process's Node inspector (test only) closes the window the way the title-bar button does
const INSPECT = 9363
async function mainEval(expression) {
  const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  const res = await new Promise((r) => { ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d) }); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true } })) })
  ws.close()
  return res.result?.result?.value
}

let app = await launchApp({ env, port: 9353, args: [`--inspect=${INSPECT}`] })
try {
  await app.waitFor(`document.readyState === 'complete' && document.visibilityState === 'visible'`)
  await sleep(500)
  const b = await bounds(app)
  report.restored = b
  report.restoredOk = near(b.x, 120) && near(b.y, 140) && near(b.width, 800) && near(b.height, 520)

  // move and resize from the page (Electron forwards these to the window), then the debounced save writes them
  // (a size that fits this screen: the lab PC's screen is only 1024 px wide)
  const target = await app.evaluate(`(() => { const w = Math.min(1100, screen.availWidth - 120), h = Math.min(700, screen.availHeight - 120); return { x: screen.availLeft + 60, y: screen.availTop + 50, width: w, height: h } })()`)
  report.target = target
  await app.evaluate(`window.moveTo(${target.x}, ${target.y}); window.resizeTo(${target.width}, ${target.height})`)
  await sleep(1200)
  report.saved = JSON.parse(readFileSync(stateFile, 'utf8'))
  report.savedOk = near(report.saved.width, target.width) && near(report.saved.height, target.height) && near(report.saved.x, target.x) && near(report.saved.y, target.y)

  // closing hides the window; the app keeps running
  report.closeCalled = await mainEval(`(() => { require('electron').BrowserWindow.getAllWindows()[0].close(); return true })()`)
  report.hiddenAfterClose = await app.waitFor(`document.visibilityState === 'hidden'`, 5000).catch(() => false)
  report.aliveAfterClose = (await app.evaluate('1 + 1').catch(() => 0)) === 2

  // a second start exits at once and brings the first window back
  const second = spawn(require('electron'), ['.'], { env: { ...process.env, ...env }, stdio: 'ignore' })
  report.secondExit = await new Promise((r) => { const t = setTimeout(() => { second.kill(); r('still running') }, 15000); second.on('exit', (c) => { clearTimeout(t); r(c) }) })
  report.shownBySecondStart = await app.waitFor(`document.visibilityState === 'visible'`, 5000).catch(() => false)
} finally {
  await app.close()
}

// the next start opens where the student left it
app = await launchApp({ env, port: 9353 })
try {
  await app.waitFor(`document.readyState === 'complete' && document.visibilityState === 'visible'`)
  await sleep(500)
  const b = await bounds(app)
  report.reopened = b
  const t = report.target
  report.reopenedOk = near(b.x, t.x) && near(b.y, t.y) && near(b.width, t.width) && near(b.height, t.height)
} finally {
  await app.close()
  rmSync(data, { recursive: true, force: true })
}

console.log(JSON.stringify(report, null, 2))
const ok = report.restoredOk && report.savedOk && report.closeCalled && report.hiddenAfterClose && report.aliveAfterClose && report.secondExit === 0 && report.shownBySecondStart && report.reopenedOk
console.log(ok ? 'WINDOW OK' : 'WINDOW FAILED')
process.exitCode = ok ? 0 : 1
