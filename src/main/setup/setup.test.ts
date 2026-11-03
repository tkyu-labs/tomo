import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { installPack } from '../pack/pack'
import { SecretStore, type Encryptor } from '../secrets/store'
import { buildHermesConfig } from './config'
import { evacuateDotenv } from './home'
import { privatePayload, writeProfile } from './profile'

const root = resolve(import.meta.dirname, '../../..')
const fixturePack = join(root, 'test/fixtures/packs/example-u')
const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-setup-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const answers = { full_name: { name: 'Lin Mei', furigana: 'リン メイ' }, student_number: '23B0001', faculty: 'B', year: 3, grades_consent: 'watch' }

describe('Hermes config', () => {
  it('maps GakuenAI to a custom provider with key_env', () => {
    const c = buildHermesConfig({ provider: { id: 'gakuen', model: 'deepseek-flash', baseUrl: 'https://relay.example/v1', reasoning: 'medium' } })
    expect(c.model).toEqual({ provider: 'custom:gakuen', default: 'deepseek-flash' })
    expect(c.custom_providers).toEqual([{ name: 'gakuen', base_url: 'https://relay.example/v1', key_env: 'GAKUEN_API_KEY', api_mode: 'codex_responses' }])
    expect(c.agent).toMatchObject({ reasoning_effort: 'medium' })
  })

  it('keeps the safety switches', () => {
    const c = buildHermesConfig({ provider: { id: 'deepseek', model: 'deepseek-chat' } }) as Record<string, Record<string, unknown>>
    expect(c.updates).toEqual({ check: false })
    expect(c.auth).toEqual({ adopt_external_logins: false })
    expect(c.browser).toMatchObject({ backend: 'off', headed: true })
    expect(c.vault).toEqual({ onepassword: { enabled: false }, bitwarden: { enabled: false } })
    expect(c.toolsets).not.toContain('code_execution')
    expect(JSON.stringify(c)).not.toMatch(/api_key"/)
  })
})

describe('profile', () => {
  it('writes config, SOUL and USER.md without real identifiers', async () => {
    const data = tmp()
    const pack = installPack(fixturePack, data)
    const hermesHome = join(data, 'hermes')
    const res = writeProfile({ hermesHome, pluginsSourceDir: join(root, 'plugins'), pack, provider: { id: 'custom', model: 'stub-model', baseUrl: 'http://127.0.0.1:1/v1' }, answers })
    const config = readFileSync(join(hermesHome, 'config.yaml'), 'utf8')
    const soul = readFileSync(join(hermesHome, 'SOUL.md'), 'utf8')
    const user = readFileSync(join(hermesHome, 'memories', 'USER.md'), 'utf8')
    await expect(soul).toMatchFileSnapshot(join(root, 'test/fixtures/hermes-home/SOUL.md'))
    await expect(user).toMatchFileSnapshot(join(root, 'test/fixtures/hermes-home/USER.md'))
    expect(parse(config).skills.external_dirs).toEqual([join(data, 'packs', 'example-u', 'skills')])
    expect(existsSync(join(hermesHome, 'plugins', 'tomo-privacy', 'plugin.yaml'))).toBe(true)
    for (const text of [config, soul, user]) expect(text).not.toMatch(/Lin Mei|リン メイ|23B0001/)
    expect(JSON.parse(privatePayload(res.identifiers, pack)).fill).toEqual({ tools: ['browser_type'], origins: ['portal.example-u.ac.jp'] })
  })

  it('moves a stray Hermes .env out', () => {
    const home = tmp()
    writeFileSync(join(home, '.env'), '# x\nexport OPENROUTER_API_KEY="sk-or-1"\nDEEPSEEK_API_KEY=abc # note\n')
    expect(evacuateDotenv(home)).toEqual({ OPENROUTER_API_KEY: 'sk-or-1', DEEPSEEK_API_KEY: 'abc' })
    expect(existsSync(join(home, '.env'))).toBe(false)
  })
})

describe('SecretStore', () => {
  const fake: Encryptor = {
    isAvailable: () => true,
    encrypt: (s) => Buffer.from(Buffer.from(s).map((b) => b ^ 0x5a)),
    decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString(),
  }
  it('round-trips keys and identifiers and never stores plain text', () => {
    const file = join(tmp(), 'secrets.bin')
    const store = new SecretStore(file, fake)
    store.setKey('GAKUEN_API_KEY', 'gk-123')
    store.update((d) => { d.identifiers = [{ name: 'STUDENT_NUMBER', values: ['23B0001'] }] })
    expect(store.read()).toEqual({ keys: { GAKUEN_API_KEY: 'gk-123' }, identifiers: [{ name: 'STUDENT_NUMBER', values: ['23B0001'] }] })
    expect(readFileSync(file).toString()).not.toContain('gk-123')
  })
  it('refuses to write without OS encryption', () => {
    const store = new SecretStore(join(tmp(), 's.bin'), { ...fake, isAvailable: () => false })
    expect(() => store.setKey('X', 'y')).toThrow(/not available/)
  })
})
