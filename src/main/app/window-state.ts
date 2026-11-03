// Remembers the main window's size, position and maximised state between runs (window-state.json in Tomo's folder).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowState { x?: number; y?: number; width: number; height: number; maximized?: boolean }

/** Part of the window that must be on a screen for the saved position to be used (title bar + some content). */
const MIN_VISIBLE = 80

function overlap(a: Rect, b: Rect): { w: number; h: number } {
  return {
    w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  }
}

/**
 * Where to open the window. The saved position is kept only while enough of the window is on one of the current
 * screens (a monitor may have been unplugged); otherwise the window opens centred (no x / y). The size never exceeds
 * the screen it opens on and never drops below the minimum.
 */
export function restoreState(saved: WindowState | undefined, workAreas: Rect[], defaults: { width: number; height: number }, min: { width: number; height: number }): WindowState {
  const primary = workAreas[0]
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return { ...defaults }
  const fit = (area: Rect | undefined) => ({
    width: Math.max(min.width, Math.min(Math.round(saved.width), area?.width ?? saved.width)),
    height: Math.max(min.height, Math.min(Math.round(saved.height), area?.height ?? saved.height)),
  })
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const rect = { x: saved.x!, y: saved.y!, width: saved.width, height: saved.height }
    const area = workAreas.find((a) => { const o = overlap(rect, a); return o.w >= MIN_VISIBLE && o.h >= MIN_VISIBLE })
    // the title bar itself must be reachable: its top edge inside that screen
    if (area && rect.y >= area.y && rect.y < area.y + area.height - MIN_VISIBLE / 2) {
      return { x: Math.round(rect.x), y: Math.round(rect.y), ...fit(area), maximized: saved.maximized === true }
    }
  }
  return { ...fit(primary), maximized: saved.maximized === true }
}

export function readWindowState(file: string): WindowState | undefined {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as WindowState) : undefined
  } catch {
    return undefined
  }
}

export function writeWindowState(file: string, s: WindowState): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(s))
  renameSync(file + '.tmp', file)
}
