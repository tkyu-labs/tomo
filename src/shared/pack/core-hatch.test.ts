import { describe, expect, it } from 'vitest'
import { CORE_HATCH } from './core-hatch'
import { identifiersFrom, SKIPPED_NOTE, userMemoryEntries } from './hatch'

describe("Tomo's general Hatch", () => {
  it('has the general questions on three pages, all in three languages', () => {
    expect(CORE_HATCH.sections.map((s) => s.id)).toEqual(['about', 'help', 'style'])
    expect(CORE_HATCH.questions.map((q) => q.id)).toEqual(['preferred_name', 'reply_language', 'daily', 'self_intro', 'goals', 'experience', 'familiar_fields', 'answer_style', 'notes'])
    for (const q of CORE_HATCH.questions) for (const l of ['en', 'zh', 'ja'] as const) expect(q.label[l]).toBeTruthy()
  })

  it('treats the name like every identifier: a placeholder in USER.md', () => {
    const answers = { preferred_name: { name: 'Mei' }, reply_language: 'zh', goals: { values: ['code', 'research'] } }
    expect(identifiersFrom(CORE_HATCH, answers).map((i) => i.name)).toEqual(['PREFERRED_NAME'])
    const md = userMemoryEntries(CORE_HATCH, answers, 'en')
    expect(md).toContain('Call the user {{PREFERRED_NAME}}.')
    expect(md).toContain('Reply in Simplified Chinese unless the user writes in another language.')
    expect(md.join('\n')).not.toContain('Mei')
    expect(md).not.toContain(SKIPPED_NOTE)
  })

  it('all skipped: the app language and the skipped note, nothing made up', () => {
    expect(userMemoryEntries(CORE_HATCH, {}, 'ja')).toEqual(['Reply in Japanese unless the user writes in another language.', SKIPPED_NOTE])
    // only the prefilled language answered still counts as skipped
    expect(userMemoryEntries(CORE_HATCH, { reply_language: 'en' }, 'ja')).toEqual(['Reply in English unless the user writes in another language.', SKIPPED_NOTE])
  })
})
