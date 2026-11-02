// M7 (automated part of spikes 1, 2 and 4) with the user's Chrome, headed, in a throw-away profile:
// - agent-browser honours AGENT_BROWSER_EXECUTABLE_PATH / AGENT_BROWSER_PROFILE, the profile keeps a cookie across
//   an engine restart;
// - tomo-privacy fills {{STUDENT_NUMBER}} into a page only on an allowed origin and after approval, and the model
//   only ever sees the placeholder; another origin is refused;
// - the campussquare skill's browser_console extraction works on a portal-like fixture page.
// Runs only where Chrome and the dev agent-browser exist (scripts/dev-hermes.sh + `hermes pm install agent-browser`).
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { findBrowsers } from '../../src/main/app/browsers'
import { HermesClient } from '../../src/main/hermes/client'
import { buildHermesEnv } from '../../src/main/hermes/env'
import { HermesProcess } from '../../src/main/hermes/process'
import { devRuntime } from '../../src/main/hermes/runtime'
import { installPack } from '../../src/main/pack/pack'
import { writeProfile } from '../../src/main/setup/profile'
import { Masker } from '../../src/shared/privacy/masker'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
// @ts-expect-error plain JS test helper
import { startPortal } from '../fixtures/portal/server.mjs'
import { repoRoot } from '../helpers/hermes'

const devTools = join(repoRoot, '.dev', 'home', 'tools')
const chrome = findBrowsers(process.platform, process.env.HOME ?? '', process.env)[0]
const ready = !!chrome && existsSync(devTools) && readdirSync(devTools).some((n) => n.startsWith('agent-browser'))
const extractMd = join(repoRoot, 'tomo-packs/packs/shonan-it/skills/campussquare/references/extract.md')

type Req = { raw: string; body: { messages: { role: string; content: unknown }[] } }
let stub: { url: string; requests: Req[]; script: unknown[]; close(): Promise<void> }
let portal: { base: string; altBase: string; echoes: string[]; signIn(): void; close(): Promise<void> }
let dir: string
let hermes: HermesProcess
let client: HermesClient
const approvals: Record<string, unknown>[] = []
const approve = true
const identifiers = [{ name: 'STUDENT_NUMBER', values: ['23B0001'], kind: 'id' as const, label: 'student number' }, { name: 'FULL_NAME', values: ['Lin Mei'], kind: 'name' as const, label: 'name' }]

async function start() {
  const env = buildHermesEnv({
    base: { ...process.env, HOME: join(dir, 'home') }, hermesHome: join(dir, 'hermes'), runtimeDir: devTools,
    cacheDir: join(repoRoot, '.dev', 'cache'), keys: { TOMO_CUSTOM_API_KEY: 'stub' },
    privatePayload: JSON.stringify({ identifiers, fill: { tools: ['browser_type'], origins: ['127.0.0.1'] } }),
    browser: { executablePath: chrome!.path, profileDir: join(dir, 'browser-profile') },
  })
  hermes = new HermesProcess({ runtime: devRuntime(repoRoot), env, onServerRequest: async (m, p) => {
    if (m === 'approval') { approvals.push(p as Record<string, unknown>); return { choice: approve ? 'once' : 'deny' } }
    return { value: '' }
  } })
  await hermes.start()
  client = new HermesClient(hermes, new Masker(identifiers))
}

/** One turn that runs the scripted tool calls, then answers. Returns the tool results the model received. */
async function run(steps: { tool: string; args: Record<string, unknown> }[]) {
  if (stub.script.length) console.log('LEFTOVER', JSON.stringify(stub.script))
  stub.script.length = 0
  stub.script.push(...steps, { text: 'done' })
  const { session_id } = await client.createSession()
  const before = stub.requests.length
  await client.runTurn(session_id, 'run the plan', undefined, 180_000)
  return stub.requests.slice(before).flatMap((r) => r.body.messages.filter((m) => m.role === 'tool').map((m) => String(m.content))).filter((v, i, a) => a.indexOf(v) === i)
}

