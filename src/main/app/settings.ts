import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Answers } from '@shared/pack/types'
import type { AnswerMode, Prefs, ProviderChoice } from '@shared/ipc'

/** Non-secret settings (settings.json in Tomo's folder). Identifier answers are never stored here. */
export interface Settings {
  setupDone: boolean
  prefs: Prefs
  provider?: ProviderChoice
  packId?: string
  /** Hatch answers without identifier questions (those live only in the secret store). */
  answers: Answers
  answerMode: AnswerMode
  /** Random pseudonymous id for the local study log. */
  participantId?: string
  /** GakuenAI relay URL for tester builds (set by the installer or TOMO_GAKUEN_URL). */
  gakuenUrl?: string
  /** Windows: the "Tomo keeps running in the tray" notice was shown after the first close. */
  trayHintShown?: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  setupDone: false,
  prefs: { locale: 'en', theme: 'light', uiScale: 'auto' },
  answers: {},
  answerMode: 'direct',
}

export class SettingsFile {
  constructor(private readonly file: string) {}

  read(): Settings {
    if (!existsSync(this.file)) return structuredClone(DEFAULT_SETTINGS)
    const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>
    return { ...structuredClone(DEFAULT_SETTINGS), ...data, prefs: { ...DEFAULT_SETTINGS.prefs, ...data.prefs } }
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
