// A school pack update (staged from a changed copy of the fixture pack, as main would hold it) is installed automatically, SOUL.md is
// rebuilt from the new pack and the engine restarts, so the next question runs on the new pack.
import { cpSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppController } from '../../src/main/app/controller'
import type { ChatEvent } from '../../src/shared/ipc'
import { devRuntime } from '../../src/main/hermes/runtime'
import { loadPack } from '../../src/main/pack/pack'
import { tomoPaths } from '../../src/main/paths'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { repoRoot } from '../helpers/hermes'
import { removeDir } from '../helpers/remove-dir.mjs'

const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a))
const fixture = join(repoRoot, 'test/fixtures/packs/example-u')
let stub: { url: string; close(): Promise<void> }
let dir: string
let ctl: AppController
const events: [string, ChatEvent][] = []

beforeAll(async () => {
  stub = await startStubModel()
  dir = mkdtempSync(join(tmpdir(), 'tomo-pu-'))
  ctl = new AppController({
    paths: tomoPaths(join(dir, 'data')),
    runtime: devRuntime(repoRoot),
    encryptor: { isAvailable: () => true, encrypt: (s) => xor(Buffer.from(s)), decrypt: (b) => xor(b).toString() },
    remotePacks: async () => join(repoRoot, 'test/fixtures/packs'), // stands in for tomo-packs main
    pluginsDir: join(repoRoot, 'plugins'),
    runtimeDir: join(repoRoot, '.dev', 'home', 'tools'),
    baseEnv: { PATH: process.env.PATH, HOME: join(dir, 'home'), TMPDIR: process.env.TMPDIR },
    emit: { chat: (s, e) => events.push([s, e]), request: () => {}, setupTask: () => {}, engineState: () => {} },
    packUpdates: {
      remote: async () => ({ commit: 'b'.repeat(40), version: '0.0.2', lock: 'changed' }),
      stage: async (_id, r, stageDir) => {
        const v = r.version
        const d = join(stageDir, 'example-u')
        cpSync(fixture, d, { recursive: true })
        writeFileSync(join(d, 'pack.yaml'), readFileSync(join(d, 'pack.yaml'), 'utf8').replace('version: 0.0.1', `version: ${v}`))
        writeFileSync(join(d, 'soul.md'), readFileSync(join(d, 'soul.md'), 'utf8') + '\nNew in 0.0.2: the library opens at 9:00.\n')
        return loadPack(d)
      },
    },
  })
  ctl.connectProvider({ id: 'custom', model: 'stub-model', baseUrl: stub.url }, 'stub-key')
  await ctl.listPacks()
  ctl.selectPack('example-u')
  expect(await ctl.finishSetup({ full_name: { name: 'Lin Mei', furigana: 'リン メイ' }, student_number: '23B0001', faculty: 'B', year: 3 })).toEqual({ ok: true })
  ctl.completeSetup()
})
afterAll(async () => { await ctl?.stopEngine(); await stub?.close(); removeDir(dir) })

describe('school pack update', () => {
  it('installs automatically, rebuilds SOUL.md and restarts the engine for the next question', async () => {
    const soul = () => readFileSync(join(dir, 'data', 'hermes', 'SOUL.md'), 'utf8')
    expect(soul()).not.toContain('library opens at 9:00')
    await ctl.packUpdater.check()
    expect(ctl.getState().pack?.manifest.version).toBe('0.0.2')
    expect(ctl.getState().packUpdate.installed?.version).toBe('0.0.2')
    const end = Date.now() + 60_000
    while (!(soul().includes('library opens at 9:00') && ctl.getState().engine.state === 'ready') && Date.now() < end) await new Promise((r) => setTimeout(r, 300))
    expect(soul()).toContain('library opens at 9:00')
    expect(ctl.getState().engine.state).toBe('ready')
    const sid = await ctl.createSession()
    const before = events.length
    await ctl.send(sid, 'Hello after the update')
    const stop = Date.now() + 30_000
    while (!events.slice(before).some(([s, e]) => s === sid && e.kind === 'complete') && Date.now() < stop) await new Promise((r) => setTimeout(r, 200))
    expect(events.slice(before).some(([s, e]) => s === sid && e.kind === 'complete' && !e.error)).toBe(true)
  })
})
