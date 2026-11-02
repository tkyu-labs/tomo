import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { RpcPeer, type GatewayEvent } from './rpc'

export interface HermesRuntime {
  /** Python interpreter of the Hermes environment. */
  python: string
  /** Hermes source / install root (working directory for `-m tui_gateway.entry`). */
  root: string
}

export interface HermesProcessOptions {
  runtime: HermesRuntime
  env: Record<string, string>
  /** Answers server→client requests (approval, clarify, secret, …). */
  onServerRequest?: (method: string, params: unknown) => Promise<unknown>
  readyTimeoutMs?: number
  requestTimeoutMs?: number
  /** Restart automatically after an unexpected exit (max `maxRestarts` within a minute). */
  autoRestart?: boolean
  maxRestarts?: number
}

export type HermesState = 'stopped' | 'starting' | 'ready' | 'crashed'

interface Events {
  event: [GatewayEvent]
  state: [HermesState]
  exit: [number | null]
}

const STDERR_LINES = 400

/**
 * Owns the gateway child process: spawn with the isolated environment, wait for `gateway.ready`, advertise that
 * Tomo answers server→client requests, restart with backoff, keep a stderr tail for "Copy diagnostics".
 */
export class HermesProcess extends EventEmitter<Events> {
  private child?: ChildProcess
  private peer?: RpcPeer
  private stderr: string[] = []
  private restarts: number[] = []
  private stopping = false
  state: HermesState = 'stopped'

  constructor(private opts: HermesProcessOptions) {
    super()
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  get rpc(): RpcPeer {
    if (!this.peer || this.state !== 'ready') throw new Error('Hermes is not ready')
    return this.peer
  }

  /** Replace environment (e.g. after a key changed); takes effect on the next start. */
  setEnv(env: Record<string, string>): void {
    this.opts = { ...this.opts, env }
  }

  async start(): Promise<void> {
    if (this.state === 'ready' || this.state === 'starting') return
    this.stopping = false
    this.setState('starting')
    const child = spawn(this.opts.runtime.python, ['-m', 'tui_gateway.entry'], {
      cwd: this.opts.runtime.root,
      env: this.opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout!.setEncoding('utf8')
    child.stderr!.setEncoding('utf8')
    let ready!: () => void
    let failed!: (e: Error) => void
    const readyPromise = new Promise<void>((res, rej) => { ready = res; failed = rej })
    const peer = new RpcPeer({
      write: (line) => { child.stdin!.write(line) },
      timeoutMs: this.opts.requestTimeoutMs ?? 120_000,
      onServerRequest: this.opts.onServerRequest,
      onProtocolError: (msg, line) => this.pushStderr(`[protocol] ${msg}: ${line.slice(0, 200)}`),
      onEvent: (event) => {
        if (event.type === 'gateway.ready') ready()
        this.emit('event', event)
      },
    })
    this.peer = peer
    child.stdout!.on('data', (d: string) => peer.feed(d))
    child.stderr!.on('data', (d: string) => { for (const l of d.split('\n')) if (l) this.pushStderr(l) })
    child.on('error', (err) => failed(err))
    child.on('exit', (code) => {
      peer.close(`gateway exited with code ${code}`)
      failed(new Error(`gateway exited with code ${code} before it was ready`))
      this.child = undefined
      this.emit('exit', code)
      if (this.stopping) { this.setState('stopped'); return }
      this.setState('crashed')
      if (this.opts.autoRestart) this.scheduleRestart()
    })
    const timeout = this.opts.readyTimeoutMs ?? 120_000
    const timer = setTimeout(() => failed(new Error(`gateway not ready after ${timeout} ms`)), timeout)
    try {
      await readyPromise
    } catch (err) {
      this.stop()
      throw err
    } finally {
      clearTimeout(timer)
    }
    await peer.request('client.capabilities', { server_requests: true })
    this.setState('ready')
  }

  stop(): void {
    this.stopping = true
    const child = this.child
    if (!child) { this.setState('stopped'); return }
    child.stdin?.end() // the gateway exits on stdin EOF (tui_gateway/entry.py main loop)
    const kill = setTimeout(() => child.kill(), 3000)
    child.once('exit', () => clearTimeout(kill))
  }

  async restart(): Promise<void> {
    await this.stopAndWait()
    await this.start()
  }

  async stopAndWait(): Promise<void> {
    const child = this.child
    if (!child) return
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    this.stop()
    await exited
  }

  /** Text for "Copy diagnostics": state and the last stderr lines (keys never appear here; the env is not logged). */
  diagnostics(): string {
    return [`state: ${this.state}`, `restarts (last minute): ${this.recentRestarts()}`, '--- gateway stderr (tail) ---', ...this.stderr].join('\n')
  }

  private pushStderr(line: string): void {
    this.stderr.push(line)
    if (this.stderr.length > STDERR_LINES) this.stderr.splice(0, this.stderr.length - STDERR_LINES)
  }

  private recentRestarts(): number {
    const now = Date.now()
    this.restarts = this.restarts.filter((t) => now - t < 60_000)
    return this.restarts.length
  }

  private scheduleRestart(): void {
    if (this.recentRestarts() >= (this.opts.maxRestarts ?? 3)) return
    this.restarts.push(Date.now())
    const delay = 500 * 2 ** (this.restarts.length - 1)
    setTimeout(() => { void this.start().catch(() => undefined) }, delay)
  }

  private setState(state: HermesState): void {
    if (this.state === state) return
    this.state = state
    this.emit('state', state)
  }
}
