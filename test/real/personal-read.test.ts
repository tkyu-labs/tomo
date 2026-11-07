// Personal-data gate with a real model (opt-in: TOMO_REAL_MODEL=1 + OPENAI_API_KEY, Chrome + dev agent-browser).
// The fixture portal plays the school's personal-data site. Asked for a grade, the model must not ask for permission
// itself (no clarify), must read the value with browser_console, and the value reaches it only through Tomo's own
// approval; when the student does not allow it, the answer does not contain it.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { findBrowsers } from '../../src/main/app/browsers'
import { HermesClient, type TurnEvent } from '../../src/main/hermes/client'
import { buildHermesEnv } from '../../src/main/hermes/env'
import { HermesProcess } from '../../src/main/hermes/process'
import { devRuntime } from '../../src/main/hermes/runtime'
import { installPack } from '../../src/main/pack/pack'
import { writeProfile } from '../../src/main/setup/profile'
import { Masker } from '../../src/shared/privacy/masker'
// @ts-expect-error plain JS test helper
import { startPortal } from '../fixtures/portal/server.mjs'
import { repoRoot } from '../helpers/hermes'
import { removeDir } from '../helpers/remove-dir.mjs'

const devTools = join(repoRoot, '.dev', 'home', 'tools')
const chrome = findBrowsers(process.platform, process.env.HOME ?? '', process.env)[0]
const enabled = !!process.env.TOMO_REAL_MODEL && !!process.env.OPENAI_API_KEY && !!chrome && existsSync(devTools) && readdirSync(devTools).some((n) => n.startsWith('agent-browser'))
const identifiers = [{ name: 'STUDENT_NUMBER', values: ['23B0001'], kind: 'id' as const }, { name: 'FULL_NAME', values: ['Lin Mei'], kind: 'name' as const }]

async function ask(allow: boolean) {
  const portal = await startPortal()
  portal.signIn() // already signed in: this test is about reading, not signing in
  const dir = mkdtempSync(join(tmpdir(), 'tomo-personal-'))
  mkdirSync(join(dir, 'home'))
  const pack = installPack(join(repoRoot, 'test/fixtures/packs/example-u'), dir)
  writeProfile({ hermesHome: join(dir, 'hermes'), pluginsSourceDir: join(repoRoot, 'plugins'), pack, provider: { id: 'openai-api', model: process.env.TOMO_REAL_OPENAI_MODEL ?? 'gpt-6-luna' }, answers: {} })
  const cfgFile = join(dir, 'hermes', 'config.yaml')
  const cfg = parse(readFileSync(cfgFile, 'utf8'))
  cfg.browser.allow_private_urls = true // test only: the fixture portal is on 127.0.0.1
  writeFileSync(cfgFile, stringify(cfg))
  const requests: { method: string; params: Record<string, unknown> }[] = []
  const hermes = new HermesProcess({
    runtime: devRuntime(repoRoot),
    env: buildHermesEnv({
      base: { ...process.env, HOME: join(dir, 'home') }, hermesHome: join(dir, 'hermes'), runtimeDir: devTools,
      cacheDir: join(repoRoot, '.dev', 'cache'), keys: { OPENAI_API_KEY: process.env.OPENAI_API_KEY! },
      privatePayload: JSON.stringify({ identifiers, fill: { tools: ['browser_type'], origins: ['127.0.0.1'] }, personal: { origins: ['127.0.0.1'], consent: 'ask' } }),
      browser: { executablePath: chrome!.path, profileDir: join(dir, 'browser-profile') },
    }),
    onServerRequest: async (method, params) => {
      requests.push({ method, params: params as Record<string, unknown> })
      if (method === 'approval') return { choice: allow ? 'once' : 'deny' }
      return {} // clarify: skipped
    },
  })
  try {
    await hermes.start()
    const client = new HermesClient(hermes, new Masker(identifiers))
    const { session_id } = await client.createSession()
    const evs = await client.runTurn(session_id, `Open ${portal.base}/grades in the browser and tell me my grade (評価) in 情報リテラシー.`, undefined, 300_000)
    const tools = (evs.filter((e) => e.kind === 'tool.start') as Extract<TurnEvent, { kind: 'tool.start' }>[]).map((t) => t.name)
    const last = evs.at(-1)
    return { tools, requests, answer: last && last.kind === 'complete' ? last.text : '' }
  } finally {
    await hermes.stopAndWait()
    await portal.close()
    removeDir(dir)
  }
}

const sends = (r: { requests: { method: string; params: Record<string, unknown> }[] }) =>
  r.requests.filter((q) => q.method === 'approval' && String(q.params.description ?? '').includes('"kind": "consent"'))

describe.skipIf(!enabled)('real model on a personal-data site', () => {
  it('reads through Tomo\'s approval, never asks itself, and answers when allowed', async () => {
    const r = await ask(true)
    console.log('REAL personal allow', JSON.stringify({ tools: r.tools, requests: r.requests.map((q) => q.method), answer: r.answer.slice(0, 200) }))
    expect(r.requests.some((q) => q.method === 'clarify')).toBe(false)
    expect(sends(r).length).toBeGreaterThanOrEqual(1)
    expect(r.answer).toMatch(/88/)
  }, 600_000)

  it('answers without the value when the student does not allow it', async () => {
    const r = await ask(false)
    console.log('REAL personal deny', JSON.stringify({ tools: r.tools, requests: r.requests.map((q) => q.method), answer: r.answer.slice(0, 200) }))
    expect(r.requests.some((q) => q.method === 'clarify')).toBe(false)
    expect(sends(r).length).toBeGreaterThanOrEqual(1)
    expect(r.answer).not.toMatch(/\b88\b/)
  }, 600_000)
})
