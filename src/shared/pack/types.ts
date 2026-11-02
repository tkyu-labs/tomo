// Pack format types (tomo-packs schema/pack.schema.json, schema/hatch.schema.json).
export type Lang = 'en' | 'zh' | 'ja'
export type I18n = Record<Lang, string>
export const pick = (t: I18n | undefined, lang: Lang): string => (t ? (t[lang] ?? t.en) : '')

export interface PackManifest {
  schema: number
  id: string
  name: I18n
  school: { name: I18n; short: string; domain: string; country: string }
  version: string
  description?: I18n
  license: string
  publisher: { name: string; github: string }
  requires: { tomo: string; hermes: string }
  permissions: { network: string[]; browser_origins: string[]; personal_data: string[]; computer_use: boolean }
  sources: { official: string[]; refresh?: Record<string, string> }
  skills?: string[]
  ui?: {
    quick_topics?: { id: string; icon: string; skill: string; label: I18n; description: I18n; prompts: I18n[] }[]
    quick_ask_suggestions?: { skill: string; text: I18n }[]
  }
}

export type QuestionType = 'text' | 'longtext' | 'choice' | 'multi' | 'scale' | 'number' | 'municipality' | 'identifier' | 'login'

export interface HatchOption {
  value: string | number
  label: I18n
  when?: string
  examples?: string[]
}

export interface HatchQuestion {
  id: string
  section: string
  ask: 'setup' | 'later'
  type: QuestionType
  label: I18n
  why: I18n
  placeholder?: I18n
  options?: HatchOption[]
  allow_other?: boolean
  max_select?: number
  max_length?: number
  range?: [number, number]
  when?: string
  prefill_from?: { question: string; regex: string; group: number; prefix?: string; map?: Record<string, string> }
  variable?: string
  validate?: string
  aliases?: ('name' | 'furigana')[]
  origin?: string
  remember?: string
}

export interface Hatch {
  schema: number
  version: number
  sections: { id: string; title: I18n; intro?: I18n }[]
  questions: HatchQuestion[]
}

export type MultiAnswer = { values: (string | number)[]; other?: string }
export type IdentifierAnswer = Partial<Record<'name' | 'furigana', string>>
export type Answer = string | number | MultiAnswer | IdentifierAnswer
export type Answers = Record<string, Answer | undefined>
