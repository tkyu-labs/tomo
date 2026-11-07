// Smoke check: the built app opens a window, the preload bridge works, and Node is not exposed.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './cdp.mjs'
import { removeDir } from '../helpers/remove-dir.mjs'

const data = mkdtempSync(join(tmpdir(), 'tomo-smoke-'))
const app = await launchApp({ env: { TOMO_DATA_DIR: data } })
try {
  await app.waitFor(`document.querySelector('#root')?.childElementCount > 0`)
  const version = await app.evaluate(`window.tomo.appInfo().then((i) => i.version)`)
  const isolated = await app.evaluate(`typeof require === 'undefined' && typeof process === 'undefined' && typeof window.tomo?.appInfo === 'function'`)
  console.log(JSON.stringify({ version, isolated, title: await app.evaluate('document.title') }))
  if (!isolated || !/^\d+\.\d+\.\d+/.test(version)) throw new Error('renderer is not isolated or the version is missing')
  console.log('SMOKE OK')
} finally {
  await app.close()
  removeDir(data)
}
