// First start without any cache (opt-in, network: TOMO_NETWORK_TESTS=1, needs build/uv from scripts/fetch-uv.mjs):
// Hermes is downloaded from GitHub, verified, installed into a fresh Tomo data folder with the bundled uv, then the
// gateway answers a turn against the stub model. Nothing is written to the (fake) home folder.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EngineInstaller, type EngineProgress } from '../../src/main/engine/installer'
import { HermesClient } from '../../src/main/hermes/client'
import { buildHermesEnv } from '../../src/main/hermes/env'
import { HermesProcess } from '../../src/main/hermes/process'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { repoRoot, stubConfig } from '../helpers/hermes'
import { writeFileSync } from 'node:fs'

const uv = join(repoRoot, 'build', 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? [p + '/', ...walk(p)] : [p] })

describe.skipIf(!process.env.TOMO_NETWORK_TESTS || !existsSync(uv))('engine install on first start', () => {
  it('downloads, verifies and installs Hermes into Tomo\'s folder, then answers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomo-firststart-'))
    const home = join(dir, 'home'); mkdirSync(home)
    const data = join(dir, 'data'); const hermesHome = join(data, 'hermes')
    const base = { ...process.env, HOME: home, USERPROFILE: home }
    const stages: EngineProgress[] = []
    const started = Date.now()
    try {
      const inst = new EngineInstaller({ dataDir: data, hermesHome, uv, baseEnv: base })
      const rt = await inst.prepare((p) => stages.push(p))
      const seconds = Math.round((Date.now() - started) / 1000)
      console.log('FIRST START', JSON.stringify({ seconds, stages: [...new Set(stages.map((s) => s.stage))], agentBrowser: existsSync(join(hermesHome, 'tools')) && readdirSync(join(hermesHome, 'tools')).filter((n) => /agent-browser|git/i.test(n)) }))
      expect(inst.installed()).toBe(true)
      expect(stages.at(-1)).toMatchObject({ stage: 'done', percent: 100 })
      expect(rt.python.startsWith(join(data, 'engine'))).toBe(true)
      // the installed engine runs
      const stub = (await startStubModel()) as { url: string; requests: { raw: string }[]; close(): Promise<void> }
      mkdirSync(hermesHome, { recursive: true }); writeFileSync(join(hermesHome, 'config.yaml'), stubConfig(stub.url))
      const hermes = new HermesProcess({ runtime: rt, env: buildHermesEnv({ base, hermesHome, cacheDir: join(data, 'cache'), keys: { TOMO_STUB_KEY: 'x' } }) })
      try {
        await hermes.start()
        const client = new HermesClient(hermes)
        const { session_id } = await client.createSession()
        const events = await client.runTurn(session_id, 'Hello from a fresh install')
        expect(events.filter((e) => e.kind === 'delta').map((e) => (e as { text: string }).text).join('')).toContain('Stub answer: Hello from a fresh install')
        // the terminal tool works with this engine (on Windows it needs Git Bash, installed by the engine step)
        const { session_id: s2 } = await client.createSession()
        await client.runTurn(s2, 'TOOL:terminal ARGS:{"command":"echo tomo-terminal-ok"}')
        const toolOut = stub.requests.map((r: { raw: string }) => r.raw).find((r: string) => r.includes('"role":"tool"') && r.includes('tomo-terminal-ok'))
        expect(toolOut).toBeTruthy()
      } finally {
        await hermes.stopAndWait(); await stub.close()
      }
      expect(walk(home)).toEqual([])
      // a second start does nothing
      const again: EngineProgress[] = []
      await new EngineInstaller({ dataDir: data, hermesHome, uv, baseEnv: base }).prepare((p) => again.push(p))
      expect(again).toEqual([{ stage: 'done', percent: 100 }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 900_000)
})
