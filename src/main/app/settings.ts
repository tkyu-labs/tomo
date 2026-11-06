import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Answers } from '@shared/pack/types'
import type { AnswerMode, Connection, FallbackChoice, PackUpdateMode, Prefs, ProviderChoice } from '@shared/ipc'
import type { Lang } from '@shared/pack/types'

/** Non-secret settings (settings.json in Tomo's folder). Identifier answers are never stored here. */
export interface Settings {
  setupDone: boolean
  prefs: Prefs
  /** The provider in use. */
  provider?: ProviderChoice
  /** Every connected provider (the one in use included). Missing in settings from before 0.1.1: [provider]. */
  connections?: Connection[]
  /** The student's fallback pick, or 'off'. Unset: the first other connection (fallback is on by default). */
  fallbackPick?: FallbackChoice | 'off'
  packId?: string
  /** Hatch answers without identifier questions (those live only in the secret store). */
  answers: Answers
  answerMode: AnswerMode
  /** Random pseudonymous id for the local study log. */
  participantId?: string
  /** GakuenAI relay URL for tester builds (set by the installer or TOMO_GAKUEN_URL). */
  gakuenUrl?: string
  /** The school pack was removed: the general Hatch runs before the chat comes back (first-run screen at Hatch). */
  hatchPending?: boolean
  /** School pack updates (default: automatic). */
  packUpdateMode?: PackUpdateMode
  /** Windows: the "Tomo keeps running in the tray" notice was shown after the first close. */
  trayHintShown?: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  setupDone: false,
  prefs: { locale: 'en', theme: 'light', uiScale: 'auto', closeAction: 'tray' },
  answers: {},
  answerMode: 'direct',
}

export class SettingsFile {
  /** `defaultLocale`: the OS language, used until the student picks one (the default follows the OS). */
  constructor(private readonly file: string, private readonly defaultLocale: () => Lang = () => 'en') {}

  read(): Settings {
    const data = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>) : {}
    const defaults = structuredClone(DEFAULT_SETTINGS)
    defaults.prefs.locale = this.defaultLocale()
    return { ...defaults, ...data, prefs: { ...defaults.prefs, ...data.prefs } }
  }

  update(fn: (s: Settings) => void): Settings {
    const s = this.read()
    fn(s)
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify(s, null, 2))
    renameSync(this.file + '.tmp', this.file)
    return s
  }
}
