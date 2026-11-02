// The gateway is restarted after an unexpected exit, and diagnostics carry the state and stderr tail.
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { makeTestHome, repoRoot, stubConfig } from '../helpers/hermes'
import { buildHermesEnv } from '../../src/main/hermes/env'
import { HermesProcess } from '../../src/main/hermes/process'
import { devRuntime } from '../../src/main/hermes/runtime'
import { join } from 'node:path'

const cleanups: (() => unknown)[] = []
afterAll(async () => { for (const c of cleanups.reverse()) await c() })

describe('HermesProcess', () => {
  it('restarts after a crash', async () => {
    const stub = await startStubModel()
    cleanups.push(() => stub.close())
    const home = makeTestHome(stubConfig(stub.url))
    cleanups.push(() => home.cleanup())
    const env = buildHermesEnv({ base: { ...process.env, HOME: home.fakeHome }, hermesHome: home.hermesHome, cacheDir: join(repoRoot, '.dev', 'cache'), keys: { TOMO_STUB_KEY: 'x' } })
    const hermes = new HermesProcess({ runtime: devRuntime(repoRoot), env, autoRestart: true })
    cleanups.push(() => hermes.stopAndWait())
    await hermes.start()
    const first = hermes.pid
    const states: string[] = []
    hermes.on('state', (s) => states.push(s))
    process.kill(first!, 'SIGKILL')
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no restart: ' + states.join(','))), 60_000)
      hermes.on('state', (s) => { if (s === 'ready') { clearTimeout(t); resolve() } })
    })
    expect(states).toEqual(['crashed', 'starting', 'ready'])
    expect(hermes.pid).not.toBe(first)
    expect(await hermes.rpc.request('ping', {})).toEqual({ pong: true })
    expect(hermes.diagnostics()).toContain('restarts (last minute): 1')
  })
})
