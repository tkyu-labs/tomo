// Windows portable build: the folder moves between computers, so DPAPI (one user on one PC) cannot protect the secret
// store. The key comes from a password the student sets on first start instead: scrypt (salted) → AES-256-GCM.
// `<data>/secret-key.json` holds only the salt, the scrypt parameters and a check value; the password and the key
// are never written. Tomo cannot recover a forgotten password; "start over" removes the store and the key file.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Encryptor } from './store'

const CHECK = 'tomo-portable-key'
const PARAMS = { N: 1 << 15, r: 8, p: 1 } // ~100 ms on a student laptop
export const MIN_PASSWORD = 8

interface KeyFile { v: 1; kdf: 'scrypt'; N: number; r: number; p: number; salt: string; check: string }

function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body])
}

function open(key: Buffer, data: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
  d.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([d.update(data.subarray(28)), d.final()])
}

const derive = (password: string, f: Pick<KeyFile, 'N' | 'r' | 'p' | 'salt'>) =>
  scryptSync(password.normalize('NFC'), Buffer.from(f.salt, 'base64'), 32, { N: f.N, r: f.r, p: f.p, maxmem: 64 * 1024 * 1024 })

/** The secret store's Encryptor for the portable build; available once a password is set or entered. */
export class PortableKey implements Encryptor {
  private key?: Buffer

  constructor(private readonly keyFile: string) {}

  hasPassword(): boolean {
    return existsSync(this.keyFile)
  }

  unlocked(): boolean {
    return !!this.key
  }

  /** First start: set the password (only when none exists). */
  create(password: string): void {
    if (this.hasPassword()) throw new Error('A password is already set.')
    if (password.length < MIN_PASSWORD) throw new Error(`The password needs at least ${MIN_PASSWORD} characters.`)
    const f = { v: 1 as const, kdf: 'scrypt' as const, ...PARAMS, salt: randomBytes(16).toString('base64'), check: '' }
    const key = derive(password, f)
    f.check = seal(key, Buffer.from(CHECK)).toString('base64')
    mkdirSync(dirname(this.keyFile), { recursive: true })
    writeFileSync(this.keyFile + '.tmp', JSON.stringify(f))
    renameSync(this.keyFile + '.tmp', this.keyFile)
    this.key = key
  }

  /** Every start: true when the password is right. */
  unlock(password: string): boolean {
    const f = JSON.parse(readFileSync(this.keyFile, 'utf8')) as KeyFile
    const key = derive(password, f)
    try {
      if (open(key, Buffer.from(f.check, 'base64')).toString() !== CHECK) return false
    } catch {
      return false
    }
    this.key = key
    return true
  }

  /** New password: re-encrypt the store's current content (read with the old key) with a new salt and key. */
  change(current: string, next: string, readPlain: () => string | null, writePlain: (plain: string) => void): boolean {
    if (!this.unlock(current)) return false
    if (next.length < MIN_PASSWORD) throw new Error(`The password needs at least ${MIN_PASSWORD} characters.`)
    const plain = readPlain()
    const old = this.keyFile + '.old'
    renameSync(this.keyFile, old)
    try {
      this.key = undefined
      this.create(next)
      if (plain !== null) writePlain(plain)
      rmSync(old, { force: true })
    } catch (e) {
      renameSync(old, this.keyFile)
      this.unlock(current)
      throw e
    }
    return true
  }

  /** Forgotten password: forget the key (the caller deletes the secret store). */
  reset(): void {
    this.key = undefined
    rmSync(this.keyFile, { force: true })
  }

  isAvailable(): boolean {
    return !!this.key
  }

  encrypt(plain: string): Buffer {
    if (!this.key) throw new Error('Tomo Portable is locked.')
    return seal(this.key, Buffer.from(plain, 'utf8'))
  }

  decrypt(data: Buffer): string {
    if (!this.key) throw new Error('Tomo Portable is locked.')
    return open(this.key, data).toString('utf8')
  }
}