beforeAll(async () => {
  if (!ready) return
  stub = await startStubModel()
  portal = await startPortal()
  dir = mkdtempSync(join(tmpdir(), 'tomo-browser-'))
  mkdirSync(join(dir, 'home'))
  const pack = installPack(join(repoRoot, 'test/fixtures/packs/example-u'), dir)
  writeProfile({ hermesHome: join(dir, 'hermes'), pluginsSourceDir: join(repoRoot, 'plugins'), pack, provider: { id: 'custom', model: 'stub-model', baseUrl: stub.url }, answers: {} })
  // test only: the fixture portal runs on 127.0.0.1
  const cfgFile = join(dir, 'hermes', 'config.yaml')
  const cfg = parse(readFileSync(cfgFile, 'utf8'))
  cfg.browser.allow_private_urls = true
  writeFileSync(cfgFile, stringify(cfg))
  await start()
}, 120_000)
afterAll(async () => { await hermes?.stopAndWait(); await stub?.close(); await portal?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

describe.skipIf(!ready)('browser (Chrome, headed, Tomo profile)', () => {
  it('fills the student number on an allowed page only after approval; the model sees the placeholder', async () => {
    const results = await run([
      { tool: 'browser_navigate', args: { url: `${portal.base}/form` } },
      { tool: 'browser_type', args: { ref: '@e1', text: '{{STUDENT_NUMBER}}' } },
      { tool: 'browser_console', args: { expression: "document.querySelector('#sid').value" } },
    ])
    expect(approvals.length).toBe(1)
    expect(JSON.stringify(approvals[0])).toContain('[tomo-privacy]')
    expect(JSON.stringify(approvals[0])).toContain('127.0.0.1')
    expect(portal.echoes.at(-1)).toBe('23B0001') // the page got the real value
    expect(results.join('\n')).toContain('{{STUDENT_NUMBER}}') // the model read back only the placeholder
    for (const r of stub.requests) expect(r.raw).not.toMatch(/23B0001|Lin Mei/)
  }, 240_000)

  it('refuses to fill on another origin', async () => {
    const results = await run([
      { tool: 'browser_navigate', args: { url: `${portal.altBase}/form` } },
      { tool: 'browser_type', args: { ref: '@e1', text: '{{STUDENT_NUMBER}}' } },
    ])
    expect(results.join('\n')).toContain('may only be filled in')
    expect(approvals.length).toBe(1) // nobody was asked again
  }, 240_000)

  it.skipIf(!existsSync(extractMd))('runs the campussquare extraction on a portal-like page, masked', async () => {
    portal.signIn()
    const js = readFileSync(extractMd, 'utf8').match(/```js\n([\s\S]*?)```/)![1]!.replace('const HEADER = "科目大区分"', 'const HEADER = "開講科目名"')
    const results = await run([
      { tool: 'browser_navigate', args: { url: `${portal.base}/grades` } },
      { tool: 'browser_console', args: { expression: js } },
    ])
    const out = results.join('\n')
    expect(out).toContain('情報リテラシー')
    expect(out).toContain('開講科目名')
    expect(out).not.toMatch(/23B0001|Lin Mei/)
  }, 240_000)

  it('keeps the profile (cookie) across an engine restart', async () => {
    await run([{ tool: 'browser_navigate', args: { url: `${portal.base}/set` } }])
    await hermes.stopAndWait()
    await start()
    const results = await run([
      { tool: 'browser_navigate', args: { url: `${portal.base}/check` } },
      { tool: 'browser_console', args: { expression: "document.querySelector('#c').textContent" } },
    ])
    expect(results.join('\n')).toContain('cookie:kept')
    expect(existsSync(join(dir, 'browser-profile'))).toBe(true)
  }, 300_000)
})
