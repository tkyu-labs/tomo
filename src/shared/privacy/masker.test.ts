import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Masker, StreamUnmasker, unmask, type IdentifierEntry } from './masker'

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../../../test/fixtures/masking-cases.json'), 'utf8')) as {
  payload: { identifiers: IdentifierEntry[] }
  cases: [string, string][]
}
const m = new Masker(fixture.payload.identifiers)
const values = { STUDENT_NUMBER: '23B0001', FULL_NAME: 'Lin Mei' }

describe('Masker (shared cases with the Python plugin)', () => {
  for (const [given, expected] of fixture.cases) {
    it(`masks ${JSON.stringify(given)}`, () => expect(m.mask(given)).toBe(expected))
  }
  it('masks nested values', () => {
    expect(m.maskAny({ args: { content: 'ID: 23B0001' }, list: ['Lin Mei'] })).toEqual({ args: { content: 'ID: {{STUDENT_NUMBER}}' }, list: ['{{FULL_NAME}}'] })
  })
})

describe('unmask', () => {
  it('restores known placeholders and keeps unknown ones', () => {
    expect(unmask('Hi {{FULL_NAME}} ({{STUDENT_NUMBER}}) {{OTHER}}', values)).toBe('Hi Lin Mei (23B0001) {{OTHER}}')
  })

  it('handles placeholders split across stream chunks', () => {
    const chunks = ['Hello {', '{FULL_', 'NAME', '}', '}, your number is {{STUD', 'ENT_NUMBER}}', '. Use { braces } freely {']
    const s = new StreamUnmasker(values)
    const out = chunks.map((c) => s.push(c)).join('') + s.flush()
    expect(out).toBe('Hello Lin Mei, your number is 23B0001. Use { braces } freely {')
  })
})
