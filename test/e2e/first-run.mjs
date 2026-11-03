// M5 "done when": walk first run to a first answer with the stub model, then audit labels in en / zh / ja.
// Runs the built app with a throw-away data folder, the fictional test pack and macOS' mock keychain.
// Usage: npm run build && node test/e2e/first-run.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './cdp.mjs'
import { SCAN } from './audit.mjs'
import { startStubModel } from '../stub-model/server.mjs'

const root = resolve(import.meta.dirname, '../..')
const REAL = !!process.env.TOMO_E2E_REAL && !!process.env.OPENAI_API_KEY
const data = mkdtempSync(join(tmpdir(), 'tomo-e2e-'))
const stub = await startStubModel()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// TOMO_E2E_APP: run an installed app binary instead (with its bundled packs); TOMO_E2E_PACK: pack to pick.
const PACK = process.env.TOMO_E2E_PACK ?? 'example-u'
const app = await launchApp({
  executable: process.env.TOMO_E2E_APP,
  env: { TOMO_DATA_DIR: data, ...(process.env.TOMO_E2E_APP ? {} : { TOMO_PACKS_DIR: join(root, 'test/fixtures/packs') }) },
  args: ['--use-mock-keychain'],
})
const $ = (sel) => `document.querySelector(${JSON.stringify(sel)})`
const click = (sel) => app.evaluate(`(${$(sel)}).click(), true`)
const clickText = (sel, text) => app.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}).click(), true`)
// set a React-controlled input
const type = (sel, value) => app.evaluate(`(() => { const el = ${$(sel)}; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const next = async () => { await click('[data-testid=setup-next]'); await sleep(250) }
const report = {}
const audits = {}
const audit = async (key) => { audits[key] = await app.evaluate(SCAN) }

try {
  await app.waitFor($('[data-testid=setup-next]'))
  await clickText('.setup-language-grid button', 'English'); await sleep(100)
  await audit('en:welcome')
  await next() // privacy
  await audit('en:privacy')
  await next() // AI provider
  await click('[data-testid=other-provider]'); await sleep(200)
  report.enginePill = await app.evaluate(`document.querySelector('[data-testid=engine-pill]')?.className`)
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
  await click(`[data-testid=pack-${PACK}]`); await sleep(100)
  report.packSelected = await app.evaluate(`(() => { const el = document.querySelector('[data-testid=pack-${PACK}]'); const check = el.querySelector('.pack-check'); return el.getAttribute('aria-checked') === 'true' && getComputedStyle(check).display !== 'none' && getComputedStyle(el).boxShadow.includes('rgba(47, 111, 235') })()`)
  await audit('en:pack')
  await next() // hatch page 1
  await app.waitFor($('.hatch-page'))
  if (PACK !== 'example-u') {
    // a real pack: give the name and student number, skip the rest, walk to the summary
    await type('.hatch-aliases input:nth-child(1)', 'Lin Mei')
    await type('.hatch-aliases input:nth-child(2)', 'リン メイ')
    await type('#hatch-student_number', '23B0001')
    report.hatchPages = 1
    while (await app.evaluate(`!document.querySelector('.user-md')`)) { await next(); report.hatchPages++ }
    await next()
  } else {
  await type('.hatch-aliases input:nth-child(1)', 'Lin Mei')
  await type('.hatch-aliases input:nth-child(2)', 'リン メイ')
  await type('#hatch-student_number', '23B0001')
  await clickText('.hatch-chip-btn', '3'); await sleep(100)
  await clickText('.hatch-chip-btn', "Yes, but only while I'm watching"); await sleep(100)
  report.prefilledFaculty = await app.evaluate(`[...document.querySelectorAll('.hatch-chip-btn.selected')].map((b) => b.textContent)`)
  // hovering chips with long examples must not move anything (the examples line has a fixed height)
  const chips = await app.evaluate(`[...document.querySelectorAll('.hatch-question')].at(-1).querySelectorAll('.hatch-chip-btn').length`)
  await app.evaluate(`[...document.querySelectorAll('.hatch-question')].at(-1).scrollIntoView({ block: 'center' }), true`); await sleep(200)
  const probe = `(() => { const q = [...document.querySelectorAll('.hatch-question')].at(-1); const r = q.getBoundingClientRect(); const b = [...q.querySelectorAll('.hatch-chip-btn')].map((x) => x.getBoundingClientRect()); return JSON.stringify({ h: r.height, chips: b.map((x) => [Math.round(x.x), Math.round(x.y)]) }) })()`
  const before = await app.evaluate(probe)
  let moved = 0
  for (let i = 0; i < chips; i++) {
    const [x, y] = JSON.parse(await app.evaluate(`(() => { const b = [...document.querySelectorAll('.hatch-question')].at(-1).querySelectorAll('.hatch-chip-btn')[${i}].getBoundingClientRect(); return JSON.stringify([b.x + b.width / 2, b.y + b.height / 2]) })()`))
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(120)
    if (i === 0) report.examplesShown = await app.evaluate(`[...document.querySelectorAll('.hatch-note.examples')].at(-1).textContent.trim().length > 5`)
    if ((await app.evaluate(probe)) !== before) moved++
  }
  report.hoverShift = moved
  await audit('en:hatch')
  await next() // summary
  report.userMd = await app.evaluate(`document.querySelector('.user-md')?.textContent`)
  report.summaryName = await app.evaluate(`[...document.querySelectorAll('.hatch-summary-row')].map((r) => r.textContent).find((t) => t.includes('Lin Mei'))`)
  await next() // browser
  }
  await app.waitFor(`${$('[data-testid=browser-found]')} || ${$('[data-testid=browser-missing]')}`)
  await next() // finish
  await app.waitFor(`[...document.querySelectorAll('[data-task]')].every((t) => t.dataset.state === 'done') || ${$('.task.error')}`, 120000)
  report.finish = await app.evaluate(`[...document.querySelectorAll('[data-task]')].map((t) => t.dataset.task + ':' + t.dataset.state + (t.dataset.state === 'error' ? ' ' + t.textContent : ''))`)
  await audit('en:finish')
  await next() // Start Using Tomo
  await app.waitFor($('[data-testid=composer]'), 30000)
  report.quickTopics = await app.evaluate(`[...document.querySelectorAll('[data-testid=quick-topics] .nav-item-label')].map((e) => e.textContent)`)

  // first question, with identifiers typed by the student
  await type('[data-testid=composer]', 'Hello, I am Lin Mei, student 23B0001')
  await click('[data-testid=send]')
  await app.waitFor(`[...document.querySelectorAll('[data-testid=answer-text]')].some((e) => ${REAL ? "e.textContent.length > 0 && !document.querySelector('[data-testid=stop]')" : "e.textContent.includes('Stub answer')"})`, 90000)
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
  }

  // the same screens in zh and ja
  for (const loc of ['zh', 'ja']) {
    await app.evaluate(`window.tomo.setPrefs({ locale: '${loc}' }).then(() => location.reload())`); await sleep(1500)
    await app.waitFor($('[data-testid=sidebar]'))
    await audit(`${loc}:chat`)
    await click('[data-testid=nav-settings]'); await sleep(400)
    await audit(`${loc}:settings`)
    await clickText('.nav-item-label', loc === 'zh' ? '关于你' : 'あなたについて'); await sleep(400)
    await audit(`${loc}:memory`)
  }
  report.memory = await app.evaluate(`[...document.querySelectorAll('[data-testid=memory-entry]')].map((e) => e.textContent)`)
  report.audit = Object.fromEntries(Object.entries(audits).filter(([, v]) => v.length))
  console.log(JSON.stringify(report, null, 2))
  const ok = report.finish.every((f) => f.endsWith(':done')) && report.packSelected && report.enginePill?.includes('ready') && report.modelSelected && (REAL ? report.answer.length > 0 : report.answer.includes('Lin Mei') && report.card?.includes('For Lin Mei') && report.hoverShift === 0 && report.examplesShown && report.summaryName?.includes('{{FULL_NAME}}') && report.chatgptSignIn && report.unreachableReported) && !report.leak && Object.keys(report.audit).length === 0
  console.log(ok ? 'E2E OK' : 'E2E FAILED')
  process.exitCode = ok ? 0 : 1
} catch (e) {
  console.error('E2E ERROR', e.message, JSON.stringify(report))
  console.error(app.log().slice(-3000))
  process.exitCode = 1
} finally {
  await app.close()
  await stub.close()
  rmSync(data, { recursive: true, force: true })
}
