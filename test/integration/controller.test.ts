// M6 "done when": a turn in each answer mode produces the expected study-log record, the mode reaches the model
// through the tomo plugin, cards arrive as events, and the exported log holds no real or placeholder values.
// Drives AppController (the window's backend) without Electron.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppController } from '../../src/main/app/controller'
import type { ChatEvent, TaskUpdate } from '../../src/shared/ipc'
import { devRuntime } from '../../src/main/hermes/runtime'
import { tomoPaths } from '../../src/main/paths'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { repoRoot } from '../helpers/hermes'

const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a))
let stub: { url: string; requests: { raw: string }[]; close(): Promise<void> }
let dir: string
let ctl: AppController
const events: [string, ChatEvent][] = []
const tasks: TaskUpdate[] = []

beforeAll(async () => {
  stub = await startStubModel()
  dir = mkdtempSync(join(tmpdir(), 'tomo-ctl-'))
  ctl = new AppController({
    paths: tomoPaths(join(dir, 'data')),
    runtime: devRuntime(repoRoot),
    encryptor: { isAvailable: () => true, encrypt: (s) => xor(Buffer.from(s)), decrypt: (b) => xor(b).toString() },
    packsSourceDir: join(repoRoot, 'test/fixtures/packs'),
    pluginsDir: join(repoRoot, 'plugins'),
    runtimeDir: join(repoRoot, '.dev', 'home', 'tools'), // reuse the dev agent-browser (no download in tests)
    baseEnv: { PATH: process.env.PATH, HOME: join(dir, 'home'), TMPDIR: process.env.TMPDIR },
    emit: { chat: (s, e) => events.push([s, e]), request: () => {}, setupTask: (u) => tasks.push(u), engineState: () => {} },
  })
  ctl.connectProvider({ id: 'custom', model: 'stub-model', baseUrl: stub.url }, 'stub-key')
  ctl.selectPack('example-u')
  const res = await ctl.finishSetup({ full_name: { name: 'Lin Mei', furigana: 'リン メイ' }, student_number: '23B0001', faculty: 'B', year: 3 })
  expect(res).toEqual({ ok: true })
  ctl.completeSetup()
})
afterAll(async () => { await ctl?.stopEngine(); await stub?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

const turn = async (sessionId: string, text: string, topic?: string) => {
  const before = events.length
  await ctl.send(sessionId, text, topic)
  const end = Date.now() + 30_000
  while (!events.slice(before).some(([s, e]) => s === sessionId && e.kind === 'complete') && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
  return events.slice(before).filter(([s]) => s === sessionId).map(([, e]) => e)
}

describe('answer modes and study log', () => {
  it('ran the five Finish tasks', () => {
    expect(tasks.filter((t) => t.state === 'done').map((t) => t.task)).toEqual(['engine', 'settings', 'profile', 'start', 'test'])
    // identifiers never in settings.json
    expect(readFileSync(join(dir, 'data', 'settings.json'), 'utf8')).not.toMatch(/Lin Mei|23B0001/)
  })

  it('logs a direct-answer turn with its card', async () => {
    ctl.setAnswerMode('direct')
    const id = await ctl.createSession()
    const evs = await turn(id, 'TOOL:tomo_card ARGS:{"kind":"sources","data":{"items":[{"title":"Guide for Lin Mei"}]}}', 'timetable')
    expect(evs.some((e) => e.kind === 'tool.start' && e.name === 'tomo_card')).toBe(true)
    const req = stub.requests.filter((r) => r.raw.includes('TOOL:tomo_card') && r.raw.includes('"tools"')).at(-1)!.raw
    expect(req).toContain('Answer mode: direct answer')
    const rec = ctl.study.records().at(-1)!
    expect(rec).toMatchObject({ mode: 'direct', topic: 'timetable', cards: ['sources'], sources_shown: 1, pack: 'example-u', turn: 1 })
  })

  it('logs an information-chain turn', async () => {
    ctl.setAnswerMode('chain')
    const id = await ctl.createSession()
    await turn(id, 'Where do I find the registration deadline?')
    const req = stub.requests.filter((r) => r.raw.includes('registration deadline') && r.raw.includes('"tools"')).at(-1)!.raw
    expect(req).toContain('Answer mode: information chain')
    expect(ctl.study.records().at(-1)).toMatchObject({ mode: 'chain', topic: null, status: 'complete' })
  })

  it('exports a log without real values or placeholders', () => {
    const out = join(dir, 'export.jsonl')
    expect(ctl.exportStudyLog(out)).toBe(2)
    const text = readFileSync(out, 'utf8')
    expect(text).not.toMatch(/Lin Mei|23B0001|\{\{|Guide|registration/)
  })
})
