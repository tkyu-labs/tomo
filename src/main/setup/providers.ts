// Model providers in the key sheet and how each maps to Hermes' config.
import type { ProviderChoice, ProviderId, Reasoning } from '@shared/ipc'

export type { ProviderId, Reasoning }
/** baseUrl: GakuenAI relay URL or a custom endpoint; customKind: OpenAI- or Anthropic-compatible endpoint. */
export type ProviderSelection = ProviderChoice

export const PROVIDER_KEY_ENV: Record<ProviderId, string | null> = {
  gakuen: 'GAKUEN_API_KEY',
  openai: null, // ChatGPT sign-in (OAuth, tokens in Hermes' auth.json)
  'openai-api': 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  custom: 'TOMO_CUSTOM_API_KEY',
}

// '' = no level: Hermes leaves it to the model (hermes_constants.parse_reasoning_effort)
export const REASONING_EFFORT: Record<Reasoning, string> = { default: '', off: 'none', low: 'low', medium: 'medium', high: 'high' }

/** `model` and `custom_providers` blocks of config.yaml for one selection. */
export function providerConfig(sel: ProviderSelection): { model: Record<string, unknown>; custom_providers?: Record<string, unknown>[] } {
  switch (sel.id) {
    case 'gakuen':
      if (!sel.baseUrl) throw new Error('GakuenAI needs the relay URL')
      return {
        model: { provider: 'custom:gakuen', default: sel.model },
        // GakuenAI speaks the OpenAI Responses protocol (Hermes: codex_responses, cli-config.yaml.example:267)
        custom_providers: [{ name: 'gakuen', base_url: sel.baseUrl, key_env: 'GAKUEN_API_KEY', api_mode: 'codex_responses' }],
      }
    case 'custom':
      if (!sel.baseUrl) throw new Error('a custom endpoint needs a base URL')
      return {
        model: { provider: 'custom:endpoint', default: sel.model },
        custom_providers: [{
          name: 'endpoint', base_url: sel.baseUrl, key_env: 'TOMO_CUSTOM_API_KEY',
          api_mode: sel.customKind === 'anthropic' ? 'anthropic_messages' : 'chat_completions',
        }],
      }
    case 'openai':
      return { model: { provider: 'openai-codex', default: sel.model } }
    default:
      return { model: { provider: sel.id, default: sel.model } }
  }
}
