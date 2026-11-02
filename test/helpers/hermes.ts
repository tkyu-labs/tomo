// Test helper: a throw-away Tomo data folder with a Hermes home configured for the local stub model.
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildHermesEnv } from '../../src/main/hermes/env'
import { HermesProcess } from '../../src/main/hermes/process'
import { devRuntime } from '../../src/main/hermes/runtime'

export const repoRoot = resolve(import.meta.dirname, '../..')

export interface TestHome {
  dir: string
  hermesHome: string
  fakeHome: string
  writtenToFakeHome(): string[]
  cleanup(): void
}

export function makeTestHome(configYaml: string): TestHome {
  const dir = mkdtempSync(join(tmpdir(), 'tomo-test-'))
  const hermesHome = join(dir, 'hermes')
  const fakeHome = join(dir, 'home')
  mkdirSync(hermesHome, { recursive: true })
  mkdirSync(fakeHome, { recursive: true })
  writeFileSync(join(hermesHome, 'config.yaml'), configYaml)
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n)
      return statSync(p).isDirectory() ? [p + '/', ...walk(p)] : [p]
    })
  return {
    dir, hermesHome, fakeHome,
    writtenToFakeHome: () => walk(fakeHome).map((p) => p.slice(fakeHome.length)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export function stubConfig(baseUrl: string, extra = ''): string {
  return `model:
  provider: custom:stub
  default: stub-model
custom_providers:
  - name: stub
    base_url: ${baseUrl}
    key_env: TOMO_STUB_KEY
    api_mode: chat_completions
updates:
  check: false
model_catalog:
  enabled: false
onboarding:
  profile_build: "off"
nous:
  guest: false
${extra}`
}

export function startHermes(home: TestHome, opts: { keys?: Record<string, string>; privatePayload?: string; onServerRequest?: (m: string, p: unknown) => Promise<unknown> } = {}) {
  const env = buildHermesEnv({
    base: { ...process.env, HOME: home.fakeHome },
    hermesHome: home.hermesHome,
    cacheDir: join(repoRoot, '.dev', 'cache'),
    keys: { TOMO_STUB_KEY: 'stub-key', ...opts.keys },
    privatePayload: opts.privatePayload,
  })
  const hermes = new HermesProcess({ runtime: devRuntime(repoRoot), env, onServerRequest: opts.onServerRequest })
  return hermes
}
