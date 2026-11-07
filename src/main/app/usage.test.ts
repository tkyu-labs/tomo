import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageMeter } from './usage'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tomo-usage-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const LUNA = { prompt: '0.0000001', completion: '0.0000005', input_cache_read: '0.00000001' }
function openrouter(prices: Record<string, Record<string, string> | 'down'>) {
  const calls: string[] = []
  const fetchFn = (async (url: string) => {
    calls.push(url)
    const model = decodeURIComponent(url.split('/openai/')[1] ?? '')
    const p = prices[model]
    if (p === 'down') return new Response('busy', { status: 503 })
    return p ? new Response(JSON.stringify({ data: { id: `openai/${model}`, pricing: p } })) : new Response('{}', { status: 404 })
  }) as typeof fetch
  return { fetchFn, calls }
}

describe('GakuenAI spend estimate', () => {
  it('adds what each turn used, per month and model, and prices it with OpenRouter', async () => {
    const dir = tmp()
    let now = new Date(2026, 10, 7, 12)
    const or = openrouter({ 'gpt-6-luna': LUNA })
    const m = new UsageMeter(dir, or.fetchFn, () => now)
    // Hermes reports running totals per chat; prompt = input + cache reads
    m.record('s1', { model: 'gpt-6-luna', input: 1000, output: 200, prompt: 1500 })
    m.record('s1', { model: 'gpt-6-luna', input: 3000, output: 500, prompt: 4000 })
    m.record('s2', { model: 'gpt-6-luna', input: 1000, output: 100, prompt: 1000 })
    const s = await m.summary()
    expect(s.models).toEqual([{ model: 'gpt-6-luna', tokens: { input: 4000, output: 600, cacheRead: 1000 }, usd: expect.any(Number) }])
    expect(s.usd).toBeCloseTo(4000 * 1e-7 + 600 * 5e-7 + 1000 * 1e-8, 12)
    // a new month starts at zero
    now = new Date(2026, 11, 1, 9)
    expect((await m.summary()).usd).toBe(0)
  })

  it('reads a price once a day, keeps the last one when OpenRouter is down, and shows no amount without a price', async () => {
    const dir = tmp()
    let now = new Date(2026, 10, 7, 12)
    let prices: Record<string, Record<string, string> | 'down'> = { 'gpt-6-luna': LUNA }
    const calls: string[] = []
    const fetchFn = (async (u: string) => { calls.push(u); return openrouter(prices).fetchFn(u) }) as typeof fetch
    const m = new UsageMeter(dir, fetchFn, () => now)
    expect(await m.price('gpt-6-luna')).toEqual({ prompt: 1e-7, completion: 5e-7, cacheRead: 1e-8 })
    await m.price('gpt-6-luna')
    expect(calls.length).toBe(1)
    now = new Date(2026, 10, 8, 8)
    prices = { 'gpt-6-luna': 'down' }
    expect((await m.price('gpt-6-luna'))?.prompt).toBe(1e-7) // yesterday's price
    expect(await m.price('gpt-reserve')).toBeNull() // not on OpenRouter (offered to nobody)
    m.record('s', { model: 'gpt-reserve', input: 10, output: 10 })
    expect((await m.summary()).usd).toBeNull()
  })
})
