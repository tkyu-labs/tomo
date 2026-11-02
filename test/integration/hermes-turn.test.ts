// M2 "done when": one real turn through the pinned Hermes gateway against the local stub model, with streamed
// deltas, a tool call and message.complete; nothing written outside HERMES_HOME.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HermesClient, type TurnEvent } from '../../src/main/hermes/client'
import type { HermesProcess } from '../../src/main/hermes/process'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { makeTestHome, startHermes, stubConfig, type TestHome } from '../helpers/hermes'

let stub: { url: string; requests: unknown[]; close(): Promise<void> }
let home: TestHome
let hermes: HermesProcess

beforeAll(async () => {
  stub = await startStubModel()
  home = makeTestHome(stubConfig(stub.url))
  hermes = startHermes(home)
  await hermes.start()
})

afterAll(async () => {
  await hermes?.stopAndWait()
  await stub?.close()
  home?.cleanup()
})

describe('Hermes gateway turn (stub model)', () => {
  it('answers ping', async () => {
    expect(await hermes.rpc.request('ping', {})).toEqual({ pong: true })
  })

  it('streams a plain answer', async () => {
    const client = new HermesClient(hermes)
    const { session_id } = await client.createSession()
    const events = await client.runTurn(session_id, 'Hello from Lin Mei')
    const deltas = events.filter((e) => e.kind === 'delta').map((e) => (e as { text: string }).text).join('')
    expect(deltas).toContain('Stub answer: Hello from Lin Mei')
    expect(events.at(-1)).toMatchObject({ kind: 'complete' })
  })

  it('runs a tool call and completes', async () => {
    const client = new HermesClient(hermes)
    const { session_id } = await client.createSession()
    const events = await client.runTurn(session_id, 'Please use a tool now')
    const kinds = events.map((e: TurnEvent) => e.kind)
    expect(kinds).toContain('tool.start')
    expect(kinds).toContain('tool.complete')
    const complete = events.at(-1) as Extract<TurnEvent, { kind: 'complete' }>
    expect(complete.kind).toBe('complete')
    expect(complete.text).toContain('Tool finished')
  })

  it('wrote nothing to the user home', () => {
    expect(home.writtenToFakeHome()).toEqual([])
  })
})
