// Copies the school packs that ship with the app into build/packs (macOS and Windows). Source: TOMO_PACKS_SRC (a
// tomo-packs `packs` folder) or the local tomo-packs checkout.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const src = resolve(process.env.TOMO_PACKS_SRC ?? join(root, 'tomo-packs', 'packs'))
if (!existsSync(src)) throw new Error(`no packs at ${src}`)
const out = join(root, 'build', 'packs')
rmSync(out, { recursive: true, force: true })
cpSync(src, out, { recursive: true, filter: (p) => !['evals', '__pycache__'].includes(basename(p)) && !/[\\/]data[\\/]build([\\/]|$)/.test(p) })
console.log('packs:', readdirSync(out).join(', '))
