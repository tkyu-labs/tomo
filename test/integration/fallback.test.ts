// Fallback provider: with a second connection Tomo writes Hermes' fallback_model; when the provider in use fails
// (429 here), the turn is answered by the fallback, the chat gets a `fallback` event and the study log records it.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { AppController } from '../../src/main/app/controller'
import type { ChatEvent } from '../../src/shared/ipc'
import { devRuntime } from '../../src/main/hermes/runtime'
import { tomoPaths } from '../../src/main/paths'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { repoRoot } from '../helpers/hermes'

type Stub = { url: string; requests: { url: string; raw: string }[]; close(): Promise<void> }
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a))
let good: Stub // GakuenAI (Responses protocol): the fallback
let failing: Stub // custom endpoint: the provider in use, always 429
let dir: string
let ctl: AppController
const events: [string, ChatEvent][] = []

beforeAll(async () => {
  good = await startStubModel()
  failing = await startStubModel({ failStatus: 429 })
  dir = mkdtempSync(join(tmpdir(), 'tomo-fb-'))
  ctl = new AppController({
    paths: tomoPaths(join(dir, 'data')),
    runtime: devRuntime(repoRoot),
    encryptor: { isAvailable: () => true, encrypt: (s) => xor(Buffer.from(s)), decrypt: (b) => xor(b).toString() },
    packsSourceDir: join(repoRoot, 'test/fixtures/packs'),
    pluginsDir: join(repoRoot, 'plugins'),
    runtimeDir: join(repoRoot, '.dev', 'home', 'tools'),
    baseEnv: { PATH: process.env.PATH, HOME: join(dir, 'home'), TMPDIR: process.env.TMPDIR },
    gakuenUrl: good.url,
    emit: { chat: (s, e) => events.push([s, e]), request: () => {}, setupTask: () => {}, engineState: () => {} },
  })
  ctl.connectProvider({ id: 'gakuen', model: 'stub-model' }, 'gk-test-key', ['stub-model'])
  ctl.selectPack('example-u')
  expect(await ctl.finishSetup({ full_name: { name: 'Lin Mei', furigana: 'リン メイ' }, student_number: '23B0001', faculty: 'B', year: 3 })).toEqual({ ok: true })
  ctl.completeSetup()
  // a second provider from Settings: it becomes the one in use, GakuenAI turns into the fallback
  await ctl.addProvider({ id: 'custom', model: 'stub-model', baseUrl: failing.url }, 'sk-failing', ['stub-model'])
})
afterAll(async () => { await ctl?.stopEngine(); await good?.close(); await failing?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('fallback provider', () => {
  it('is on by default and written to the config', () => {
    const st = ctl.getState()
    expect(st.provider?.id).toBe('custom')
    expect(st.connections.map((c) => c.id)).toEqual(['gakuen', 'custom'])
    expect(st.fallback).toEqual({ id: 'gakuen', model: 'stub-model' })
    const config = parse(readFileSync(join(dir, 'data', 'hermes', 'config.yaml'), 'utf8'))
    expect(config.fallback_model).toEqual({ provider: 'custom:gakuen', model: 'stub-model' })
    expect(config.model).toMatchObject({ provider: 'custom:endpoint' })
  })

  it('answers through the fallback when the provider in use fails, marks the turn and logs it', async () => {
    const sid = await ctl.createSession()
    const before = events.length
    const goodBefore = good.requests.length
    await ctl.send(sid, 'Hello from {{FULL_NAME}}')
    const end = Date.now() + 150_000
    while (!events.slice(before).some(([s, e]) => s === sid && e.kind === 'complete') && Date.now() < end) await new Promise((r) => setTimeout(r, 200))
    await new Promise((r) => setTimeout(r, 1000)) // the notice may follow `complete`
    const mine = events.slice(before).filter(([s]) => s === sid).map(([, e]) => e)
    const done = mine.find((e) => e.kind === 'complete')
    expect(done && done.kind === 'complete' && !done.error).toBe(true)
    expect(failing.requests.length).toBeGreaterThan(0)
    expect(good.requests.length).toBeGreaterThan(goodBefore)
    expect(mine.find((e) => e.kind === 'fallback')).toEqual({ kind: 'fallback', provider: 'gakuen', model: 'stub-model', from: 'custom' })
    const rec = ctl.study.records().at(-1)!
    expect(rec).toMatchObject({ fallback: true, model: 'gakuen/stub-model' })
    // never the real name, on either provider
    expect([...good.requests, ...failing.requests].some((r) => /Lin Mei/.test(r.raw))).toBe(false)
  })

  it('turning it off removes it from the config', async () => {
    await ctl.setFallback(null)
    expect(ctl.getState().fallback).toBeNull()
    const config = parse(readFileSync(join(dir, 'data', 'hermes', 'config.yaml'), 'utf8'))
    expect(config.fallback_model).toBeUndefined()
  })
})
