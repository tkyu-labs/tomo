import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AnswerMode, ChatEvent } from '@shared/ipc'

/**
 * Local study log: per turn the answer mode, topic, tool calls, cards and sources shown,
 * timestamps and status. Pseudonymous (a random participant id and hashed session ids); never message bodies,
 * tool arguments or results. Stays on this computer until the participant exports it.
 */
export interface StudyRecord {
  ts: string
  participant: string
  session: string
  turn: number
  mode: AnswerMode
  pack: string | null
  topic: string | null
  started_ms: number
  duration_ms: number
  status: string
  tool_calls: string[]
  cards: string[]
  sources_shown: number
}

interface OpenTurn { start: number; tools: string[]; cards: string[]; sources: number; topic: string | null }

export class StudyLog {
  private open = new Map<string, OpenTurn>()
  private turns = new Map<string, number>()

  constructor(
    private readonly file: string,
    private readonly participant: string,
    private readonly context: () => { mode: AnswerMode; pack: string | null },
  ) {}

  static newParticipantId(): string {
    return 'p-' + randomUUID().slice(0, 8)
  }

  private pseudonym(sessionId: string): string {
    return createHash('sha256').update(this.participant + ':' + sessionId).digest('hex').slice(0, 12)
  }

  turnStarted(sessionId: string, topic: string | null = null, now = Date.now()): void {
    this.open.set(sessionId, { start: now, tools: [], cards: [], sources: 0, topic })
  }

  event(sessionId: string, e: ChatEvent, now = Date.now()): StudyRecord | null {
    const t = this.open.get(sessionId)
    if (!t) return null
    if (e.kind === 'tool.start') {
      if (e.name === 'tomo_card') {
        const kind = String(e.args?.kind ?? '')
        t.cards.push(kind)
        const data = e.args?.data as { items?: unknown[] } | undefined
        if (kind === 'sources' && Array.isArray(data?.items)) t.sources += data.items.length
      } else t.tools.push(e.name)
      return null
    }
    if (e.kind !== 'complete' && e.kind !== 'error') return null
    this.open.delete(sessionId)
    const turn = (this.turns.get(sessionId) ?? 0) + 1
    this.turns.set(sessionId, turn)
    const ctx = this.context()
    const rec: StudyRecord = {
      ts: new Date(now).toISOString(),
      participant: this.participant,
      session: this.pseudonym(sessionId),
      turn,
      mode: ctx.mode,
      pack: ctx.pack,
      topic: t.topic,
      started_ms: t.start,
      duration_ms: now - t.start,
      status: e.kind === 'error' ? 'error' : (e.status ?? 'complete'),
      tool_calls: t.tools,
      cards: t.cards,
      sources_shown: t.sources,
    }
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, JSON.stringify(rec) + '\n')
    return rec
  }

  records(): StudyRecord[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StudyRecord)
  }

  export(target: string): number {
    const recs = this.records()
    writeFileSync(target, recs.map((r) => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''))
    return recs.length
  }
}
