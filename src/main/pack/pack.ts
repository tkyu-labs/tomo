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
