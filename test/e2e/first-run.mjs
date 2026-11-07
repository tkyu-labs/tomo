// M5 "done when": walk first run to a first answer with the stub model, then audit labels in en / zh / ja.
// Runs the built app with a throw-away data folder, the fictional test pack and macOS' mock keychain.
// Usage: npm run build && node test/e2e/first-run.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './cdp.mjs'
import { SCAN } from './audit.mjs'
import { startStubModel } from '../stub-model/server.mjs'
import { removeDir } from '../helpers/remove-dir.mjs'

const root = resolve(import.meta.dirname, '../..')
const REAL = !!process.env.TOMO_E2E_REAL && !!process.env.OPENAI_API_KEY
// TOMO_E2E_DATA: keep the finished data folder (other checks start from a set-up Tomo); TOMO_E2E_STUB_PORT: fixed stub port
const data = process.env.TOMO_E2E_DATA || mkdtempSync(join(tmpdir(), 'tomo-e2e-'))
const INSPECT = 9367
/** Evaluates in the main process (Node inspector, test only), e.g. to push an update status to the window. */
async function mainEval(expression) {
  const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  const res = await new Promise((r) => { ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d) }); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, includeCommandLineAPI: true } })) })
  ws.close()
  return res.result?.result?.value
}
const stub = await startStubModel({ port: Number(process.env.TOMO_E2E_STUB_PORT) || 0 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// TOMO_E2E_APP: run an installed app binary instead (packs also from the local tomo-packs checkout, so a pack being
// changed is tested before it is on main); TOMO_E2E_PACK: pack to pick.
const PACK = process.env.TOMO_E2E_PACK ?? 'example-u'
// TOMO_E2E_PORTABLE=<password>: portable mode (data in <root>/Data, secrets protected by this password)
const PORTABLE = process.env.TOMO_E2E_PORTABLE ?? ''
const app = await launchApp({
  executable: process.env.TOMO_E2E_APP,
  // GakuenAI offered (release builds bake its URL in; here the stub stands in for it)
  env: { TOMO_DATA_DIR: data, TOMO_GAKUEN_URL: stub.url, ...(PORTABLE ? { TOMO_PORTABLE_ROOT: data } : {}), TOMO_PACKS_DIR: join(root, process.env.TOMO_E2E_APP ? 'tomo-packs/packs' : 'test/fixtures/packs') },
  args: ['--use-mock-keychain', `--inspect=${INSPECT}`],
})
const $ = (sel) => `document.querySelector(${JSON.stringify(sel)})`
// waits for the element: on a slow machine the send button stays a stop button until the previous turn ends
const click = async (sel) => { await app.waitFor(`!!${$(sel)}`, 60000); return app.evaluate(`(${$(sel)}).click(), true`) }
const clickText = (sel, text) => app.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}).click(), true`)
// set a React-controlled input
const type = (sel, value) => app.evaluate(`(() => { const el = ${$(sel)}; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const next = async () => { await click('[data-testid=setup-next]'); await sleep(250) }
const report = {}
/** Moves the real mouse over every chip of each question that shows course examples; counts layout shifts. */
async function hoverCheck() {
  const qs = await app.evaluate(`[...document.querySelectorAll('.hatch-question')].map((q, i) => q.querySelector('.hatch-note.examples') ? i : -1).filter((i) => i >= 0)`)
  let moved = 0, shown = false
  for (const qi of qs) {
    const Q = `document.querySelectorAll('.hatch-question')[${qi}]`
    await app.evaluate(`${Q}.scrollIntoView({ block: 'center' }), true`); await sleep(200)
    const probe = `(() => { const q = ${Q}; const b = [...q.querySelectorAll('.hatch-chip-btn')].map((x) => x.getBoundingClientRect()); return JSON.stringify({ h: Math.round(q.getBoundingClientRect().height), chips: b.map((x) => [Math.round(x.x), Math.round(x.y)]) }) })()`
    const before = await app.evaluate(probe)
    const n = await app.evaluate(`${Q}.querySelectorAll('.hatch-chip-btn').length`)
    for (let i = 0; i < n; i++) {
      const [x, y] = JSON.parse(await app.evaluate(`(() => { const b = ${Q}.querySelectorAll('.hatch-chip-btn')[${i}].getBoundingClientRect(); return JSON.stringify([b.x + b.width / 2, b.y + b.height / 2]) })()`))
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(100)
      if (!shown) shown = await app.evaluate(`${Q}.querySelector('.hatch-note.examples').textContent.trim().length > 5`)
      if ((await app.evaluate(probe)) !== before) moved++
    }
  }
  report.hoverChecked = (report.hoverChecked ?? 0) + qs.length
  report.hoverShift = (report.hoverShift ?? 0) + moved
  if (qs.length) report.examplesShown = report.examplesShown || shown
}

const audits = {}
const audit = async (key) => { audits[key] = await app.evaluate(SCAN) }

try {
  await app.waitFor($('[data-testid=setup-next]'))
  await clickText('.setup-language-grid button', 'English'); await sleep(100)
  await audit('en:welcome')
  await next() // privacy
  await audit('en:privacy')
  if (PORTABLE) {
    // portable: Continue stays off until the password is set twice the same way
    report.portableSetup = await app.evaluate(`!!document.querySelector('[data-testid=portable-setup]')`)
    report.portableBlocked = await app.evaluate(`document.querySelector('[data-testid=setup-next]').disabled`)
    await type('[data-testid=pw-new]', PORTABLE); await type('[data-testid=pw-confirm]', PORTABLE); await sleep(100)
  }
  await next() // AI provider
  // GakuenAI key field on the step itself (show + test), no tester-only wording; GakuenAI first in the sheet
  report.gakuenField = await app.evaluate(`!!document.querySelector('[data-testid=gakuen-key]') && !!document.querySelector('[data-testid=gakuen-test]')`)
  report.testerWording = await app.evaluate(`/tester/i.test(document.body.innerText)`)
  // the GakuenAI "Test" button really asks the relay (here the stub): a key without balance says so, not "wrong key"
  await type('[data-testid=gakuen-key]', 'sk-empty'); await click('[data-testid=gakuen-test]')
  report.gakuenNoCredit = await app.waitFor(`/has no balance/.test(document.querySelector('.hatch-note.error')?.textContent ?? '')`, 20000).then(() => true, () => false)
  await type('[data-testid=gakuen-key]', '')
  // the eye button shows the key and turns into a closed eye; a second press hides it again
  const eye = `(() => { const b = document.querySelector('[data-testid=gakuen-key-show]'); return document.querySelector('[data-testid=gakuen-key]').type + ':' + b.getAttribute('aria-pressed') + ':' + b.querySelector('svg').dataset.icon })()`
  await click('[data-testid=gakuen-key-show]'); await sleep(100)
  const shown = await app.evaluate(eye)
  await click('[data-testid=gakuen-key-show]'); await sleep(100)
  report.gakuenEye = [shown, await app.evaluate(eye)]
  await click('[data-testid=other-provider]'); await sleep(200)
  // "choose a provider" on this step lists the others: no GakuenAI (it has its own field), OpenAI sign-in next to its API key
  report.sheetOrder = await app.evaluate(`[...document.querySelectorAll('.provider-list input[type=radio]')].map((r) => r.dataset.testid.replace('provider-', '')).join(',')`)
  report.enginePillAtStart = await app.evaluate(`document.querySelector('[data-testid=engine-pill]')?.textContent`)
  if (REAL) {
    // ChatGPT sign-in: OpenAI hands out a device code (not completed here; switching provider cancels it)
    await click('[data-testid=provider-openai]'); await sleep(100)
    await click('[data-testid=chatgpt-start]')
    report.chatgptCode = await app.waitFor(`document.querySelector('[data-testid=chatgpt-code]')?.textContent.length > 4`, 30000).catch(() => false)
    // TOMO_E2E_REAL=1: the provider test runs against OpenAI with OPENAI_API_KEY (never printed)
    await click('[data-testid=provider-openai-api]'); await sleep(100)
    await type('#api-key', process.env.OPENAI_API_KEY)
  } else {
    // ChatGPT sign-in offers a device code (button only; the code request itself needs OpenAI)
    await click('[data-testid=provider-openai]'); await sleep(100)
    report.chatgptSignIn = await app.evaluate(`!!document.querySelector('[data-testid=chatgpt-start]')`)
    // a wrong key is reported, a working key lists the models
    await click('[data-testid=provider-custom]'); await sleep(100)
    await type('#base-url', 'http://127.0.0.1:9/v1')
    await type('#api-key', 'stub-key')
    await click('[data-testid=provider-test]')
    await app.waitFor(`document.querySelector('[data-testid=provider-test-error]')`, 30000)
    report.unreachableReported = true
    await type('#base-url', stub.url)
  }
  await click('[data-testid=provider-test]')
  await app.waitFor(`document.querySelector('[data-testid=provider-model]')?.options.length > 0`, 30000)
  report.modelChoices = await app.evaluate(`[...document.querySelector('[data-testid=provider-model]').options].length`)
  report.modelSelected = await app.evaluate(`document.querySelector('[data-testid=provider-model]').value`)
  await click('[data-testid=provider-connect]')
  await app.waitFor($('[data-testid=connected-provider]'))
  await audit('en:ai')
  await next() // pack
  await click(`[data-testid=pack-${PACK}]`)
  // the ring has a short transition: wait for it instead of reading it mid-way (slow PCs)
  report.packSelected = await app.waitFor(`(() => { const el = document.querySelector('[data-testid=pack-${PACK}]'); const check = el.querySelector('.pack-check'); return el.getAttribute('aria-checked') === 'true' && getComputedStyle(check).display !== 'none' && getComputedStyle(el).boxShadow.includes('47, 111, 235)') })()`, 5000).then(() => true, () => false)
  if (!report.packSelected) report.packSelectedSeen = await app.evaluate(`(() => { const el = document.querySelector('[data-testid=pack-${PACK}]'); return el && { checked: el.getAttribute('aria-checked'), check: getComputedStyle(el.querySelector('.pack-check')).display, ring: getComputedStyle(el).boxShadow } })()`)
  await audit('en:pack')
  await next() // hatch page 1
  await app.waitFor($('.hatch-page'))
  if (PACK !== 'example-u') {
    // a real pack: give the name and student number, skip the rest, walk to the summary
    await type('.hatch-aliases input:nth-child(1)', 'Lin Mei')
    await type('.hatch-aliases input:nth-child(2)', 'リン メイ')
    await type('#hatch-student_number', '23B0001')
    report.hatchPages = 1
    while (await app.evaluate(`!document.querySelector('.user-md')`)) { await hoverCheck(); await next(); report.hatchPages++ }
    report.summaryName = await app.evaluate(`[...document.querySelectorAll('.hatch-summary-row')].map((r) => r.textContent).find((t) => t.includes('Lin Mei'))`)
    await next()
  } else {
  await type('.hatch-aliases input:nth-child(1)', 'Lin Mei')
  await type('.hatch-aliases input:nth-child(2)', 'リン メイ')
  await type('#hatch-student_number', '23B0001')
  await clickText('.hatch-chip-btn', '3'); await sleep(100)
  await clickText('.hatch-chip-btn', "Yes, but only while I'm watching"); await sleep(100)
  report.prefilledFaculty = await app.evaluate(`[...document.querySelectorAll('.hatch-chip-btn.selected')].map((b) => b.textContent)`)
  await hoverCheck()
  await audit('en:hatch')
  await next() // summary
  report.userMd = await app.evaluate(`document.querySelector('.user-md')?.textContent`)
  report.summaryName = await app.evaluate(`[...document.querySelectorAll('.hatch-summary-row')].map((r) => r.textContent).find((t) => t.includes('Lin Mei'))`)
  await next() // browser
  }
  await app.waitFor(`${$('[data-testid=browser-found]')} || ${$('[data-testid=browser-missing]')}`)
  await next() // finish
  await app.waitFor(`[...document.querySelectorAll('[data-task]')].every((t) => t.dataset.state === 'done') || ${$('.task.error')}`, process.env.TOMO_E2E_APP ? 900000 : 120000) // packaged: the engine is installed now (slow PCs: minutes)
  report.finish = await app.evaluate(`[...document.querySelectorAll('[data-task]')].map((t) => t.dataset.task + ':' + t.dataset.state + (t.dataset.state === 'error' ? ' ' + t.textContent : ''))`)
  report.enginePill = await app.evaluate(`document.querySelector('[data-testid=engine-pill]')?.className`)
  await audit('en:finish')
  await next() // Start Using Tomo
  await app.waitFor($('[data-testid=composer]'), 30000)
  // macOS: nothing of the sidebar brand under the traffic lights (window area x < 80, y < 34 window px)
  report.trafficLightsClear = await app.evaluate(`(() => { if (document.documentElement.dataset.platform !== 'darwin') return true; const z = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom') || 1); const r = document.querySelector('.sidebar .brand-mark').getBoundingClientRect(); return r.top * z >= 34 || r.left * z >= 80 })()`)
  report.quickTopics = await app.evaluate(`[...document.querySelectorAll('[data-testid=quick-topics] .nav-item-label')].map((e) => e.textContent)`)

  // first question, with identifiers typed by the student
  await type('[data-testid=composer]', 'Hello, I am Lin Mei, student 23B0001')
  await click('[data-testid=send]')
  await app.waitFor(`[...document.querySelectorAll('[data-testid=answer-text]')].some((e) => ${REAL ? "e.textContent.length > 0 && !document.querySelector('[data-testid=stop]')" : "e.textContent.includes('Stub answer') && !document.querySelector('[data-testid=stop]')"})`, 90000) // the whole answer: the turn has ended
  report.answer = await app.evaluate(`[...document.querySelectorAll('[data-testid=answer-text]')].at(-1).textContent`)
  report.windowTitle = await app.waitFor(`document.title !== 'Tomo（伴）' && document.title`, 20000).catch(() => app.evaluate('document.title'))
  report.sentToModel = stub.requests.filter((r) => r.raw.includes('Hello, I am')).map((r) => r.body.messages.at(-1).content)
  if (REAL) console.log('REAL provider test:', report.finish.at(-1), '· answer chars:', report.answer.length)
  report.leak = stub.requests.some((r) => /Lin Mei|23B0001|リン ?メイ/.test(r.raw))
  await audit('en:chat')
  if (!REAL) {
    // a card from the tomo plugin renders in the conversation, with placeholders shown as real values
    await type('[data-testid=composer]', 'TOOL:tomo_card ARGS:{"kind":"steps","title":"For {{FULL_NAME}}","data":{"steps":[{"title":"Open the portal","detail":"Sign in yourself"}]}}')
    await click('[data-testid=send]')
    await app.waitFor(`document.querySelector('[data-testid=tomo-card][data-kind=steps]')`, 60000)
    report.card = await app.evaluate(`document.querySelector('[data-testid=tomo-card]').textContent`)
    await audit('en:card')
    // tool steps line up with the answer text and start level with the avatar
    await type('[data-testid=composer]', 'TOOL:skills_list ARGS:{}')
    await click('[data-testid=send]')
    await app.waitFor(`(() => { const m = [...document.querySelectorAll('[data-testid=assistant-message]')].at(-1); return m.querySelector('[data-testid=tool-steps]') && m.querySelector('[data-testid=answer-text]') && !document.querySelector('[data-testid=stop]') })()`, 60000)
    report.toolStepsLayout = await app.evaluate(`(() => { const m = [...document.querySelectorAll('[data-testid=assistant-message]')].at(-1); const s = m.querySelector('[data-testid=tool-steps]').getBoundingClientRect(), t = m.querySelector('[data-testid=answer-text]').getBoundingClientRect(), a = m.querySelector('.assistant-avatar').getBoundingClientRect(); return { leftDiff: Math.round(s.left - t.left), topDiff: Math.round(s.top - a.top), rightDiff: Math.round(s.right - t.right) } })()`)
  }

  // the same screens in zh and ja
  for (const loc of ['zh', 'ja']) {
    await app.evaluate(`window.tomo.setPrefs({ locale: '${loc}' }).then(() => location.reload())`); await sleep(1500)
    await app.waitFor($('[data-testid=sidebar]'))
    await audit(`${loc}:chat`)
    await click('[data-testid=nav-settings]'); await sleep(400)
    await audit(`${loc}:settings`)
    // one column: every section starts at the same x and has the same width
    // one provider: the fallback section offers to connect a second one; the connection list shows the one in use
    report.packSettings = await app.evaluate(`({ section: !!document.querySelector('[data-testid=pack-settings]'), mode: document.querySelector('[data-testid=pack-update-mode]')?.value })`)
    report.fallbackSection = await app.evaluate(`({ fallback: !!document.querySelector('[data-testid=fallback] [data-testid=fallback-note]'), connections: document.querySelectorAll('[data-testid^=connection-]').length })`)
    report.settingsColumns = await app.evaluate(`new Set([...document.querySelectorAll('.settings-layout > .settings-section')].map((s) => { const r = s.getBoundingClientRect(); return Math.round(r.left) + ':' + Math.round(r.width) })).size`)
    await clickText('.nav-item-label', loc === 'zh' ? '关于你' : 'あなたについて'); await sleep(400)
    await audit(`${loc}:memory`)
  }
  report.memory = await app.evaluate(`[...document.querySelectorAll('[data-testid=memory-entry]')].map((e) => e.textContent)`)
  // the "masked" pill on a memory entry: lock and label side by side with a gap (a settings-row rule once made it a block)
  report.maskedTag = await app.evaluate(`(() => { const t = document.querySelector('[data-testid=masked-tag]'); if (!t) return null; const i = t.querySelector('svg').getBoundingClientRect(); const r = document.createRange(); r.selectNodeContents(t.lastChild); const x = r.getBoundingClientRect(); return { display: getComputedStyle(t).display, gap: Math.round((x.left - i.right) * 10) / 10, centred: Math.abs((i.top + i.height / 2) - (x.top + x.height / 2)) <= 2 } })()`)
  // an app update that is ready shows one banner with "Restart now"; dismissing it hides it
  await app.evaluate(`window.tomo.setPrefs({ locale: 'en' }).then(() => location.reload())`); await sleep(1500)
  await app.waitFor($('[data-testid=sidebar]'))
  await mainEval(`(() => { require('electron').BrowserWindow.getAllWindows()[0].webContents.send('tomo:update-event', { state: 'ready', current: '0.1.0', available: '9.9.9' }); return true })()`)
  await sleep(400)
  report.banner = await app.evaluate(`(() => { const b = document.querySelector('[data-testid=app-banner]'); return b ? { kind: b.dataset.kind, text: b.innerText.trim(), action: b.querySelector('[data-testid=banner-action]')?.textContent } : null })()`)
  await click('[data-testid=banner-dismiss]'); await sleep(200)
  report.bannerDismissed = await app.evaluate(`!document.querySelector('[data-testid=app-banner]')`)
  if (!REAL) {
    // removing the school pack: confirmation, then only Tomo's general Hatch (all skipped) and Finish, back to the chat
    await click('[data-testid=nav-settings]'); await sleep(400)
    await click('[data-testid=pack-remove]'); await sleep(200)
    report.removeDialog = await app.evaluate(`!!document.querySelector('[data-testid=remove-pack]')`)
    await click('[data-testid=remove-pack-confirm]')
    await app.waitFor(`document.querySelector('[data-testid=hatch-header]')?.dataset.hatch === 'general'`, 30000)
    report.generalHatch = await app.evaluate(`document.querySelector('[data-testid=hatch-header] h1')?.textContent`)
    for (let i = 0; i < 3; i++) await next() // three pages, nothing answered
    await next() // summary → Finish
    await app.waitFor(`document.querySelector('[data-testid=setup-next]') && !document.querySelector('[data-testid=setup-next]').disabled`, 180000)
    await next() // Start using Tomo
    await app.waitFor($('[data-testid=sidebar]'), 30000)
    report.afterRemove = await app.evaluate(`Promise.all([window.tomo.getState(), window.tomo.userMemory()]).then(([s, m]) => ({ pack: s.pack?.id ?? null, hatchPending: s.hatchPending, memory: m }))`)
  }
  report.audit = Object.fromEntries(Object.entries(audits).filter(([, v]) => v.length))
  console.log(JSON.stringify(report, null, 2))
  const ok = report.gakuenField && report.gakuenNoCredit && !report.testerWording && report.sheetOrder === 'openai,openai-api,openrouter,deepseek,custom' && report.gakuenEye?.join() === 'text:true:eye-slash,password:false:eye' && (!PORTABLE || (report.portableSetup && report.portableBlocked)) && report.finish.every((f) => f.endsWith(':done')) && report.packSelected && report.trafficLightsClear && report.enginePill?.includes('ready') && report.modelSelected && (REAL ? report.answer.length > 0 : report.answer.includes('Lin Mei') && report.card?.includes('For Lin Mei') && report.hoverChecked > 0 && report.hoverShift === 0 && report.examplesShown && report.summaryName?.includes('{{FULL_NAME}}') && report.chatgptSignIn && report.unreachableReported && /flex/.test(report.maskedTag?.display ?? '') && report.maskedTag.gap >= 3 && report.maskedTag.centred && report.toolStepsLayout?.leftDiff === 0 && Math.abs(report.toolStepsLayout.topDiff) <= 1) && (REAL || (report.removeDialog && report.generalHatch === 'About you' && report.afterRemove?.pack === null && !report.afterRemove.hatchPending && report.afterRemove.memory.length === 2 && report.afterRemove.memory[1].startsWith('The user skipped'))) && report.banner?.kind === 'app-ready' && report.banner.text.includes('9.9.9') && report.banner.action === 'Restart now' && report.bannerDismissed && report.settingsColumns === 1 && report.packSettings?.section && report.packSettings.mode === 'auto' && report.fallbackSection?.fallback && report.fallbackSection.connections === 1 && !report.leak && Object.keys(report.audit).length === 0
  console.log(ok ? 'E2E OK' : 'E2E FAILED')
  process.exitCode = ok ? 0 : 1
} catch (e) {
  console.error('E2E ERROR', e.message, JSON.stringify(report))
  console.error(app.log().slice(-3000))
  process.exitCode = 1
} finally {
  await app.close()
  await stub.close()
  if (!process.env.TOMO_E2E_DATA) removeDir(data)
}
