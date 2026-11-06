// The tool chain the shonan-it `school-info` skill relies on, through a real Hermes (stub model drives the tools):
// DuckDuckGo web search (ddgs extra) with site:, a PDF download with curl into $TOMO_DOWNLOADS without any approval
// prompt, read_file on that PDF (local text extraction), and keeping it in $TOMO_DOCUMENTS.
// Needs network (DuckDuckGo, www.shonan-it.ac.jp). Run: TOMO_NET_TESTS=1 npx vitest run test/real/school-info-tools.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppController } from '../../src/main/app/controller'
import type { ChatEvent, EngineRequest } from '../../src/shared/ipc'
import { devRuntime } from '../../src/main/hermes/runtime'
import { tomoPaths } from '../../src/main/paths'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { repoRoot } from '../helpers/hermes'

const NET = !!process.env.TOMO_NET_TESTS
const PDF = 'https://www.shonan-it.ac.jp/media/schedule2026_AB.pdf'
type Stub = { url: string; requests: { raw: string }[]; script: unknown[]; close(): Promise<void> }
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a))
let stub: Stub
let dir: string
let ctl: AppController
const events: [string, ChatEvent][] = []
const requests: EngineRequest[] = []

describe.skipIf(!NET)('school-info tool chain', () => {
  beforeAll(async () => {
    stub = await startStubModel()
    dir = mkdtempSync(join(tmpdir(), 'tomo-si-'))
    ctl = new AppController({
      paths: tomoPaths(join(dir, 'data')),
      runtime: devRuntime(repoRoot),
      encryptor: { isAvailable: () => true, encrypt: (s) => xor(Buffer.from(s)), decrypt: (b) => xor(b).toString() },
      packsSourceDir: join(repoRoot, 'test/fixtures/packs'),
      pluginsDir: join(repoRoot, 'plugins'),
      runtimeDir: join(repoRoot, '.dev', 'home', 'tools'),
      baseEnv: { PATH: process.env.PATH, HOME: join(dir, 'home'), TMPDIR: process.env.TMPDIR, SystemRoot: process.env.SystemRoot, USERPROFILE: join(dir, 'home') },
      documentsDir: join(dir, 'Documents', 'Tomo'),
      emit: { chat: (s, e) => events.push([s, e]), request: (r) => { requests.push(r); ctl.respond(r.id, { approved: false }) }, setupTask: () => {}, engineState: () => {} },
    })
    ctl.connectProvider({ id: 'custom', model: 'stub-model', baseUrl: stub.url }, 'stub-key')
    ctl.selectPack('example-u')
    expect(await ctl.finishSetup({ full_name: { name: 'Lin Mei', furigana: 'リン メイ' }, student_number: '23B0001', faculty: 'B', year: 3 })).toEqual({ ok: true })
    ctl.completeSetup()
  })
  afterAll(async () => { await ctl?.stopEngine(); await stub?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('searches the school site, downloads and reads the calendar PDF and keeps it, without asking', async () => {
    const downloaded = join(dir, 'data', 'downloads', 'schedule2026_AB.pdf')
    const kept = join(dir, 'Documents', 'Tomo', 'shonan-it', 'R8学年暦_学部.pdf')
    stub.script.push(
      { tool: 'web_search', args: { query: '学年暦 site:shonan-it.ac.jp' } },
      { tool: 'terminal', args: { command: `mkdir -p "$TOMO_DOWNLOADS" && curl -fsSL --max-time 60 -o "$TOMO_DOWNLOADS/schedule2026_AB.pdf" "${PDF}" && echo "$TOMO_DOWNLOADS/schedule2026_AB.pdf"` } },
      { tool: 'read_file', args: { path: downloaded } },
      { tool: 'terminal', args: { command: 'mkdir -p "$TOMO_DOCUMENTS/shonan-it" && cp "$TOMO_DOWNLOADS/schedule2026_AB.pdf" "$TOMO_DOCUMENTS/shonan-it/R8学年暦_学部.pdf" && echo kept' } },
      { text: 'done' },
    )
    const sid = await ctl.createSession()
    const before = events.length
    await ctl.send(sid, 'When is the summer break?')
    const end = Date.now() + 240_000
    while (!events.slice(before).some(([s, e]) => s === sid && e.kind === 'complete') && Date.now() < end) await new Promise((r) => setTimeout(r, 300))
    const tools = events.slice(before).filter(([s, e]) => s === sid && e.kind === 'tool.complete').map(([, e]) => (e as { name: string }).name)
    expect(tools).toEqual(['web_search', 'terminal', 'read_file', 'terminal'])
    // the last main request (the one that offers tools; title generation runs on the side)
    const last = stub.requests.filter((r) => r.raw.includes('"tools"')).at(-1)!.raw
    expect(last).toMatch(/shonan-it\.ac\.jp/) // search results from the school's site
    expect(last).toMatch(/夏季休業期間/) // the PDF's text reached the model
    expect(existsSync(downloaded)).toBe(true)
    expect(existsSync(kept)).toBe(true)
    expect(requests).toEqual([]) // no approval or question on the way
  })
})
