import { stringify } from 'yaml'
import { providerConfig, REASONING_EFFORT, type ProviderSelection } from './providers'

export interface ConfigInput {
  provider: ProviderSelection
  /** Installed pack's skills folder (absolute). */
  packSkillsDir?: string
  plugins?: string[]
}

/**
 * Tomo's config.yaml for Hermes. Hermes deep-merges its own
 * defaults (config.py), so only what Tomo means is written. Every switch here has a reason in the decision docs.
 */
export function buildHermesConfig(input: ConfigInput): Record<string, unknown> {
  const { model, custom_providers } = providerConfig(input.provider)
  const config: Record<string, unknown> = {
    model,
    ...(custom_providers ? { custom_providers } : {}),
    // Only what a student assistant needs; no code execution (Hermes issue #139062), no subagents, cron, kanban,
    // image generation or text-to-speech.
    toolsets: ['web', 'browser', 'file', 'terminal', 'skills', 'memory', 'todo', 'clarify', 'vision', 'session_search'],
    agent: { reasoning_effort: REASONING_EFFORT[input.provider.reasoning ?? 'low'] },
    memory: {
      memory_enabled: true,
      user_profile_enabled: true,
      user_char_limit: 3000, // Hatch fills at most 60 % (tomo-packs validator)
    },
    skills: { external_dirs: input.packSkillsDir ? [input.packSkillsDir] : [] },
    plugins: { enabled: input.plugins ?? ['tomo-privacy'] },
    browser: {
      backend: 'off', // step-wise browser_* tools; Browser Use mode (browser_exec) bypasses argument masking
      headed: true, // the student sees the window and signs in themselves
      restrict_evaluate: false, // pack skills read pages with browser_console expressions
    },
    // No password managers: the agent never fills logins.
    vault: { onepassword: { enabled: false }, bitwarden: { enabled: false } },
    approvals: { mode: 'manual' },
    security: { redact_secrets: true },
    auth: { adopt_external_logins: false }, // never borrow ~/.codex or ~/.claude logins
    updates: { check: false }, // also stops `gh auth token` at start
    model_catalog: { enabled: false },
    onboarding: { profile_build: 'off' },
    nous: { guest: false },
    telemetry: { shared_metrics: { enabled: false, send: false } },
  }
  return config
}

export const renderHermesConfig = (input: ConfigInput) =>
  '# Written by Tomo. Changes made here are replaced the next time Tomo saves its settings.\n' + stringify(buildHermesConfig(input))
