import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { conditionHolds, identifiersFrom, prefills, renderUserMd, setupQuestions, userMemoryEntries, validateAnswer } from './hatch'
import type { Answers, Hatch } from './types'

const hatch = parse(readFileSync(join(import.meta.dirname, '../../../test/fixtures/packs/example-u/hatch.yaml'), 'utf8')) as Hatch
const answers: Answers = { full_name: { name: 'Lin Mei', furigana: 'リン メイ' }, student_number: '23B0001', faculty: 'B', year: 3, grades_consent: 'watch' }

describe('Hatch', () => {
  it('evaluates conditions', () => {
    expect(conditionHolds('year > 1', { year: 3 })).toBe(true)
    expect(conditionHolds('year > 1', { year: 1 })).toBe(false)
    expect(conditionHolds('faculty == B', { faculty: 'B' })).toBe(true)
    expect(setupQuestions(hatch, 'basics', { year: 1 }).map((q) => q.id)).not.toContain('grades_consent')
  })

  it('prefills the faculty from the student number', () => {
    expect(prefills(hatch, 'student_number', { student_number: '23b0001' })).toEqual({ faculty: 'B' })
    // a letter without an option (a faculty the pack does not list yet) is left for the student to pick
    expect(prefills(hatch, 'student_number', { student_number: '23Q0001' })).not.toHaveProperty('faculty')
  })

  it('validates the student number', () => {
    const q = hatch.questions.find((x) => x.id === 'student_number')!
    expect(validateAnswer(q, '23B0001')).toBe(true)
    expect(validateAnswer(q, '2301')).toBe(false)
  })

  it('writes USER.md with placeholders only', () => {
    const md = renderUserMd(userMemoryEntries(hatch, answers))
    expect(md).toBe(
      "The student's name is {{FULL_NAME}}.\n§\nStudent number: {{STUDENT_NUMBER}}.\n§\nFaculty: Faculty of Information.\n§\nYear 3 student.\n§\nGrades: Yes, but only while I'm watching.\n",
    )
    expect(md).not.toMatch(/Lin Mei|23B0001/)
  })

  it('collects identifiers with aliases for the privacy layer', () => {
    expect(identifiersFrom(hatch, answers)).toEqual([
      { name: 'FULL_NAME', values: ['Lin Mei', 'リン メイ'], kind: 'name', label: 'name' },
      { name: 'STUDENT_NUMBER', values: ['23B0001'], kind: 'id', label: 'student number' },
    ])
  })
})
