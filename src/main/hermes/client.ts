import type { HermesProcess } from './process'
import type { GatewayEvent } from './rpc'
import type { SessionCreateParams, SessionCreateResult } from './contract.generated'

export type TurnEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool.start'; toolId: string; name: string; args?: Record<string, unknown> | null }
  | { kind: 'tool.complete'; toolId: string; name: string; summary?: string | null; durationS?: number | null }
  | { kind: 'complete'; text: string; status?: string | null; error?: string | null }
  | { kind: 'error'; message: string }

/** Maps gateway events to the few turn events the UI needs; unknown events are ignored. */
export function toTurnEvent(e: GatewayEvent): TurnEvent | null {
  const p = (e.payload ?? {}) as Record<string, unknown>
  switch (e.type) {
    case 'message.delta':
      return { kind: 'delta', text: String(p.text ?? '') }
    case 'reasoning.delta':
      return { kind: 'reasoning', text: String(p.text ?? '') }
    case 'tool.start':
      return { kind: 'tool.start', toolId: String(p.tool_id), name: String(p.name), args: p.args as Record<string, unknown> | null }
    case 'tool.complete':
      return { kind: 'tool.complete', toolId: String(p.tool_id), name: String(p.name), summary: p.summary as string | null, durationS: p.duration_s as number | null }
    case 'message.complete':
      return { kind: 'complete', text: typeof p.text === 'string' ? p.text : '', status: p.status as string | null, error: p.error as string | null }
    case 'error':
      return { kind: 'error', message: String(p.message ?? p.error ?? 'error') }
    default:
      return null
  }
}

/** Session-level API over the gateway: create, submit, interrupt, close; per-session event subscription. */
export class HermesClient {
  private listeners = new Map<string, Set<(e: GatewayEvent) => void>>()

  constructor(private readonly hermes: HermesProcess) {
    hermes.on('event', (e) => {
      if (!e.session_id) return
      for (const fn of this.listeners.get(e.session_id) ?? []) fn(e)
    })
  }

  async createSession(params: SessionCreateParams = {}): Promise<SessionCreateResult> {
    return this.hermes.rpc.request('session.create', { source: 'tomo', ...params })
  }

  subscribe(sessionId: string, fn: (e: GatewayEvent) => void): () => void {
    const set = this.listeners.get(sessionId) ?? new Set()
    set.add(fn)
    this.listeners.set(sessionId, set)
    return () => set.delete(fn)
  }

  /** Submit a user message. `text` must already be masked (identifiers as {{PLACEHOLDERS}}). */
  async submit(sessionId: string, text: string): Promise<void> {
    await this.hermes.rpc.request('prompt.submit', { session_id: sessionId, text })
  }

  /** Submit and collect events until `message.complete` (used by tests and the provider check). */
  async runTurn(sessionId: string, text: string, onEvent?: (e: TurnEvent) => void, timeoutMs = 120_000): Promise<TurnEvent[]> {
    const events: TurnEvent[] = []
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('turn timed out')) }, timeoutMs)
      const off = this.subscribe(sessionId, (raw) => {
        const ev = toTurnEvent(raw)
        if (!ev) return
        events.push(ev)
        onEvent?.(ev)
        if (ev.kind === 'complete') { clearTimeout(timer); off(); resolve(events) }
      })
      this.submit(sessionId, text).catch((err) => { clearTimeout(timer); off(); reject(err) })
    })
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.hermes.rpc.request('session.interrupt', { session_id: sessionId })
  }

  async close(sessionId: string): Promise<void> {
    this.listeners.delete(sessionId)
    await this.hermes.rpc.request('session.close', { session_id: sessionId })
  }
}
