import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnswerMode } from '@shared/ipc'
import { identifiersFrom, renderUserMd, userMemoryEntries } from '@shared/pack/hatch'
import type { Answers } from '@shared/pack/types'
import type { IdentifierEntry } from '@shared/privacy/masker'
import type { LoadedPack } from '../pack/pack'
import { renderHermesConfig } from './config'
import { writeHermesHome } from './home'
import type { ProviderSelection } from './providers'
import { buildSoul } from './soul'

export const TOMO_PLUGINS = ['tomo-privacy', 'tomo']

export interface ProfileInput {
  hermesHome: string
  pluginsSourceDir: string
  pack?: LoadedPack
  provider: ProviderSelection
  answers: Answers
  answerMode?: AnswerMode
}

export interface ProfileResult {
  identifiers: IdentifierEntry[]
  userMdEntries: string[]
}

/** The "save settings" + "create profile" steps of first-run Finish: everything Hermes reads, placeholders only. */
export function writeProfile(input: ProfileInput): ProfileResult {
  const identifiers = input.pack ? identifiersFrom(input.pack.hatch, input.answers) : []
  const userMdEntries = input.pack ? userMemoryEntries(input.pack.hatch, input.answers) : []
  writeHermesHome(
    input.hermesHome,
    {
      config: renderHermesConfig({ provider: input.provider, packSkillsDir: input.pack?.skillsDir, plugins: TOMO_PLUGINS }),
      soul: buildSoul({ pack: input.pack, placeholderNames: identifiers.map((i) => i.name) }),
      userMd: renderUserMd(userMdEntries),
    },
    input.pluginsSourceDir,
    TOMO_PLUGINS,
  )
  writeAnswerMode(input.hermesHome, input.answerMode ?? 'direct')
  return { identifiers, userMdEntries }
}

/** TOMO_PRIVATE for the privacy plugin: identifier values plus where they may be filled in. */
export function privatePayload(identifiers: IdentifierEntry[], pack?: LoadedPack): string {
  return JSON.stringify({
    version: 1,
    identifiers,
    fill: { tools: ['browser_type'], origins: pack?.manifest.permissions.browser_origins ?? [] },
  })
}

export const pluginsDir = (appRoot: string) => join(appRoot, 'plugins')

/** Read by the `tomo` plugin on every turn (pre_llm_call), so a change applies without restarting the engine. */
export function writeAnswerMode(hermesHome: string, mode: AnswerMode): void {
  mkdirSync(join(hermesHome, 'tomo'), { recursive: true })
  writeFileSync(join(hermesHome, 'tomo', 'answer-mode.json'), JSON.stringify({ mode }))
}
