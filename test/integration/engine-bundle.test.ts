// M8: the bundled engine (scripts/build-engine.mjs → build/engine) still works after being moved to another
// folder — as it is inside Tomo.app/Contents/Resources — and answers a turn against the stub model.
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HermesClient } from '../../src/main/hermes/client'
import { buildHermesEnv } from '../../src/main/hermes/env'
import { HermesProcess } from '../../src/main/hermes/process'
import { bundledRuntime } from '../../src/main/hermes/runtime'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { makeTestHome, repoRoot, stubConfig } from '../helpers/hermes'

const built = join(repoRoot, 'build', 'engine')

describe.skipIf(!existsSync(built))('bundled engine', () => {
  it('runs from a different folder', async () => {
    const moved = mkdtempSync(join(tmpdir(), 'tomo-engine-'))
    cpSync(built, join(moved, 'engine'), { recursive: true, verbatimSymlinks: true })
    const stub = await startStubModel()
    const home = makeTestHome(stubConfig(stub.url))
    const env = buildHermesEnv({ base: { PATH: '/usr/bin:/bin', HOME: home.fakeHome, TMPDIR: process.env.TMPDIR }, hermesHome: home.hermesHome, cacheDir: join(home.dir, 'cache'), keys: { TOMO_STUB_KEY: 'x' } })
    const hermes = new HermesProcess({ runtime: bundledRuntime(join(moved, 'engine')), env })
    try {
      await hermes.start()
      expect(await hermes.rpc.request('setup.runtime_check', {})).toMatchObject({ ok: true })
      const client = new HermesClient(hermes)
      const { session_id } = await client.createSession()
      const events = await client.runTurn(session_id, 'Hello from the bundle')
      expect(events.filter((e) => e.kind === 'delta').map((e) => (e as { text: string }).text).join('')).toContain('Stub answer: Hello from the bundle')
      expect(home.writtenToFakeHome()).toEqual([])
    } finally {
      await hermes.stopAndWait()
      await stub.close()
      home.cleanup()
      rmSync(moved, { recursive: true, force: true })
    }
  }, 180_000)
})
