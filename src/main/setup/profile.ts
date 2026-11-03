import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnswerMode } from '@shared/ipc'
import { identifiersFrom, renderUserMd, userMemoryEntries } from '@shared/pack/hatch'
import type { Answers } from '@shared/pack/types'
import type { IdentifierEntry } from '@shared/privacy/masker'
import type { LoadedPack } from '../pack/pack'
import { renderHermesConfig } from './config'
import { refreshTomoFiles, writeHermesHome } from './home'
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

/** Engine start: Tomo's plugins and SOUL.md as this app version ships them (see refreshTomoFiles). */
export function refreshProfile(hermesHome: string, pluginsSourceDir: string, pack: LoadedPack | undefined, placeholderNames: string[]): void {
  refreshTomoFiles(hermesHome, buildSoul({ pack, placeholderNames }), pluginsSourceDir, TOMO_PLUGINS)
}

/** TOMO_PRIVATE for the privacy plugin: identifier values plus where they may be filled in. */
export function privatePayload(identifiers: IdentifierEntry[], pack?: LoadedPack, answers: Answers = {}): string {
  const perm = pack?.manifest.permissions
  const consent = perm?.personal_consent
  const answer = consent ? answers[consent.question] : undefined
  return JSON.stringify({
    version: 1,
    identifiers,
    fill: { tools: ['browser_type'], origins: perm?.browser_origins ?? [] },
    // read by tomo-privacy: personal-data sites and whether the student refused reading them in Hatch
    personal: { origins: perm?.personal_origins ?? [], refused: typeof answer === 'string' && !!consent?.refuse.includes(answer) },
  })
}

export const pluginsDir = (appRoot: string) => join(appRoot, 'plugins')

/** Read by the `tomo` plugin on every turn (pre_llm_call), so a change applies without restarting the engine. */
export function writeAnswerMode(hermesHome: string, mode: AnswerMode): void {
  mkdirSync(join(hermesHome, 'tomo'), { recursive: true })
  writeFileSync(join(hermesHome, 'tomo', 'answer-mode.json'), JSON.stringify({ mode }))
}
