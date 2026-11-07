import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { Hatch, PackManifest } from '@shared/pack/types'

export interface LoadedPack {
  dir: string
  manifest: PackManifest
  hatch: Hatch
  soul: string
  skillsDir: string
}

export function loadPack(dir: string): LoadedPack {
  const manifest = parse(readFileSync(join(dir, 'pack.yaml'), 'utf8')) as PackManifest
  const hatch = parse(readFileSync(join(dir, 'hatch.yaml'), 'utf8')) as Hatch
  const soul = readFileSync(join(dir, 'soul.md'), 'utf8')
  if (!manifest?.id || manifest.schema !== 1) throw new Error(`not a Tomo pack (schema 1): ${dir}`)
  return { dir, manifest, hatch, soul, skillsDir: join(dir, 'skills') }
}

/**
 * Installs a pack into Tomo's data folder (`packs/<id>`). Development installs from the local tomo-packs checkout;
 * release installs (M8) unpack a signed archive first and then call this with the unpacked folder.
 * Evals and locally built data are not copied.
 */
/** Numeric x.y.z comparison (pre-release tags ignored): <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const p = (v: string) => v.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [p(a), p(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/**
 * Engine start in development and tests: the pack in the local packs folder replaces the installed copy when it is the
 * same or a newer version, so pack edits apply after a restart. A newer installed pack is kept. (The app ships no
 * packs; installed apps update from tomo-packs main.)
 */
export function refreshBundledPack(sourceDir: string, dataDir: string, id: string): boolean {
  const source = join(sourceDir, id)
  const target = join(dataDir, 'packs', id)
  if (!existsSync(join(source, 'pack.yaml'))) return false
  if (existsSync(join(target, 'pack.yaml')) && compareVersions(loadPack(source).manifest.version, loadPack(target).manifest.version) < 0) return false
  installPack(source, dataDir)
  return true
}

export function installPack(sourceDir: string, dataDir: string): LoadedPack {
  const source = loadPack(sourceDir)
  const target = join(dataDir, 'packs', source.manifest.id)
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  cpSync(sourceDir, target, {
    recursive: true,
    filter: (src) => !/[\\/](evals|data[\\/]build|__pycache__|\.git)([\\/]|$)/.test(src.slice(sourceDir.length)),
  })
  return loadPack(target)
}
