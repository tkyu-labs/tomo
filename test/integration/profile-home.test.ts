// M4 "done when": the home Tomo generates passes Hermes' setup.runtime_check, and a turn sees Tomo's SOUL, the
// Hatch USER.md entries (placeholders only) and the pack's skill — with the real values masked end to end.
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HermesClient } from '../../src/main/hermes/client'
import { buildHermesEnv } from '../../src/main/hermes/env'
import { HermesProcess } from '../../src/main/hermes/process'
import { devRuntime } from '../../src/main/hermes/runtime'
import { installPack } from '../../src/main/pack/pack'
import { privatePayload, writeProfile } from '../../src/main/setup/profile'
import { Masker } from '../../src/shared/privacy/masker'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { repoRoot } from '../helpers/hermes'
import { removeDir } from '../helpers/remove-dir.mjs'

let stub: { url: string; requests: { raw: string; body: { messages: { role: string; content: unknown }[] } }[]; close(): Promise<void> }
let dir: string
let hermes: HermesProcess
let masker: Masker

beforeAll(async () => {
  stub = await startStubModel()
  dir = mkdtempSync(join(tmpdir(), 'tomo-profile-'))
  const fakeHome = join(dir, 'home')
  mkdirSync(fakeHome)
  const pack = installPack(join(repoRoot, 'test/fixtures/packs/example-u'), dir)
  const hermesHome = join(dir, 'hermes')
  const answers = { full_name: { name: 'Lin Mei', furigana: 'リン メイ' }, student_number: '23B0001', faculty: 'B', year: 3, grades_consent: 'watch' }
  const res = writeProfile({ hermesHome, pluginsSourceDir: join(repoRoot, 'plugins'), pack, provider: { id: 'custom', model: 'stub-model', baseUrl: stub.url }, answers })
  masker = new Masker(res.identifiers)
  const env = buildHermesEnv({
    base: { ...process.env, HOME: fakeHome }, hermesHome, cacheDir: join(repoRoot, '.dev', 'cache'),
    keys: { TOMO_CUSTOM_API_KEY: 'stub' }, privatePayload: privatePayload(res.identifiers, pack),
  })
  hermes = new HermesProcess({ runtime: devRuntime(repoRoot), env })
  await hermes.start()
})
afterAll(async () => { await hermes?.stopAndWait(); await stub?.close(); removeDir(dir) })

describe('generated Hermes home', () => {
  it('passes setup.runtime_check', async () => {
    const check = await hermes.rpc.request('setup.runtime_check', {})
    expect(check).toMatchObject({ ok: true, model: 'stub-model' })
    expect(String(check.provider)).toMatch(/^custom/)
  })

  it('gives the model Tomo\'s SOUL, the Hatch profile and the pack skill', async () => {
    const client = new HermesClient(hermes, masker)
    const { session_id } = await client.createSession()
    const events = await client.runTurn(session_id, 'Hi, I am Lin Mei (23B0001)')
    const req = stub.requests.find((r) => r.raw.includes('Hi, I am'))!
    const system = String(req.body.messages[0]!.content)
    expect(system).toContain('You are Tomo, a companion for an international student')
    expect(system).toContain('Student number: {{STUDENT_NUMBER}}.')
    expect(system).toContain('Example University has two faculties')
    expect(system).toContain('campus-portal')
    expect(req.raw).toContain('Hi, I am {{FULL_NAME}} ({{STUDENT_NUMBER}})')
    expect(req.raw).not.toMatch(/Lin Mei|23B0001/)
    expect(events.at(-1)?.kind).toBe('complete')
  })
})

describe('model settings', () => {
  it('lists the provider models and switches thinking level and model', async () => {
    const { listModels, setReasoning, setModel } = await import('../../src/main/setup/model')
    const { readFileSync } = await import('node:fs')
    const { parse } = await import('yaml')
    const models = await listModels(hermes.rpc)
    expect(models.models).toContain('stub-model')
    await setReasoning(hermes.rpc, 'high')
    const { session_id } = await new HermesClient(hermes).createSession()
    await setModel(hermes.rpc, session_id, 'stub-model-2', 'custom:endpoint')
    const config = parse(readFileSync(join(dir, 'hermes', 'config.yaml'), 'utf8'))
    expect(config.agent.reasoning_effort).toBe('high')
    expect(config.model.default).toBe('stub-model-2')
  })
})
