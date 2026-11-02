import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { IdentifierEntry } from '@shared/privacy/masker'

/** Electron safeStorage in the app (Keychain / DPAPI); a test double in unit tests. */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export interface SecretData {
  /** API keys by the variable name Hermes reads (GAKUEN_API_KEY, OPENROUTER_API_KEY, …). */
  keys: Record<string, string>
  /** Hatch identifiers (name, student number); never portal passwords. */
  identifiers: IdentifierEntry[]
}

const EMPTY: SecretData = { keys: {}, identifiers: [] }

/**
 * One encrypted file in Tomo's folder. Nothing here is ever written to Hermes' files:
 * keys reach the gateway as process environment variables, identifiers as TOMO_PRIVATE.
 */
export class SecretStore {
  constructor(
    private readonly file: string,
    private readonly crypto: Encryptor,
  ) {}

  read(): SecretData {
    if (!existsSync(this.file)) return structuredClone(EMPTY)
    const data = JSON.parse(this.crypto.decrypt(readFileSync(this.file))) as Partial<SecretData>
    return { keys: data.keys ?? {}, identifiers: data.identifiers ?? [] }
  }

  write(data: SecretData): void {
    if (!this.crypto.isAvailable()) throw new Error('OS encryption is not available; refusing to store secrets in plain text')
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, this.crypto.encrypt(JSON.stringify(data)), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  update(fn: (data: SecretData) => void): SecretData {
    const data = this.read()
    fn(data)
    this.write(data)
    return data
  }

  setKey(variable: string, value: string | undefined): void {
    this.update((d) => {
      if (value) d.keys[variable] = value
      else delete d.keys[variable]
    })
  }
}
