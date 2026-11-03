import { spawn, type ChildProcess } from 'node:child_process'
import type { HermesRuntime } from '../hermes/process'

export type LoginEvent =
  | { event: 'code'; user_code: string; verification_url: string }
  | { event: 'approved'; models: string[] }
  | { event: 'expired' }
  | { event: 'error'; message: string }

/**
 * ChatGPT sign-in (the only OAuth Tomo offers): runs engine-helpers/codex_login.py with the engine's Python and
 * Tomo's HERMES_HOME, so Hermes stores the tokens in its own auth.json there. Closing stdin cancels.
 */
export class ChatGptLogin {
  private child?: ChildProcess

  start(runtime: HermesRuntime, helper: string, env: Record<string, string>, onEvent: (e: LoginEvent) => void): void {
    this.cancel()
    const child = spawn(runtime.python, [helper], { cwd: runtime.root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    let buf = ''
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line.startsWith('{')) { try { onEvent(JSON.parse(line) as LoginEvent) } catch { /* ignore */ } }
      }
    })
    child.on('exit', () => { if (this.child === child) this.child = undefined })
  }

  cancel(): void {
    this.child?.stdin?.end()
    this.child = undefined
  }
}
