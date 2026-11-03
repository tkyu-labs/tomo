import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readWindowState, restoreState, writeWindowState } from './window-state'

const laptop = { x: 0, y: 25, width: 1440, height: 875 }
const external = { x: 1440, y: 0, width: 1920, height: 1080 }
const DEF = { width: 950, height: 600 }
const MIN = { width: 720, height: 480 }

describe('window state', () => {
  it('opens centred with the default size the first time', () => {
    expect(restoreState(undefined, [laptop], DEF, MIN)).toEqual(DEF)
  })

  it('keeps the saved size, position and maximised state on a connected screen', () => {
    expect(restoreState({ x: 1600, y: 100, width: 1200, height: 800, maximized: true }, [laptop, external], DEF, MIN))
      .toEqual({ x: 1600, y: 100, width: 1200, height: 800, maximized: true })
  })

  it('centres the window when its screen is gone, keeping a size that fits', () => {
    expect(restoreState({ x: 1600, y: 100, width: 1800, height: 1000 }, [laptop], DEF, MIN))
      .toEqual({ width: 1440, height: 875, maximized: false })
  })

  it('does not restore a title bar above the top of the screen', () => {
    expect(restoreState({ x: 100, y: -300, width: 1000, height: 700 }, [laptop], DEF, MIN).x).toBeUndefined()
  })

  it('never goes below the minimum size', () => {
    expect(restoreState({ x: 10, y: 40, width: 200, height: 100 }, [laptop], DEF, MIN)).toMatchObject({ width: 720, height: 480 })
  })

  it('round-trips through the file and ignores a broken file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomo-ws-'))
    try {
      const f = join(dir, 'window-state.json')
      writeWindowState(f, { x: 1, y: 2, width: 900, height: 700, maximized: false })
      expect(readWindowState(f)).toEqual({ x: 1, y: 2, width: 900, height: 700, maximized: false })
      writeFileSync(f, '{oops')
      expect(readWindowState(f)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
