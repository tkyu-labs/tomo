import { describe, expect, it } from 'vitest'
import { StreamUnmasker } from '@shared/privacy/masker'
import { applyEvent, type ChatSession } from './Chat'

const run = (events: Parameters<typeof applyEvent>[1][]) => {
  const un = new StreamUnmasker({})
  return events.reduce<ChatSession>((s, e) => applyEvent(s, e, un, {}), { id: 's', title: '', messages: [{ role: 'user', text: 'hi' }], busy: true, loaded: true })
}
const fallback = { kind: 'fallback' as const, provider: 'deepseek' as const, model: 'deepseek-chat', from: 'gakuen' as const }

describe('fallback mark', () => {
  it('marks the answer when the notice comes during the turn', () => {
    const s = run([{ kind: 'delta', text: 'Hello' }, fallback, { kind: 'complete', text: '' }])
    expect(s.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Hello', fallback: { provider: 'deepseek', from: 'gakuen' } })
  })

  it('marks the finished answer when the notice comes after it, without adding a message', () => {
    const s = run([{ kind: 'delta', text: 'Hello' }, { kind: 'complete', text: '' }, fallback])
    expect(s.messages).toHaveLength(2)
    expect(s.messages.at(-1)).toMatchObject({ role: 'assistant', fallback: { model: 'deepseek-chat' } })
  })
})
