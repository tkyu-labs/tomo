import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PortableKey } from './portable'
import { SecretStore } from './store'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-portable-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('portable secret key', () => {
  it('encrypts the store with a password, unlocks only with that password, never writes the password', () => {
    const d = tmp()
    const key = new PortableKey(join(d, 'secret-key.json'))
    expect(key.hasPassword()).toBe(false)
    expect(() => key.create('short')).toThrow(/8 characters/)
    key.create('correct horse')
    const store = new SecretStore(join(d, 'secrets.bin'), key)
    store.update((s) => { s.keys.GAKUEN_API_KEY = 'gk-secret-value' })
    expect(readFileSync(join(d, 'secrets.bin')).includes('gk-secret')).toBe(false)
    expect(readFileSync(join(d, 'secret-key.json'), 'utf8')).not.toMatch(/correct horse/)
    // next start
    const again = new PortableKey(join(d, 'secret-key.json'))
    expect(again.isAvailable()).toBe(false)
    expect(again.unlock('wrong password')).toBe(false)
    expect(again.unlock('correct horse')).toBe(true)
    expect(new SecretStore(join(d, 'secrets.bin'), again).read().keys.GAKUEN_API_KEY).toBe('gk-secret-value')
  })

  it('changes the password and re-encrypts; reset forgets the key', () => {
    const d = tmp()
    const key = new PortableKey(join(d, 'secret-key.json'))
    key.create('first password')
    const store = new SecretStore(join(d, 'secrets.bin'), key)
    store.update((s) => { s.keys.X = 'v' })
    const plain = () => JSON.stringify(store.read())
    expect(key.change('not it', 'second password', plain, () => {})).toBe(false)
    const snapshot = plain()
    expect(key.change('first password', 'second password', () => snapshot, (p) => store.write(JSON.parse(p)))).toBe(true)
    const next = new PortableKey(join(d, 'secret-key.json'))
    expect(next.unlock('first password')).toBe(false)
    expect(next.unlock('second password')).toBe(true)
    expect(new SecretStore(join(d, 'secrets.bin'), next).read().keys.X).toBe('v')
    next.reset()
    expect(existsSync(join(d, 'secret-key.json'))).toBe(false)
    expect(next.isAvailable()).toBe(false)
  })
})
