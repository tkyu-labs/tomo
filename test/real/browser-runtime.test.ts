// Network check (opt-in: TOMO_NETWORK_TESTS=1): with an empty runtime folder, Finish's engine step installs
// agent-browser through Hermes' package manager into Tomo's folder.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppController } from '../../src/main/app/controller'
import { devRuntime } from '../../src/main/hermes/runtime'
import { tomoPaths } from '../../src/main/paths'
import { repoRoot } from '../helpers/hermes'

describe.skipIf(!process.env.TOMO_NETWORK_TESTS)('browser runtime install', () => {
  it('installs agent-browser into the Tomo folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomo-rt-'))
    try {
      const ctl = new AppController({
        paths: tomoPaths(join(dir, 'data')), runtime: devRuntime(repoRoot),
        encryptor: { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() },
        packsSourceDir: join(repoRoot, 'test/fixtures/packs'), pluginsDir: join(repoRoot, 'plugins'),
        baseEnv: { PATH: process.env.PATH, HOME: join(dir, 'home'), TMPDIR: process.env.TMPDIR },
        emit: { chat: () => {}, request: () => {}, setupTask: () => {}, engineState: () => {} },
      })
      expect(await ctl.ensureBrowserRuntime()).toBe(true)
      expect(readdirSync(join(dir, 'data', 'hermes', 'tools')).some((n) => n.startsWith('agent-browser-'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
