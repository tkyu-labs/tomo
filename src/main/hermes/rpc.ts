// Newline-delimited JSON-RPC 2.0 over the Hermes gateway's stdio. This module and `client.ts` are the only
// places that know the wire protocol (tui_gateway/entry.py: one JSON object per line on stdin / stdout).
//
// Frames from the gateway:
//   {id, result} | {id, error}                 response to one of our requests (integer ids)
//   {method: "event", params: {type, ...}}     notification (streaming, tool progress, gateway.ready, …)
//   {id: "srq-…", method, params}              server→client request (approval, clarify, secret, sudo, …);
//                                              answered with {id, result} or {id, error}
//                                              (tui_gateway/server_requests.py module docstring)
import type { BackendGatewayEventMap, RpcMethods, ServerRequestMap } from './contract.generated'

export type RpcMethod = keyof RpcMethods
export type ServerRequestMethod = keyof ServerRequestMap
export type GatewayEventName = keyof BackendGatewayEventMap

export interface GatewayEvent<T extends GatewayEventName = GatewayEventName> {
  type: T
  session_id?: string
  payload: BackendGatewayEventMap[T]
  [key: string]: unknown
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  method: string
  timer?: NodeJS.Timeout
}

export interface RpcPeerOptions {
  write: (line: string) => void
  onEvent?: (event: GatewayEvent) => void
  onServerRequest?: ServerRequestHandler
  onProtocolError?: (message: string, line: string) => void
  /** Per-request timeout in ms (0 = none). */
  timeoutMs?: number
}

export class RpcPeer {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''
  private closed = false

  constructor(private readonly opts: RpcPeerOptions) {}

  request<M extends RpcMethod>(method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']>
  request(method: string, params?: unknown): Promise<unknown>
  request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new RpcError(-32001, 'gateway is not running'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject, method }
      const timeout = this.opts.timeoutMs ?? 0
      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new RpcError(-32002, `${method} timed out after ${timeout} ms`))
        }, timeout)
      }
      this.pending.set(id, entry)
      this.opts.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  /** Feed raw stdout data; complete lines are parsed and dispatched. */
  feed(chunk: string): void {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleLine(line)
    }
  }

  /** Fail every open request (process exited). */
  close(reason = 'gateway exited'): void {
    this.closed = true
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new RpcError(-32001, `${reason} (while waiting for ${p.method})`))
      this.pending.delete(id)
    }
  }

  private handleLine(line: string): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.opts.onProtocolError?.('not JSON', line)
      return
    }
    if (frame.method === 'event') {
      const params = frame.params as GatewayEvent | undefined
      if (params && typeof params.type === 'string') this.opts.onEvent?.(params)
      else this.opts.onProtocolError?.('event without type', line)
      return
    }
    if (typeof frame.method === 'string' && frame.id !== undefined && frame.id !== null) {
      void this.answerServerRequest(frame.id as string | number, frame.method, frame.params)
      return
    }
    if (typeof frame.id === 'number') {
      const p = this.pending.get(frame.id)
      if (!p) return // late response after a timeout
      this.pending.delete(frame.id)
      if (p.timer) clearTimeout(p.timer)
      if (frame.error) {
        const e = frame.error as { code?: number; message?: string; data?: unknown }
        p.reject(new RpcError(e.code ?? -32000, e.message ?? 'error', e.data))
      } else p.resolve(frame.result)
      return
    }
    this.opts.onProtocolError?.('unexpected frame', line)
  }

  private async answerServerRequest(id: string | number, method: string, params: unknown): Promise<void> {
    const handler = this.opts.onServerRequest
    let reply: Record<string, unknown>
    if (!handler) {
      reply = { jsonrpc: '2.0', id, error: { code: -32601, message: `no handler for ${method}` } }
    } else {
      try {
        reply = { jsonrpc: '2.0', id, result: await handler(method, params) }
      } catch (err) {
        const e = err instanceof RpcError ? err : new RpcError(-32000, err instanceof Error ? err.message : String(err))
        reply = { jsonrpc: '2.0', id, error: { code: e.code, message: e.message } }
      }
    }
    if (!this.closed) this.opts.write(JSON.stringify(reply) + '\n')
  }
}
