// Spike 5: a key that exists only in the gateway's process environment works for a custom
// provider (custom:stub stands in for custom:gakuen) including the auxiliary client, and never reaches a terminal
// child. Without the privacy plugin, TOMO_PRIVATE *does* reach the terminal — the plugin must pop it (privacy.test.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HermesClient } from '../../src/main/hermes/client'
import type { HermesProcess } from '../../src/main/hermes/process'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { makeTestHome, startHermes, stubConfig, type TestHome } from '../helpers/hermes'

type Req = { headers: Record<string, string>; raw: string; body: { messages: { role: string; content: unknown }[] } }
let stub: { url: string; requests: Req[]; close(): Promise<void> }
let home: TestHome
let hermes: HermesProcess
const KEY = 'stub-key-SECRETVALUE-123'

beforeAll(async () => {
  stub = await startStubModel()
  home = makeTestHome(stubConfig(stub.url))
  hermes = startHermes(home, { keys: { TOMO_STUB_KEY: KEY }, privatePayload: '{"marker":"PRIVATEVALUE"}' })
  await hermes.start()
})
afterAll(async () => { await hermes?.stopAndWait(); await stub?.close(); home?.cleanup() })

describe('spike 5: keys only in the process environment', () => {
  it('works for the main and the auxiliary client and stays out of the terminal', async () => {
    const client = new HermesClient(hermes)
    const { session_id } = await client.createSession()
    await client.runTurn(session_id, 'TOOL:terminal ARGS:{"command":"env"}')
    // the session title is an auxiliary call made after the first turn
    const deadline = Date.now() + 15_000
    while (!stub.requests.some((r) => r.raw.includes('You name chat sessions')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
    const aux = stub.requests.filter((r) => r.raw.includes('You name chat sessions'))
    expect(aux.length).toBeGreaterThan(0)
    for (const r of stub.requests) expect(r.headers.authorization).toBe(`Bearer ${KEY}`)
    const terminal = stub.requests.find((r) => r.body.messages.some((m) => m.role === 'tool' && JSON.stringify(m.content).includes('HERMES_HOME')))!.raw
    expect(terminal).not.toContain('SECRETVALUE')
    expect(terminal).toContain('PRIVATEVALUE') // no plugin here → documents why tomo-privacy pops TOMO_PRIVATE
  })
})
