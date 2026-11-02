import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseDotenv } from './dotenv'

export interface HermesHomeFiles {
  config: string
  soul: string
  userMd: string
}

/** Writes config.yaml, SOUL.md and memories/USER.md, and installs Tomo's Hermes plugins. */
export function writeHermesHome(hermesHome: string, files: HermesHomeFiles, pluginsSourceDir: string, plugins: string[]): void {
  mkdirSync(join(hermesHome, 'memories'), { recursive: true })
  writeFileSync(join(hermesHome, 'config.yaml'), files.config, { mode: 0o600 })
  writeFileSync(join(hermesHome, 'SOUL.md'), files.soul)
  writeFileSync(join(hermesHome, 'memories', 'USER.md'), files.userMd)
  for (const name of plugins) {
    const target = join(hermesHome, 'plugins', name)
    rmSync(target, { recursive: true, force: true })
    cpSync(join(pluginsSourceDir, name), target, { recursive: true, filter: (p) => !p.includes('__pycache__') })
  }
}

/**
 * Hermes' own `.env` would override the process environment (env_loader.py:505) and holds secrets in plain text.
 * If one appears (e.g. written by a Hermes flow), move its values out and delete it. Returns the moved values.
 */
export function evacuateDotenv(hermesHome: string): Record<string, string> {
  const file = join(hermesHome, '.env')
  if (!existsSync(file)) return {}
  const values = parseDotenv(readFileSync(file, 'utf8'))
  rmSync(file, { force: true })
  return values
}
