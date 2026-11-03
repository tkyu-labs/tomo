import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tomoDataDir, tomoPaths } from './paths'

describe('tomoDataDir', () => {
  it('uses Application Support on macOS', () => {
    expect(tomoDataDir({ platform: 'darwin', env: {}, home: '/Users/lin' })).toBe(join('/Users/lin', 'Library', 'Application Support', 'Tomo'))
  })
  it('uses LOCALAPPDATA on Windows', () => {
    expect(tomoDataDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:/Users/lin/AppData/Local' }, home: 'C:/Users/lin' })).toBe(join('C:/Users/lin/AppData/Local', 'Tomo'))
  })
  it('keeps development data inside the repository', () => {
    expect(tomoDataDir({ platform: 'darwin', env: {}, home: '/Users/lin', devRoot: '/repo' })).toBe(join('/repo', '.dev', 'tomo-data'))
  })
  it('derives the Hermes home and browser profile from the data folder', () => {
    const p = tomoPaths('/d')
    expect(p.hermesHome).toBe(join('/d', 'hermes'))
    expect(p.browserProfile).toBe(join('/d', 'browser-profile'))
  })
})
