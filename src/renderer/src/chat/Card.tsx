// Renders a `tomo_card` call (plugins/tomo) from its tool.start arguments. Text is unmasked for display only.
import { unmask } from '@shared/privacy/masker'
import { useCopy } from '../i18n'
import { Icon, type IconName } from '../ui/Icon'

export interface CardData { kind: string; title?: string; data: Record<string, unknown> }
type Row = Record<string, string | number | undefined>

export function Card({ card, values }: { card: CardData; values: Record<string, string> }) {
  const c = useCopy()
  const u = (v: unknown) => (v === undefined || v === null ? '' : unmask(String(v), values))
  const list = (key: string) => (Array.isArray(card.data[key]) ? (card.data[key] as Row[]) : [])
  const icon: Record<string, IconName> = { course_table: 'book', steps: 'file', deadlines: 'calendar', sources: 'external', info_chain: 'find' }
  const heading: Record<string, string> = {
    course_table: c('Courses', '课程', '科目'), steps: c('Steps', '步骤', '手順'), deadlines: c('Deadlines', '截止日期', '締切'),
    sources: c('Sources', '来源', '出典'), info_chain: c('Where to find it', '去哪里找', '調べ方'),
  }
  return (
    <div className={`tomo-card card-${card.kind}`} data-testid="tomo-card" data-kind={card.kind}>
      <div className="tomo-card-head"><Icon name={icon[card.kind] ?? 'info'} size={14} /><strong>{u(card.title) || heading[card.kind] || card.kind}</strong></div>
      {card.kind === 'course_table' && (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead><tr><th>{c('Code', '代码', 'コード')}</th><th>{c('Course', '课程', '科目')}</th><th>{c('Category', '类别', '区分')}</th><th>{c('Credits', '学分', '単位')}</th><th>{c('Time', '时间', '時限')}</th></tr></thead>
            <tbody>{list('rows').map((r, i) => (
              <tr key={i}><td><code>{u(r.code)}</code></td><td><strong lang="ja">{u(r.title)}</strong>{r.note ? <small className="card-note">{u(r.note)}</small> : null}</td><td lang="ja">{u(r.category)}</td><td>{u(r.credits)}</td><td lang="ja">{u(r.time)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {(card.kind === 'steps' || card.kind === 'info_chain') && (
        <ol className="card-steps">
          {list('steps').map((s, i) => (
            <li key={i}>
              <strong>{u(s.title ?? s.where)}</strong>
              {(s.detail ?? s.how) ? <span>{u(s.detail ?? s.how)}</span> : null}
              {s.url ? <a href={String(s.url)} target="_blank" rel="noreferrer">{String(s.url)}</a> : null}
            </li>
          ))}
          {card.kind === 'info_chain' && card.data.last_step ? (
            <li className="card-last-step"><strong>{c('Your step', '你自己完成', 'あなたのステップ')}</strong><span>{u(card.data.last_step)}</span></li>
          ) : null}
        </ol>
      )}
      {card.kind === 'deadlines' && (
        <ul className="card-list">{list('items').map((d, i) => <li key={i}><b>{u(d.date)}</b> {u(d.title)}{d.source ? <small className="card-note"> · {u(d.source)}</small> : null}</li>)}</ul>
      )}
      {card.kind === 'sources' && (
        <ol className="card-list card-sources">{list('items').map((s, i) => (
          <li key={i}>{s.url ? <a href={String(s.url)} target="_blank" rel="noreferrer">{u(s.title)}</a> : <span>{u(s.title)}</span>}{[s.code, s.page, s.date].filter(Boolean).length ? <small className="card-note"> · {[s.code, s.page, s.date].filter(Boolean).map(u).join(' · ')}</small> : null}</li>
        ))}</ol>
      )}
    </div>
  )
}
