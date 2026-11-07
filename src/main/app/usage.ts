// GakuenAI spend, estimated (the relay has no usage API Tomo can read; no limit is shown). Hermes reports each chat's
// running token totals in `message.complete` (tui_gateway/server.py `_get_usage`); Tomo adds what a turn used to this
// month's per-model totals and prices them with OpenRouter's list price for the same OpenAI model
// (https://openrouter.ai/api/v1/model/openai/<model>), read at most once a day and cached. Title generation and
// other auxiliary calls are not in Hermes' totals, so the estimate is slightly low.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { UsageSummary } from '@shared/ipc'

/** USD per token, as OpenRouter lists them. */
export interface Price { prompt: number; completion: number; cacheRead?: number }
export interface Tokens { input: number; output: number; cacheRead: number }
export type { UsageSummary } from '@shared/ipc'

type Ledger = { month: string; models: Record<string, Tokens> }
/** today's prices; `last`: every price seen before (used while OpenRouter cannot be reached) */
type PriceCache = { date: string; prices: Record<string, Price | null>; last?: Record<string, Price> }

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const dayOf = (d: Date) => `${monthOf(d)}-${String(d.getDate()).padStart(2, '0')}`
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export class UsageMeter {
  /** last running totals per chat (Hermes counts per chat; a new agent starts again at 0) */
  private last = new Map<string, Tokens & { model: string }>()

  constructor(private readonly dataDir: string, private readonly fetchFn: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  private file = (name: string) => join(this.dataDir, name)

  private read<T>(name: string, fallback: T): T {
    try { return JSON.parse(readFileSync(this.file(name), 'utf8')) as T } catch { return fallback }
  }

  private write(name: string, data: unknown): void {
    mkdirSync(dirname(this.file(name)), { recursive: true })
    writeFileSync(this.file(name), JSON.stringify(data, null, 2))
  }

  /** A turn ended: `usage` is Hermes' running total for this chat. */
  record(sessionId: string, usage: Record<string, unknown> | null | undefined): void {
    if (!usage || typeof usage.model !== 'string' || !usage.model) return
    // prompt = input + cache reads + cache writes (Hermes' CanonicalUsage); cache_read is not always reported
    const cacheRead = num(usage.cache_read) || Math.max(0, num(usage.prompt) - num(usage.input))
    const now = { model: usage.model, input: num(usage.input), output: num(usage.output), cacheRead }
    const before = this.last.get(sessionId)
    this.last.set(sessionId, now)
    // same chat and model: what this turn added; otherwise (first turn seen, model switch, reset) the totals so far
    const same = before && before.model === now.model && now.input >= before.input && now.output >= before.output
    const delta: Tokens = same
      ? { input: now.input - before.input, output: now.output - before.output, cacheRead: Math.max(0, now.cacheRead - before.cacheRead) }
      : { input: now.input, output: now.output, cacheRead: now.cacheRead }
    if (!delta.input && !delta.output && !delta.cacheRead) return
    const month = monthOf(this.now())
    const ledger = this.read<Ledger>('usage.json', { month, models: {} })
    const current = ledger.month === month ? ledger : { month, models: {} }
    const t = current.models[now.model] ?? { input: 0, output: 0, cacheRead: 0 }
    current.models[now.model] = { input: t.input + delta.input, output: t.output + delta.output, cacheRead: t.cacheRead + delta.cacheRead }
    this.write('usage.json', current)
  }

  /** OpenRouter's price for `openai/<model>`, from the day's cache (one request per model per day). */
  async price(model: string): Promise<Price | null> {
    const today = dayOf(this.now())
    const cache = this.read<PriceCache>(join('cache', 'openrouter-prices.json'), { date: '', prices: {} })
    const last: Record<string, Price> = { ...cache.last }
    for (const [m, p] of Object.entries(cache.prices)) if (p) last[m] = p
    const fresh = cache.date === today ? cache : { date: today, prices: {} as Record<string, Price | null> }
    if (model in fresh.prices) return fresh.prices[model] ?? null
    let price: Price | null = null
    try {
      const res = await this.fetchFn(`https://openrouter.ai/api/v1/model/openai/${encodeURIComponent(model)}`, { signal: AbortSignal.timeout(10_000) })
      const p = res.ok ? ((await res.json()) as { data?: { pricing?: Record<string, string> } }).data?.pricing : undefined
      const prompt = Number(p?.prompt), completion = Number(p?.completion), cacheRead = Number(p?.input_cache_read)
      if (Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0) {
        price = { prompt, completion, ...(Number.isFinite(cacheRead) ? { cacheRead } : {}) }
      } else if (!res.ok && res.status !== 404) {
        return last[model] ?? null // OpenRouter unavailable: the last known price, and try again next time
      }
    } catch {
      return last[model] ?? null
    }
    this.write(join('cache', 'openrouter-prices.json'), { date: today, prices: { ...fresh.prices, [model]: price }, last })
    return price
  }

  /** This month's estimate (no limit: the relay's is unknown to Tomo). */
  async summary(): Promise<UsageSummary> {
    const month = monthOf(this.now())
    const ledger = this.read<Ledger>('usage.json', { month, models: {} })
    const models = ledger.month === month ? ledger.models : {}
    const rows = await Promise.all(Object.entries(models).map(async ([model, tokens]) => {
      const p = await this.price(model)
      const usd = p ? tokens.input * p.prompt + tokens.output * p.completion + tokens.cacheRead * (p.cacheRead ?? p.prompt) : null
      return { model, tokens, usd }
    }))
    const priced = rows.filter((r) => r.usd !== null)
    return { month, usd: priced.length ? priced.reduce((a, r) => a + r.usd!, 0) : rows.length ? null : 0, models: rows }
  }
}

