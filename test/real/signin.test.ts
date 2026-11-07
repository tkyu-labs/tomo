// Spike 4, automated part, with a real model (opt-in: TOMO_REAL_MODEL=1 + OPENAI_API_KEY, Chrome + dev agent-browser):
// on a page with a sign-in form the agent stops and asks the student to sign in (never types into it), and after
// the student says they are done it continues and reads the page.
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

describe.skipIf(!enabled)('real model on a sign-in page', () => {
  it('stops for the student to sign in, then continues', async () => {
    const portal = await startPortal()
    const dir = mkdtempSync(join(tmpdir(), 'tomo-signin-'))
    mkdirSync(join(dir, 'home'))
    const identifiers = [{ name: 'STUDENT_NUMBER', values: ['23B0001'], kind: 'id' as const }, { name: 'FULL_NAME', values: ['Lin Mei'], kind: 'name' as const }]
    const pack = installPack(join(repoRoot, 'test/fixtures/packs/example-u'), dir)
    writeProfile({ hermesHome: join(dir, 'hermes'), pluginsSourceDir: join(repoRoot, 'plugins'), pack, provider: { id: 'openai-api', model: process.env.TOMO_REAL_OPENAI_MODEL ?? 'gpt-6-luna' }, answers: {} })
    const cfgFile = join(dir, 'hermes', 'config.yaml')
    const cfg = parse(readFileSync(cfgFile, 'utf8'))
    cfg.browser.allow_private_urls = true // test only: the fixture portal is on 127.0.0.1
    writeFileSync(cfgFile, stringify(cfg))
    const hermes = new HermesProcess({
      runtime: devRuntime(repoRoot),
      env: buildHermesEnv({
        base: { ...process.env, HOME: join(dir, 'home') }, hermesHome: join(dir, 'hermes'), runtimeDir: devTools,
        cacheDir: join(repoRoot, '.dev', 'cache'), keys: { OPENAI_API_KEY: process.env.OPENAI_API_KEY! },
        privatePayload: JSON.stringify({ identifiers, fill: { tools: ['browser_type'], origins: ['127.0.0.1'] } }),
        browser: { executablePath: chrome!.path, profileDir: join(dir, 'browser-profile') },
      }),
      onServerRequest: async (m) => (m === 'approval' ? { choice: 'deny' } : { value: '' }),
    })
    try {
      await hermes.start()
      const client = new HermesClient(hermes, new Masker(identifiers))
      const { session_id } = await client.createSession()
      const tools = (evs: TurnEvent[]) => evs.filter((e) => e.kind === 'tool.start') as Extract<TurnEvent, { kind: 'tool.start' }>[]
      const text = (evs: TurnEvent[]) => { const c = evs.at(-1); return c && c.kind === 'complete' ? c.text : '' }

      const first = await client.runTurn(session_id, `Open ${portal.base}/grades in the browser and tell me my grade in 情報リテラシー.`, undefined, 240_000)
      const typed = tools(first).filter((t) => t.name === 'browser_type' || t.name === 'browser_fill')
      expect(typed).toEqual([]) // never typed into the sign-in form
      expect(tools(first).some((t) => t.name === 'browser_navigate')).toBe(true)
      expect(text(first).toLowerCase()).toMatch(/sign in|log in|login|ログイン|登录/)

      portal.signIn() // the student signs in in the browser window
      const second = await client.runTurn(session_id, 'I have signed in now. Please continue.', undefined, 240_000)
      console.log('REAL signin', JSON.stringify({ firstTools: tools(first).map((t) => t.name), secondTools: tools(second).map((t) => t.name), answer: text(second).slice(0, 200) }))
      expect(text(second)).toMatch(/88|Ａ|A\b/)
    } finally {
      await hermes.stopAndWait()
      await portal.close()
      removeDir(dir)
    }
  }, 600_000)
})
