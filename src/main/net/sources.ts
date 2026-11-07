// Where Tomo downloads from: its own mirror first (https://tomo.gakuen.ac/downloads, the same files as GitHub under
// the same names), GitHub second. The mirror only saves GitHub requests (rate limits, throttling); integrity never
// depends on it: Hermes is checked against its pinned SHA-256, packs against pack.lock, app updates against the
// sha512 in latest*.yml. TOMO_MIRROR_URL points elsewhere (tests: a local server); an empty value skips the mirror.
export const DEFAULT_MIRROR = 'https://tomo.gakuen.ac/downloads'

export function mirrorBase(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.TOMO_MIRROR_URL
  if (v === '') return null
  return (v ?? DEFAULT_MIRROR).replace(/\/+$/, '')
}

/** The mirror's URL for a path below /downloads (none when the mirror is off), then the GitHub URL. */
export function sources(mirrorPath: string, github: string, env: Record<string, string | undefined> = process.env): string[] {
  const m = mirrorBase(env)
  return [...(m ? [`${m}/${mirrorPath.replace(/^\/+/, '')}`] : []), github]
}

/**
 * The first source that answers with 2xx. A network error, a non-2xx answer or no answer within `timeoutMs` (until the
 * headers arrive; a long download is not cut off) moves on to the next source. Throws the last failure.
 */
export async function fetchFirst(urls: string[], init: RequestInit = {}, fetchFn: typeof fetch = fetch, timeoutMs = 15_000): Promise<Response> {
  let last: unknown = new Error('no source')
  for (const url of urls) {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(new Error(`no answer from ${new URL(url).host}`)), timeoutMs)
    try {
      const res = await fetchFn(url, { ...init, signal: abort.signal })
      clearTimeout(timer)
      if (res.ok) return res
      last = new Error(`${new URL(url).host} answered ${res.status}`)
      void res.body?.cancel().catch(() => undefined)
    } catch (e) {
      clearTimeout(timer)
      last = e
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
