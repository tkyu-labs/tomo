// Questions from the engine: approvals (incl. tomo-privacy fills and personal-data reads) and clarify.
import { useState } from 'react'
import type { EngineRequest } from '@shared/ipc'
import { unmask } from '@shared/privacy/masker'
import { useCopy } from '../i18n'
import { Icon } from '../ui/Icon'

const PRIVACY = '[tomo-privacy]'

export function RequestDialog({ request, values, onDone }: { request: EngineRequest; values: Record<string, string>; onDone: () => void }) {
  const c = useCopy()
  const answer = async (result: unknown) => {
    await window.tomo.respond(request.id, result)
    onDone()
  }
  if (request.method === 'clarify') return <ClarifyDialog request={request} onAnswer={answer} />
  const description = String(request.params.description ?? '')
  const privacy = description.includes(PRIVACY)
  const text = unmask(description.replace(PRIVACY, '').trim(), values)
  const tool = String(request.params.tool_name ?? '')
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal approval-modal" role="alertdialog" aria-modal="true" aria-labelledby="req-title" data-testid="approval-dialog">
        <div className="action-head">
          <div className="action-icon"><Icon name={privacy ? 'lock' : 'shield'} size={18} /></div>
          <div>
            <span className="eyebrow">{privacy ? c('Personal data', '个人数据', '個人データ') : c('Approval needed', '需要授权', '承認が必要')}</span>
            <h3 id="req-title">{privacy ? text : c('Tomo wants to run an action', 'Tomo 想执行一个操作', 'Tomo が操作を実行しようとしています')}</h3>
          </div>
        </div>
        {!privacy && (
          <div className="action-details">
            <div><span>{c('Action', '操作', '操作')}</span><strong>{tool || String(request.params.command ?? '')}</strong></div>
            <div><span>{c('Details', '详情', '詳細')}</span><strong>{text}</strong></div>
          </div>
        )}
        <div className="action-note">
          <Icon name="shield" size={16} />
          {privacy
            ? c('The real value is filled in on this computer only after you approve. The AI model never sees it.', '只有在你批准后，才会在这台电脑上填入真实值。AI 模型始终看不到它。', '承認した後にだけ、この端末で実際の値を入力します。AI モデルには見えません。')
            : c('Tomo will only perform the action shown above.', 'Tomo 只会执行上面显示的操作。', 'Tomo は上に表示された操作だけを行います。')}
        </div>
        <div className="modal-actions approval-actions">
          <button className="secondary" data-testid="approval-deny" onClick={() => void answer({ choice: 'deny' })}>{c('Not now', '暂不', '今はしない')}</button>
          <button className="primary" data-testid="approval-allow" onClick={() => void answer({ choice: 'once' })}>
            <Icon name="check" size={15} />
            {c('Allow once', '允许一次', '今回だけ許可')}
          </button>
        </div>
      </div>
    </div>
  )
}

type ClarifyQuestion = { qid: string; question: string; choices?: string[] | null }

/** ClarifyRequestParams {questions:[{qid, question, choices}]} → ClarifyResult {answers: {qid: text}}; no answers = cancel. */
function ClarifyDialog({ request, onAnswer }: { request: EngineRequest; onAnswer: (r: unknown) => Promise<void> }) {
  const c = useCopy()
  const questions = ((request.params as { questions?: ClarifyQuestion[] }).questions ?? []).filter((q) => q.qid)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const set = (qid: string, v: string) => setAnswers((a) => ({ ...a, [qid]: v }))
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" data-testid="clarify-dialog">
        <h2>{c('Tomo has a question', 'Tomo 有个问题', 'Tomo からの質問')}</h2>
        {questions.map((q) => (
          <div key={q.qid} className="hatch-question">
            <label>{q.question}</label>
            {q.choices?.length ? (
              <div className="hatch-options-chips">
                {q.choices.map((ch) => <button key={ch} className={`hatch-chip-btn ${answers[q.qid] === ch ? 'selected' : ''}`} onClick={() => set(q.qid, ch)}>{ch}</button>)}
              </div>
            ) : (
              <input className="catalog-search-input" value={answers[q.qid] ?? ''} onChange={(e) => set(q.qid, e.target.value)} />
            )}
          </div>
        ))}
        <div className="modal-actions">
          <button className="secondary" onClick={() => void onAnswer({})}>{c('Skip', '跳过', 'スキップ')}</button>
          <button className="primary" disabled={questions.some((q) => !answers[q.qid]?.trim())} onClick={() => void onAnswer({ answers })}>{c('Send', '发送', '送信')}</button>
        </div>
      </div>
    </div>
  )
}
