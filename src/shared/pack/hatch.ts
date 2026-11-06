// Hatch logic shared by the setup UI (renderer) and the profile writer (main): conditions, prefills, the USER.md
// entries and the identifier list for the privacy layer. Ported from the UI prototype.
import type { IdentifierEntry } from '../privacy/masker'
import type { Answer, Answers, Hatch, HatchQuestion, Lang, MultiAnswer } from './types'

/** Hermes' built-in user memory limit Tomo sets (memory.user_char_limit); Hatch may fill 60 %. */
export const USER_MEMORY_LIMIT = 3000
export const HATCH_BUDGET = Math.floor(USER_MEMORY_LIMIT * 0.6)

export function isAnswered(q: HatchQuestion, a: Answer | undefined): boolean {
  if (a === undefined || a === null) return false
  if (typeof a === 'string') return a.trim().length > 0
  if (typeof a === 'number') return true
  if (q.type === 'multi') {
    const m = a as MultiAnswer
    return m.values.length > 0 || !!m.other?.trim()
  }
  return Object.values(a as Record<string, string>).some((v) => v?.trim())
}

/** `id op value` with op in == != > >= < <= (tomo-packs validator enforces the shape). */
export function conditionHolds(when: string | undefined, answers: Answers): boolean {
  if (!when) return true
  const m = when.match(/^\s*([a-z][a-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(\S+)\s*$/)
  if (!m) return true
  const [, id, op, raw] = m as unknown as [string, string, string, string]
  const a = answers[id]
  if (a === undefined) return false
  const left = typeof a === 'number' ? a : Number.isNaN(Number(a)) ? String(a) : Number(a)
  const right = Number.isNaN(Number(raw)) ? raw : Number(raw)
  switch (op) {
    case '==': return left === right
    case '!=': return left !== right
    case '>': return left > right
    case '>=': return left >= right
    case '<': return left < right
    case '<=': return left <= right
  }
  return true
}

export const setupQuestions = (hatch: Hatch, sectionId: string, answers: Answers): HatchQuestion[] =>
  hatch.questions.filter((q) => q.section === sectionId && q.ask === 'setup' && conditionHolds(q.when, answers))

export const visibleOptions = (q: HatchQuestion, answers: Answers) => (q.options ?? []).filter((o) => conditionHolds(o.when, answers))

/** Answers suggested from another answer (faculty, major, entry year from the student number). */
export function prefills(hatch: Hatch, changedId: string, answers: Answers, prefilled: string[] = []): Answers {
  const out: Answers = {}
  for (const q of hatch.questions) {
    const pf = q.prefill_from
    if (!pf || pf.question !== changedId || (isAnswered(q, answers[q.id]) && !prefilled.includes(q.id))) continue
    const src = answers[changedId]
    if (typeof src !== 'string') continue
    const m = src.trim().toUpperCase().match(new RegExp(pf.regex))
    const g = m?.[pf.group]
    if (!g) continue
    let v: string = pf.map?.[g] ?? g
    if (pf.prefix) v = pf.prefix + v
    // a choice is prefilled only with one of its options (e.g. a new faculty letter): otherwise the student picks
    if ((q.type === 'choice' || q.type === 'multi') && !q.allow_other && !q.options?.some((o) => String(o.value) === v)) continue
    out[q.id] = q.type === 'number' ? Number(v) : v
  }
  return out
}

const enLabel = (q: HatchQuestion, v: string | number) => q.options?.find((o) => o.value === v)?.label.en ?? String(v)

/** The text that replaces {answer} in a `remember` line (English labels, as Tomo writes USER.md). */
export function answerText(q: HatchQuestion, a: Answer | undefined): string {
  if (a === undefined) return ''
  if (q.type === 'multi') {
    const m = a as MultiAnswer
    return [...m.values.map((v) => enLabel(q, v)), ...(m.other?.trim() ? [m.other.trim()] : [])].join(', ')
  }
  if (q.type === 'choice' || q.type === 'scale') return enLabel(q, a as string)
  if (q.type === 'identifier') return q.variable ? `{{${q.variable}}}` : ''
  return String(a)
}

const LANGUAGE_EN: Record<Lang, string> = { en: 'English', zh: 'Simplified Chinese', ja: 'Japanese' }
/** Tomo's own entry when the student answered none of the questions (any Hatch). */
export const SKIPPED_NOTE = 'The user skipped the first-run questions. Do not ask for these details up front; learn their needs and preferences from the conversation, and ask only when an answer really depends on it.'

/**
 * memories/USER.md entries: one per answered question with a `remember` line; identifiers stay placeholders. Tomo's
 * own rules for every Hatch: always one language entry (the app language unless a `reply_language` question set it),
 * and SKIPPED_NOTE when nothing else was answered. Nothing is made up for skipped questions.
 */
export function userMemoryEntries(hatch: Hatch, answers: Answers, appLang: Lang = 'en'): string[] {
  const entries = hatch.questions
    .filter((q) => q.remember && conditionHolds(q.when, answers) && isAnswered(q, answers[q.id]))
    .map((q) => q.remember!.replace('{answer}', answerText(q, answers[q.id])).trim())
  const language = hatch.questions.find((q) => q.id === 'reply_language')
  if (!language || !isAnswered(language, answers.reply_language)) entries.unshift(`Reply in ${LANGUAGE_EN[appLang]} unless the user writes in another language.`)
  const answeredAny = hatch.questions.some((q) => q.ask === 'setup' && q.id !== 'reply_language' && conditionHolds(q.when, answers) && isAnswered(q, answers[q.id]))
  if (!answeredAny) entries.push(SKIPPED_NOTE)
  return entries
}

/** Hermes' USER.md format: entries separated by "\n§\n" (tools/memory_tool.py). */
export const USER_MD_SEPARATOR = '\n§\n'
export const renderUserMd = (entries: string[]) => entries.join(USER_MD_SEPARATOR) + '\n'

/** Identifier values for the privacy layer (never written to Hermes' files). */
export function identifiersFrom(hatch: Hatch, answers: Answers): IdentifierEntry[] {
  const out: IdentifierEntry[] = []
  for (const q of hatch.questions) {
    if (q.type !== 'identifier' || !q.variable) continue
    const a = answers[q.id]
    if (!isAnswered(q, a)) continue
    let values: string[]
    let kind: 'id' | 'name' = 'id'
    if (typeof a === 'string') values = [a.trim()]
    else if (typeof a === 'object' && a && !('values' in a)) {
      values = (q.aliases ?? Object.keys(a)).map((k) => (a as Record<string, string>)[k]?.trim() ?? '').filter(Boolean)
      kind = 'name'
    } else continue
    if (values.length) out.push({ name: q.variable, values, kind, label: q.label.en.toLowerCase() })
  }
  return out
}

export function validateAnswer(q: HatchQuestion, a: Answer | undefined): boolean {
  if (!isAnswered(q, a)) return true
  if (q.validate && typeof a === 'string') return new RegExp(q.validate).test(a.trim().toUpperCase())
  if (q.type === 'number' && q.range && typeof a === 'number') return a >= q.range[0] && a <= q.range[1]
  if (q.max_length && typeof a === 'string') return a.length <= q.max_length
  return true
}
