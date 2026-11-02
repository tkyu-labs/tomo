// M1 smoke check: the built app opens a window, the preload bridge works, and Node is not exposed.
import { launchApp } from './cdp.mjs'

const app = await launchApp()
try {
  const version = await app.waitFor(`document.querySelector('[data-testid=app-version]')?.textContent.startsWith('v') && document.querySelector('[data-testid=app-version]').textContent`)
  const isolated = await app.evaluate(`typeof require === 'undefined' && typeof process === 'undefined' && typeof window.tomo?.appInfo === 'function'`)
  console.log(JSON.stringify({ version, isolated, title: await app.evaluate('document.title') }))
  if (!isolated) throw new Error('renderer is not isolated')
} finally {
  await app.close()
}
