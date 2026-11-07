// GakuenAI is configured as a custom provider with the OpenAI Responses protocol (codex_responses). A turn through
// Hermes against the stub's /v1/responses proves the generated config works for that transport.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HermesClient } from '../../src/main/hermes/client'
import { buildHermesEnv } from '../../src/main/hermes/env'
import { HermesProcess } from '../../src/main/hermes/process'
import { devRuntime } from '../../src/main/hermes/runtime'
import { writeProfile } from '../../src/main/setup/profile'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { repoRoot } from '../helpers/hermes'
import { removeDir } from '../helpers/remove-dir.mjs'

let stub: { url: string; requests: { url: string; headers: Record<string, string> }[]; close(): Promise<void> }
let dir: string
let hermes: HermesProcess

beforeAll(async () => {
  stub = await startStubModel()
  dir = mkdtempSync(join(tmpdir(), 'tomo-gakuen-'))
  mkdirSync(join(dir, 'home'))
  writeProfile({ hermesHome: join(dir, 'hermes'), pluginsSourceDir: join(repoRoot, 'plugins'), provider: { id: 'gakuen', model: 'stub-model', baseUrl: stub.url }, answers: {} })
  hermes = new HermesProcess({
    runtime: devRuntime(repoRoot),
    env: buildHermesEnv({ base: { ...process.env, HOME: join(dir, 'home') }, hermesHome: join(dir, 'hermes'), cacheDir: join(repoRoot, '.dev', 'cache'), keys: { GAKUEN_API_KEY: 'gk-test' } }),
  })
  await hermes.start()
})
afterAll(async () => { await hermes?.stopAndWait(); await stub?.close(); removeDir(dir) })

describe('GakuenAI (Responses protocol)', () => {
  it('answers a turn through /v1/responses with the GakuenAI key', async () => {
    const client = new HermesClient(hermes)
    const { session_id } = await client.createSession()
    const events = await client.runTurn(session_id, 'Hello GakuenAI')
    const text = events.filter((e) => e.kind === 'delta').map((e) => (e as { text: string }).text).join('')
    expect(text).toContain('Stub answer: Hello GakuenAI')
    const main = stub.requests.filter((r) => r.url.endsWith('/responses'))
    expect(main.length).toBeGreaterThan(0)
    expect(main[0]!.headers.authorization).toBe('Bearer gk-test')
  })
})
