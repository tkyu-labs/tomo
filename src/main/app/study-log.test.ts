import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StudyLog } from './study-log'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('StudyLog', () => {
  it('records one pseudonymous line per turn without bodies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomo-study-')); dirs.push(dir)
    let mode: 'direct' | 'chain' = 'chain'
    const log = new StudyLog(join(dir, 'study.jsonl'), 'p-test', () => ({ mode, pack: 'example-u' }))
    log.turnStarted('sess-1', 'timetable', 1000)
    log.event('sess-1', { kind: 'tool.start', toolId: '1', name: 'skill_view', args: { name: 'campus-portal' } }, 1100)
    log.event('sess-1', { kind: 'tool.start', toolId: '2', name: 'tomo_card', args: { kind: 'sources', data: { items: [{ title: 'Guide' }, { title: 'Syllabus' }] } } }, 1200)
    log.event('sess-1', { kind: 'delta', text: 'My name is Lin Mei' }, 1300)
    const rec = log.event('sess-1', { kind: 'complete', text: 'Lin Mei 23B0001', status: 'complete' }, 3000)
    expect(rec).toMatchObject({ participant: 'p-test', turn: 1, mode: 'chain', topic: 'timetable', duration_ms: 2000, tool_calls: ['skill_view'], cards: ['sources'], sources_shown: 2 })
    expect(rec!.session).not.toContain('sess-1')
    mode = 'direct'
    log.turnStarted('sess-1', null, 4000)
    expect(log.event('sess-1', { kind: 'complete', text: '', status: 'interrupted' }, 4500)).toMatchObject({ turn: 2, mode: 'direct', status: 'interrupted' })
    const out = join(dir, 'export.jsonl')
    expect(log.export(out)).toBe(2)
    const text = readFileSync(out, 'utf8')
    expect(text).not.toMatch(/Lin Mei|23B0001|campus-portal|Guide/)
  })
})
