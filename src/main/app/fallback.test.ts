import { describe, expect, it } from 'vitest'
import { connectionsOf, fallbackOf } from './controller'
import { DEFAULT_SETTINGS, type Settings } from './settings'

const gakuen = { id: 'gakuen' as const, model: 'deepseek-flash', baseUrl: 'https://r/v1' }
const deepseek = { id: 'deepseek' as const, model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] }
const settings = (s: Partial<Settings>): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), setupDone: true, ...s })

describe('fallback (on by default with a second connection)', () => {
  it('older settings hold only the provider in use', () => {
    expect(connectionsOf(settings({ provider: gakuen }))).toEqual([gakuen])
    expect(fallbackOf(settings({ provider: gakuen }))).toBeNull()
  })

  it('uses the first other connection with its model unless the student picked one or turned it off', () => {
    const base = { provider: gakuen, connections: [gakuen, deepseek] }
    expect(fallbackOf(settings(base))).toEqual({ id: 'deepseek', model: 'deepseek-chat' })
    expect(fallbackOf(settings({ ...base, fallbackPick: { id: 'deepseek', model: 'deepseek-reasoner' } }))).toEqual({ id: 'deepseek', model: 'deepseek-reasoner' })
    expect(fallbackOf(settings({ ...base, fallbackPick: 'off' }))).toBeNull()
  })

  it('never falls back to the provider in use; a pick that became the one in use is replaced', () => {
    const s = settings({ provider: { id: 'deepseek', model: 'deepseek-chat' }, connections: [gakuen, deepseek], fallbackPick: { id: 'deepseek', model: 'deepseek-chat' } })
    expect(fallbackOf(s)).toEqual({ id: 'gakuen', model: 'deepseek-flash' })
  })
})
