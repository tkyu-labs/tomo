// Minimal CDP helper for end-to-end checks without screenshots: launch Electron with a debugging port,
// attach to the first page and evaluate expressions. Test-only; the shipped app opens no port.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launchApp({ port = 9351, env = {}, args = [], executable } = {}) {
  // executable: an installed Tomo.app binary; default: the dev Electron with this repository
  const bin = executable ?? require('electron')
  const proc = spawn(bin, [...(executable ? [] : ['.']), `--remote-debugging-port=${port}`, ...args], {
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  proc.stdout.on('data', (d) => { log += d })
  proc.stderr.on('data', (d) => { log += d })
  let page
  for (let i = 0; i < 100 && !page; i++) {
    await sleep(200)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      page = list.find((t) => t.type === 'page')
    } catch { /* not up yet */ }
  }
  if (!page) { proc.kill(); throw new Error('no page target\n' + log) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j) })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
    return r.result?.result?.value
  }
  const waitFor = async (expression, timeout = 30000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      // DOM nodes cannot be returned by value: turn them into true
      const v = await evaluate(`(() => { const v = (${expression}); return v instanceof Node ? true : v })()`).catch(() => undefined)
      if (v) return v
      await sleep(200)
    }
    throw new Error('waitFor timed out: ' + expression + '\n' + log.slice(-3000))
  }
  const close = async () => { ws.close(); proc.kill(); await sleep(300) }
  return { evaluate, waitFor, send, close, log: () => log }
}
