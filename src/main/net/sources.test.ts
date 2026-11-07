import { describe, expect, it } from 'vitest'
import { fetchFirst, mirrorBase, sources } from './sources'

describe('download sources: mirror first, GitHub second', () => {
  it('builds mirror + GitHub URLs; TOMO_MIRROR_URL overrides or (empty) skips the mirror', () => {
    expect(mirrorBase({})).toBe('https://tomo.gakuen.ac/downloads')
    expect(sources('packs/main', 'https://api.github.com/x', {})).toEqual(['https://tomo.gakuen.ac/downloads/packs/main', 'https://api.github.com/x'])
    expect(sources('/hermes/a.tar.gz', 'G', { TOMO_MIRROR_URL: 'http://127.0.0.1:9/m/' })).toEqual(['http://127.0.0.1:9/m/hermes/a.tar.gz', 'G'])
    expect(sources('packs/main', 'G', { TOMO_MIRROR_URL: '' })).toEqual(['G'])
  })
  it('moves on after a non-2xx answer, a network error or no answer; throws the last failure', async () => {
    const seen: string[] = []
    const fake = (async (u: string, init?: RequestInit) => {
      seen.push(u)
      if (u.includes('down')) throw new TypeError('fetch failed')
      if (u.includes('slow')) return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
      if (u.includes('missing')) return new Response('nope', { status: 404 })
      return new Response('ok')
    }) as typeof fetch
    expect(await (await fetchFirst(['https://missing.example/a', 'https://down.example/a', 'https://slow.example/a', 'https://good.example/a'], {}, fake, 50)).text()).toBe('ok')
    expect(seen.length).toBe(4)
    await expect(fetchFirst(['https://missing.example/a', 'https://down.example/a'], {}, fake, 50)).rejects.toThrow(/fetch failed/)
  })
})
