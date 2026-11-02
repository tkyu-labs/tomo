import { describe, expect, it } from 'vitest'
import { RpcError, RpcPeer, type GatewayEvent } from './rpc'

function harness(onServerRequest?: (m: string, p: unknown) => Promise<unknown>) {
  const sent: Record<string, unknown>[] = []
  const events: GatewayEvent[] = []
  const peer = new RpcPeer({
    write: (line) => sent.push(JSON.parse(line)),
    onEvent: (e) => events.push(e),
    onServerRequest,
  })
  return { peer, sent, events }
}

describe('RpcPeer', () => {
  it('matches responses to requests across chunk boundaries', async () => {
    const { peer, sent } = harness()
    const reply = peer.request('ping', {})
    expect(sent[0]).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { pong: true } }) + '\n'
    peer.feed(line.slice(0, 10))
    peer.feed(line.slice(10))
    await expect(reply).resolves.toEqual({ pong: true })
  })

  it('rejects with the gateway error', async () => {
    const { peer } = harness()
    const reply = peer.request('session.create', {})
    peer.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } }) + '\n')
    await expect(reply).rejects.toMatchObject({ code: -32000, message: 'boom' })
  })

  it('dispatches event frames', () => {
    const { peer, events } = harness()
    peer.feed(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } }) + '\n')
    expect(events.map((e) => e.type)).toEqual(['gateway.ready'])
  })

  it('answers server→client requests with the same id', async () => {
    const { peer, sent } = harness(async (method, params) => ({ method, echo: params }))
    peer.feed(JSON.stringify({ jsonrpc: '2.0', id: 'srq-abc', method: 'clarify', params: { q: 1 } }) + '\n')
    await new Promise((r) => setTimeout(r, 0))
    expect(sent[0]).toEqual({ jsonrpc: '2.0', id: 'srq-abc', result: { method: 'clarify', echo: { q: 1 } } })
  })

  it('declines server requests it cannot handle', async () => {
    const { peer, sent } = harness()
    peer.feed(JSON.stringify({ jsonrpc: '2.0', id: 'srq-x', method: 'sudo', params: {} }) + '\n')
    await new Promise((r) => setTimeout(r, 0))
    expect(sent[0]).toMatchObject({ id: 'srq-x', error: { code: -32601 } })
  })

  it('fails open requests when closed', async () => {
    const { peer } = harness()
    const reply = peer.request('ping', {})
    peer.close()
    await expect(reply).rejects.toBeInstanceOf(RpcError)
    await expect(peer.request('ping', {})).rejects.toBeInstanceOf(RpcError)
  })
})
