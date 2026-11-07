// "Test" in the key sheet: ask the provider for its model list with the key the student typed. A key that works
// returns models; the student then picks one instead of typing a model id.
import type { ProviderChoice } from '@shared/ipc'

export interface ModelsResult { ok: boolean; models?: string[]; error?: 'wrong-key' | 'no-credit' | 'unreachable' | 'no-models'; detail?: string }

const BASE: Partial<Record<ProviderChoice['id'], string>> = {
  'openai-api': 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
}

export function modelsRequest(choice: Pick<ProviderChoice, 'id' | 'baseUrl' | 'customKind'>, key: string): { url: string; headers: Record<string, string> } {
  const anthropic = choice.id === 'custom' && choice.customKind === 'anthropic'
  const base = (choice.id === 'custom' || choice.id === 'gakuen' ? choice.baseUrl : BASE[choice.id])?.replace(/\/+$/, '')
  if (!base) throw new Error(`no endpoint for ${choice.id}`)
  if (anthropic) {
    const root = base.endsWith('/v1') ? base : `${base}/v1`
    return { url: `${root}/models`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }
  }
  return { url: `${base}/models`, headers: { authorization: `Bearer ${key}` } }
}

/** Chat-capable ids first; embeddings, audio, image and moderation models are left out. */
export function chatModels(ids: string[]): string[] {
  const skip = /(embed|whisper|tts|audio|transcri|dall-e|image|moderation|realtime|search-preview|davinci|babbage|^ft:)/i
  return [...new Set(ids.filter((id) => !skip.test(id)))].sort((a, b) => a.localeCompare(b))
}

const NO_CREDIT = /insufficient|balance|quota|credit|billing/i

export async function listProviderModels(choice: Pick<ProviderChoice, 'id' | 'baseUrl' | 'customKind'>, key: string, fetchFn: typeof fetch = fetch): Promise<ModelsResult> {
  let req
  try { req = modelsRequest(choice, key) } catch (e) { return { ok: false, error: 'unreachable', detail: String(e) } }
  let res: Response
  try {
    res = await fetchFn(req.url, { headers: req.headers, signal: AbortSignal.timeout(15_000) })
  } catch (e) {
    return { ok: false, error: 'unreachable', detail: e instanceof Error ? e.message : String(e) }
  }
  // a valid key on an account without balance or quota is not a wrong key (GakuenAI: 403 INSUFFICIENT_BALANCE, also
  // for a key that was never used; OpenRouter 402; OpenAI 429 insufficient_quota): pasting the key again cannot help
  if (res.status === 402 || ((res.status === 403 || res.status === 429) && NO_CREDIT.test(await res.clone().text().catch(() => '')))) return { ok: false, error: 'no-credit' }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'wrong-key' }
  if (!res.ok) return { ok: false, error: 'unreachable', detail: `HTTP ${res.status}` }
  const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }[]; models?: { id?: string; name?: string }[] }
  const ids = (body.data ?? body.models ?? []).map((m) => (m as { id?: string }).id ?? (m as { name?: string }).name ?? '').filter(Boolean)
  const models = chatModels(ids)
  return models.length ? { ok: true, models } : { ok: false, error: 'no-models' }
}
