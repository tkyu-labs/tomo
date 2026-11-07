// Engine request dialogs without screenshots: requests are injected from the main process (Node inspector, test only)
// and the DOM is checked: the personal-data send approval (preview + "Don't send / Send to AI") and clarify with
// choices, without choices (yes/no fallback buttons) and an open question (text field only).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './cdp.mjs'
import { removeDir } from '../helpers/remove-dir.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const data = mkdtempSync(join(tmpdir(), 'tomo-dialogs-'))
const INSPECT = 9365
const report = {}

async function mainEval(expression) {
  const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  const res = await new Promise((r) => { ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d) }); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, includeCommandLineAPI: true } })) })
  ws.close()
  return res.result?.result?.value
}
const inject = (req) => mainEval(`(() => { require('electron').BrowserWindow.getAllWindows()[0].webContents.send('tomo:engine-request', ${JSON.stringify(req)}); return true })()`)
const dialog = () => app.evaluate(`(() => { const d = document.querySelector('[data-testid=approval-dialog], [data-testid=clarify-dialog]'); if (!d) return null; return { kind: d.dataset.kind ?? d.dataset.testid, title: d.querySelector('h2, h3')?.textContent, preview: d.querySelector('[data-testid=send-preview]')?.textContent ?? null, choices: [...d.querySelectorAll('[data-testid=clarify-choices] button')].map((b) => b.textContent), text: !!d.querySelector('[data-testid=clarify-text]'), buttons: [...d.querySelectorAll('.modal-actions button')].map((b) => b.textContent.trim()) } })()`)
const close = () => app.evaluate(`document.querySelector('.modal-actions button').click(), true`)

const app = await launchApp({ env: { TOMO_DATA_DIR: data }, args: ['--use-mock-keychain', `--inspect=${INSPECT}`], port: 9356 })
try {
  await app.waitFor(`document.querySelector('#root')?.childElementCount > 0`)
  await app.evaluate(`window.tomo.setPrefs({ locale: 'en' }).then(() => location.reload())`); await sleep(1200)
  await app.waitFor(`document.querySelector('#root')?.childElementCount > 0`)
  await inject({ id: 'r1', method: 'approval', params: { tool_name: 'browser_console', description: '[tomo-privacy] ' + JSON.stringify({ kind: 'send', site: 'portal.example-u.ac.jp', preview: '{"累積GPA":"3.12","name":"{{FULL_NAME}}"}' }) } })
  await sleep(400); report.send = await dialog(); await close(); await sleep(300)
  await inject({ id: 'r2', method: 'clarify', params: { questions: [{ qid: 'q0', question: 'Which term?', choices: ['This term', 'Last term'] }] } })
  await sleep(400); report.choices = await dialog(); await close(); await sleep(300)
  await inject({ id: 'r3', method: 'clarify', params: { questions: [{ qid: 'q0', question: 'CampusSquare で確認した累積GPAを、このチャットに表示してもよいですか？' }] } })
  await sleep(400); report.yesNo = await dialog(); await close(); await sleep(300)
  await inject({ id: 'r4', method: 'clarify', params: { questions: [{ qid: 'q0', question: 'Which course do you mean?' }] } })
  await sleep(400); report.open = await dialog(); await close()
} finally {
  await app.close()
  removeDir(data)
}
console.log(JSON.stringify(report, null, 2))
const ok = report.send?.kind === 'send' && report.send.preview?.includes('{{FULL_NAME}}') && report.send.preview.includes('3.12') && report.send.buttons.join('|') === "Don't send|Send to AI"
  && report.choices?.choices.join('|') === 'This term|Last term' && report.choices.text
  && report.yesNo?.choices.join('|') === 'はい|いいえ' && report.yesNo.text
  && report.open?.choices.length === 0 && report.open.text
console.log(ok ? 'DIALOGS OK' : 'DIALOGS FAILED')
process.exitCode = ok ? 0 : 1
