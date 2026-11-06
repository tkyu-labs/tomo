import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface PathInputs {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  home: string
  /** Development build: data lives in the repository's .dev folder instead of the user's profile. */
  devRoot?: string
}

/**
 * Tomo's own data folder. Everything Tomo and Hermes write lives under it (HERMES_HOME, browser profile,
 * secret store, logs). Windows uses %LOCALAPPDATA% (not Electron's Roaming userData) because the Hermes
 * runtime is large and machine-specific.
 */
export function tomoDataDir({ platform, env, home, devRoot }: PathInputs): string {
  if (devRoot) return join(devRoot, '.dev', 'tomo-data')
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Tomo')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Tomo')
  return join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'tomo')
}

export interface TomoPaths {
  data: string
  hermesHome: string
  browserProfile: string
  secretStore: string
  logs: string
}

export function tomoPaths(dataDir: string): TomoPaths {
  return {
    data: dataDir,
    hermesHome: join(dataDir, 'hermes'),
    browserProfile: join(dataDir, 'browser-profile'),
    secretStore: join(dataDir, 'secrets.bin'),
    logs: join(dataDir, 'logs'),
  }
}

/**
 * Windows portable build: `<root>\Tomo.exe` (launcher), `<root>\App\` (the app, with `portable.json` next to its
 * exe) and `<root>\Data\` (all of Tomo's data). Returns `<root>`, or undefined for an installed app.
 * TOMO_PORTABLE_ROOT forces portable mode (tests).
 */
export function portableRoot(execPath: string, env: Record<string, string | undefined>, exists: (p: string) => boolean = existsSync): string | undefined {
  if (env.TOMO_PORTABLE_ROOT) return env.TOMO_PORTABLE_ROOT
  return exists(join(dirname(execPath), 'portable.json')) ? resolve(dirname(execPath), '..') : undefined
}
