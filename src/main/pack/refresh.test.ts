import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compareVersions, installPack, refreshBundledPack } from './pack'

const fixture = resolve(import.meta.dirname, '../../../test/fixtures/packs')
const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-packrefresh-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const setVersion = (dir: string, v: string) => {
  const f = join(dir, 'pack.yaml')
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^version: .*$/m, `version: ${v}`))
}

describe('local pack folder refresh on engine start (development)', () => {
  it('compares x.y.z versions', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('replaces the installed copy with the same or a newer bundled version, keeps a newer installed one', () => {
    const source = tmp(), data = tmp()
    cpSync(join(fixture, 'example-u'), join(source, 'example-u'), { recursive: true })
    installPack(join(source, 'example-u'), data)
    const soul = join(data, 'packs', 'example-u', 'soul.md')
    writeFileSync(join(source, 'example-u', 'soul.md'), 'changed in the app update\n')
    expect(refreshBundledPack(source, data, 'example-u')).toBe(true) // same version, new content
    expect(readFileSync(soul, 'utf8')).toBe('changed in the app update\n')
    setVersion(join(data, 'packs', 'example-u'), '9.0.0') // e.g. a newer pack release installed later
    writeFileSync(join(source, 'example-u', 'soul.md'), 'older bundled copy\n')
    expect(refreshBundledPack(source, data, 'example-u')).toBe(false)
    expect(readFileSync(soul, 'utf8')).toBe('changed in the app update\n')
    expect(refreshBundledPack(source, data, 'missing')).toBe(false)
  })
})
