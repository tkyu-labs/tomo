import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildHermesEnv } from './env'

describe('buildHermesEnv', () => {
  const base = { PATH: '/usr/bin', HOME: '/Users/lin', OPENAI_API_KEY: 'from-shell', ANTHROPIC_API_KEY: 'x', LANG: 'ja_JP.UTF-8' }

  it('keeps only the allow-listed base variables', () => {
    const env = buildHermesEnv({ base, hermesHome: '/t/hermes', cacheDir: '/t/cache' })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.LANG).toBe('ja_JP.UTF-8')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('isolates Hermes under its home and Tomo caches', () => {
    const env = buildHermesEnv({ base, hermesHome: '/t/hermes', cacheDir: '/t/cache' })
    expect(env).toMatchObject({
      HERMES_HOME: '/t/hermes',
      HERMES_RUNTIME_DIR: join('/t/hermes', 'tools'),
      HERMES_GATEWAY_LOCK_DIR: join('/t/hermes', 'locks'),
      UV_CACHE_DIR: join('/t/cache', 'uv'),
      GH_CONFIG_DIR: join('/t/hermes', 'xdg', 'gh'),
      XDG_STATE_HOME: join('/t/hermes', 'xdg', 'state'),
    })
  })

  it('adds keys, the private payload and browser variables explicitly', () => {
    const env = buildHermesEnv({
      base, hermesHome: '/h', cacheDir: '/c',
      keys: { GAKUEN_API_KEY: 'k' }, privatePayload: '{}',
      browser: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', profileDir: '/p' },
    })
    expect(env.GAKUEN_API_KEY).toBe('k')
    expect(env.TOMO_PRIVATE).toBe('{}')
    expect(env.AGENT_BROWSER_PROFILE).toBe('/p')
  })

  it('rejects odd variable names', () => {
    expect(() => buildHermesEnv({ base, hermesHome: '/h', cacheDir: '/c', keys: { 'bad name': 'x' } })).toThrow()
  })
})
