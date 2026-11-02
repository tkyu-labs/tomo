// Real-model check (opt-in): TOMO_REAL_MODEL=1 with OPENAI_API_KEY in the environment.
// The key is passed to the gateway as a process variable only; it is never printed or written.
import { describe, expect, it } from 'vitest'
import { HermesClient } from '../../src/main/hermes/client'
import { makeTestHome, startHermes } from '../helpers/hermes'

const enabled = !!process.env.TOMO_REAL_MODEL && !!process.env.OPENAI_API_KEY
const model = process.env.TOMO_REAL_OPENAI_MODEL ?? 'gpt-6-luna'

describe.skipIf(!enabled)('real OpenAI turn through Hermes', () => {
  it('answers one short question', async () => {
    const home = makeTestHome(`model:
  provider: openai-api
  default: ${model}
updates:
  check: false
model_catalog:
  enabled: false
onboarding:
  profile_build: "off"
nous:
  guest: false
`)
    const hermes = startHermes(home, { keys: { OPENAI_API_KEY: process.env.OPENAI_API_KEY! } })
    try {
      await hermes.start()
      const client = new HermesClient(hermes)
      const { session_id } = await client.createSession()
      const events = await client.runTurn(session_id, 'Reply with exactly the word: ready')
      const complete = events.at(-1)
      expect(complete?.kind).toBe('complete')
      const text = complete && 'text' in complete ? complete.text : ''
      expect(text.toLowerCase()).toContain('ready')
      expect(events.some((e) => e.kind === 'delta')).toBe(true)
      expect(home.writtenToFakeHome()).toEqual([])
    } finally {
      await hermes.stopAndWait()
      home.cleanup()
    }
  })
})
