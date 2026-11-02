import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserInfo } from '@shared/ipc'

/** Chrome / Edge at their usual install paths (Hermes' browser_connect.py:62-110 does the same). */
export function findBrowsers(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>): BrowserInfo[] {
  const candidates: BrowserInfo[] = []
  if (platform === 'darwin') {
    for (const base of ['/Applications', join(home, 'Applications')]) {
      candidates.push({ name: 'Google Chrome', path: join(base, 'Google Chrome.app/Contents/MacOS/Google Chrome') })
      candidates.push({ name: 'Microsoft Edge', path: join(base, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge') })
    }
  } else if (platform === 'win32') {
    for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean) as string[]) {
      candidates.push({ name: 'Microsoft Edge', path: join(base, 'Microsoft/Edge/Application/msedge.exe') })
      candidates.push({ name: 'Google Chrome', path: join(base, 'Google/Chrome/Application/chrome.exe') })
    }
  }
  const seen = new Set<string>()
  return candidates.filter((c) => existsSync(c.path) && !seen.has(c.name) && (seen.add(c.name), true))
}
