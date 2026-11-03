// M3 "done when": with tomo-privacy loaded, no real identifier reaches the model, the session DB or a terminal
// child; a {{PLACEHOLDER}} is filled into an allow-listed tool only after the student's approval.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HermesClient } from '../../src/main/hermes/client'
import { Masker } from '../../src/shared/privacy/masker'
import type { HermesProcess } from '../../src/main/hermes/process'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { installPlugins, makeTestHome, startHermes, stubConfig, type TestHome } from '../helpers/hermes'

const NUMBER = '23B0001'
const NAME = 'Lin Mei'
type StubRequest = { raw: string; body: { messages: { role: string; content: unknown }[] } }
let stub: { url: string; requests: StubRequest[]; close(): Promise<void> }
let home: TestHome
let hermes: HermesProcess
const approvals: Record<string, unknown>[] = []

beforeAll(async () => {
  stub = await startStubModel()
  home = makeTestHome(stubConfig(stub.url, 'plugins:\n  enabled: [tomo-privacy]\n'))
  installPlugins(home, ['tomo-privacy'])
  const payload = {
    identifiers: [
      { name: 'STUDENT_NUMBER', values: [NUMBER], kind: 'id', label: 'student number' },
      { name: 'FULL_NAME', values: [NAME], kind: 'name', label: 'name' },
    ],
    // test-only policy: write_file stands in for browser_type, without an origin check
    fill: { tools: ['write_file'], origins: ['*'] },
  }
  hermes = startHermes(home, {
    privatePayload: JSON.stringify(payload),
    onServerRequest: async (method, params) => {
      if (method === 'approval') { approvals.push(params as Record<string, unknown>); return { choice: 'once' } }
      throw new Error('unexpected ' + method)
    },
  })
  await hermes.start()
})
afterAll(async () => { await hermes?.stopAndWait(); await stub?.close(); home?.cleanup() })

/** Raw body of the latest request that carries a tool result containing `marker` (titles run in parallel). */
const toolRequest = (marker: string) => [...stub.requests].reverse().find((r) => r.body.messages.some((m) => m.role === 'tool' && JSON.stringify(m.content).includes(marker)))?.raw ?? ''
const mainMasker = new Masker([{ name: 'STUDENT_NUMBER', values: [NUMBER], kind: 'id' }, { name: 'FULL_NAME', values: [NAME], kind: 'name' }])
const leaks = (text: string) => text.includes(NUMBER) || /lin\s*mei/i.test(text)

describe('tomo-privacy end to end', () => {
  it('keeps TOMO_PRIVATE away from terminal children', async () => {
    const client = new HermesClient(hermes)
    const { session_id } = await client.createSession()
    await client.runTurn(session_id, 'TOOL:terminal ARGS:{"command":"env"}')
    const tool = toolRequest('HERMES_HOME')
    expect(tool).toContain('HERMES_HOME')
    expect(tool).not.toContain('TOMO_PRIVATE')
    expect(leaks(tool)).toBe(false)
  })

  it('masks identifiers in tool output before the model sees them', async () => {
    const client = new HermesClient(hermes)
    const { session_id } = await client.createSession()
    // The command builds the values in the shell, so the user's own text contains neither (Tomo masks user input).
    await client.runTurn(session_id, 'TOOL:terminal ARGS:{"command":"echo Student $((23))B0001 is L$(echo i)n Mei"}')
    const last = toolRequest('Student')
    expect(last).toContain('{{STUDENT_NUMBER}}')
    expect(last).toContain('{{FULL_NAME}}')
    expect(leaks(last)).toBe(false)
  })

  it('masks the user\'s own text before it reaches Hermes', async () => {
    const client = new HermesClient(hermes, mainMasker)
    const { session_id } = await client.createSession()
    const events = await client.runTurn(session_id, `My name is ${NAME} and my number is ${NUMBER}`)
    const answer = events.filter((e) => e.kind === 'delta').map((e) => (e as { text: string }).text).join('')
    expect(answer).toContain('{{FULL_NAME}}')
    expect(answer).toContain('{{STUDENT_NUMBER}}')
  })

  it('never sent a real identifier to the model', async () => {
    await new Promise((r) => setTimeout(r, 3000)) // let the title call of the previous session arrive
    for (const r of stub.requests) if (leaks(r.raw)) { const i = r.raw.search(/23B0001|Lin\s*Mei/i); console.log('LEAK', r.raw.slice(Math.max(0, i - 300), i + 100)) }
    for (const r of stub.requests) expect(leaks(r.raw)).toBe(false)
  })

  it('never stored a real identifier in Hermes state', () => {
    const files: string[] = []
    const walk = (d: string) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else files.push(p) } }
    walk(home.hermesHome)
    // Tomo's own plugin sources are not Hermes state
    const state = files.filter((f) => !f.includes(`${sep}plugins${sep}`))
    const offenders = state.filter((f) => existsSync(f) && leaks(readFileSync(f).toString('latin1')))
    expect(offenders).toEqual([])
  })
  // Runs last: write_file (a stand-in for browser_type) stores an inline diff of what it wrote in its own display
  // metadata, which is expected for a file write and not part of the browser fill path.
  it('fills a placeholder only after approval and re-masks the result', async () => {
    const client = new HermesClient(hermes)
    const { session_id } = await client.createSession()
    const target = join(home.dir, 'filled.txt')
    const events = await client.runTurn(session_id, `TOOL:write_file ARGS:${JSON.stringify({ path: target, content: 'ID: {{STUDENT_NUMBER}}' })}`)
    
    expect(approvals.length).toBe(1)
    expect(JSON.stringify(approvals[0])).toContain('[tomo-privacy]')
    expect(readFileSync(target, 'utf8')).toBe(`ID: ${NUMBER}`)
    expect(events.at(-1)?.kind).toBe('complete')
    // tool.start carries the effective (filled) args (tools/tool_executor.py state.args) — the main process masks
    // every gateway event with the same rules before logging or forwarding
    const start = events.find((e) => e.kind === 'tool.start') as { args?: Record<string, unknown> } | undefined
    const masked = JSON.stringify(mainMasker.maskAny(start?.args))
    expect(masked).toContain('{{STUDENT_NUMBER}}')
    expect(masked).not.toContain(NUMBER)
    // the model's follow-up request (tool result) is masked too
    for (const r of stub.requests) expect(leaks(r.raw)).toBe(false)
  })

})
