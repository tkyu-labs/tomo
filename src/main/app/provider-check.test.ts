import { describe, expect, it } from 'vitest'
import { chatModels, listProviderModels, modelsRequest } from './provider-check'

const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })

describe('provider check', () => {
  it('builds the models request per provider', () => {
    expect(modelsRequest({ id: 'openrouter' }, 'k')).toEqual({ url: 'https://openrouter.ai/api/v1/models', headers: { authorization: 'Bearer k' } })
    expect(modelsRequest({ id: 'custom', baseUrl: 'https://x.example/v1/', customKind: 'openai' }, 'k').url).toBe('https://x.example/v1/models')
    expect(modelsRequest({ id: 'custom', baseUrl: 'https://a.example', customKind: 'anthropic' }, 'k')).toEqual({ url: 'https://a.example/v1/models', headers: { 'x-api-key': 'k', 'anthropic-version': '2023-06-01' } })
  })
  it('keeps chat models only', () => {
    expect(chatModels(['gpt-6-luna', 'text-embedding-3-small', 'whisper-1', 'gpt-6-sol', 'gpt-6-luna'])).toEqual(['gpt-6-luna', 'gpt-6-sol'])
  })
  it('reports a wrong key, an unreachable endpoint and a model list', async () => {
    expect(await listProviderModels({ id: 'deepseek' }, 'bad', json(401, {}) as never)).toEqual({ ok: false, error: 'wrong-key' })
    expect((await listProviderModels({ id: 'deepseek' }, 'k', (async () => { throw new Error('ENOTFOUND') }) as never)).error).toBe('unreachable')
    expect(await listProviderModels({ id: 'deepseek' }, 'k', json(200, { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }) as never)).toEqual({ ok: true, models: ['deepseek-chat', 'deepseek-reasoner'] })
  })
})
