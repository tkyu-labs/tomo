// Draws Tomo's app icon (brand colour, white 伴 in Noto Sans JP Bold, SIL OFL 1.1) with headless Chrome and writes
// build-resources/icon.png (1024 px) plus icon.icns (macOS, via iconutil) and icon.ico (Windows).
// Usage: node scripts/make-icon.mjs   (needs Google Chrome; macOS for the .icns step)
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const font = join(root, '.dev/cache/fonts/NotoSansJP-Bold.otf')
if (!existsSync(font)) throw new Error('font missing: download NotoSansJP-Bold.otf (notofonts/noto-cjk) into .dev/cache/fonts')
const out = join(root, 'build-resources')
mkdirSync(out, { recursive: true })

const chrome = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = mkdtempSync(join(tmpdir(), 'tomo-icon-'))
const port = 9361
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 50 && !targets; i++) { await sleep(200); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() } catch { /* starting */ } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id) })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })

const fontB64 = readFileSync(font).toString('base64')
const draw = `(async () => {
  const f = new FontFace('TomoMark', Uint8Array.from(atob(${JSON.stringify(fontB64)}), (c) => c.charCodeAt(0)))
  await f.load(); document.fonts.add(f)
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  // macOS icon grid: 824 px body on a 1024 canvas, continuous-corner radius ≈ 185
  const x = 100, y = 100, w = 824, r = 185
  g.save(); g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 28; g.shadowOffsetY = 12
  g.beginPath(); g.roundRect(x, y, w, w, r)
  const bg = g.createLinearGradient(0, y, 0, y + w); bg.addColorStop(0, '#DA5B42'); bg.addColorStop(1, '#B53B27')
  g.fillStyle = bg; g.fill(); g.restore()
  // soft top highlight
  g.save(); g.beginPath(); g.roundRect(x, y, w, w, r); g.clip()
  const hl = g.createLinearGradient(0, y, 0, y + w * .55); hl.addColorStop(0, 'rgba(255,255,255,.18)'); hl.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = hl; g.fillRect(x, y, w, w * .55); g.restore()
  g.fillStyle = '#FFFFFF'; g.font = '560px TomoMark'; g.textAlign = 'center'; g.textBaseline = 'middle'
  const m = g.measureText('伴'); const dy = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
  g.fillText('伴', S / 2, S / 2 + dy)
  return c.toDataURL('image/png').split(',')[1]
})()`
const res = await send('Runtime.evaluate', { expression: draw, awaitPromise: true, returnByValue: true })
ws.close(); proc.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true })
const png = Buffer.from(res.result.result.value, 'base64')
writeFileSync(join(out, 'icon.png'), png)

// Windows .ico: PNG-compressed entries (Vista+) at 256/128/64/48/32/16, resized by sips (macOS) when available
const sizes = [256, 128, 64, 48, 32, 16]
const tmp = mkdtempSync(join(tmpdir(), 'tomo-ico-'))
const images = sizes.map((s) => {
  const f = join(tmp, `${s}.png`)
  if (process.platform === 'darwin') execFileSync('sips', ['-z', String(s), String(s), join(out, 'icon.png'), '--out', f], { stdio: 'ignore' })
  else writeFileSync(f, png) // other OSes: one full-size entry is still valid
  return readFileSync(f)
})
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
let offset = 6 + 16 * images.length
const dir = images.map((img, i) => {
  const e = Buffer.alloc(16); const s = sizes[i] >= 256 ? 0 : sizes[i]
  e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(img.length, 8); e.writeUInt32LE(offset, 12)
  offset += img.length; return e
})
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...dir, ...images]))

if (process.platform === 'darwin') {
  const set = join(tmp, 'icon.iconset'); mkdirSync(set)
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), join(out, 'icon.png'), '--out', join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), join(out, 'icon.png'), '--out', join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(out, 'icon.icns')])
}
rmSync(tmp, { recursive: true, force: true })
console.log('icon written:', ['icon.png', 'icon.ico', 'icon.icns'].filter((f) => existsSync(join(out, f))).join(', '))
