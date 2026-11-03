// Questions from the engine: approvals (incl. tomo-privacy fills and personal-data reads) and clarify.
import { useState } from 'react'
import type { EngineRequest } from '@shared/ipc'
import { yesNoChoices } from '@shared/clarify'
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
  const send = privacy ? parseSend(description.replace(PRIVACY, '').trim()) : null
  if (send) return <SendDialog send={send} onAnswer={answer} />
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

type SendRequest = { kind: 'send'; site: string; preview: string }

function parseSend(text: string): SendRequest | null {
  try {
    const v = JSON.parse(text) as Partial<SendRequest>
    return v.kind === 'send' && typeof v.preview === 'string' ? { kind: 'send', site: String(v.site ?? ''), preview: v.preview } : null
  } catch {
    return null
  }
}

/** tomo-privacy holds a value read on a personal-data site until the student decides whether the AI model may see it. */
function SendDialog({ send, onAnswer }: { send: SendRequest; onAnswer: (r: unknown) => Promise<void> }) {
  const c = useCopy()
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal approval-modal" role="alertdialog" aria-modal="true" aria-labelledby="send-title" data-testid="approval-dialog" data-kind="send">
        <div className="action-head">
          <div className="action-icon"><Icon name="lock" size={18} /></div>
          <div>
            <span className="eyebrow">{c('Personal data', '个人数据', '個人データ')}</span>
            <h3 id="send-title">{c('Send this to the AI model?', '把这些内容发送给 AI 模型吗？', 'この内容を AI モデルに送りますか？')}</h3>
          </div>
        </div>
        <p className="modal-intro">{c(`Tomo read this on ${send.site}. The AI model sees it only if you choose Send.`, `Tomo 在 ${send.site} 上读取了以下内容。只有你选择「发送」后，AI 模型才能看到。`, `Tomo が ${send.site} で読み取った内容です。「送る」を選んだときだけ AI モデルに届きます。`)}</p>
        {/* exactly what would be sent: identifiers stay as their placeholders */}
        <pre className="send-preview" data-testid="send-preview">{send.preview}</pre>
        <div className="action-note">
          <Icon name="shield" size={16} />
          {c('This is exactly what would be sent. Your name and student number appear only as {{…}} placeholders.', '以上就是会发送的全部内容。你的姓名和学号只会以 {{…}} 占位形式出现。', '送られる内容はこれですべてです。氏名と学籍番号は {{…}} の形でしか含まれません。')}
        </div>
        <div className="modal-actions approval-actions">
          <button className="secondary" data-testid="approval-deny" onClick={() => void onAnswer({ choice: 'deny' })}>{c("Don't send", '不发送', '送らない')}</button>
          <button className="primary" data-testid="approval-allow" onClick={() => void onAnswer({ choice: 'once' })}>
            <Icon name="check" size={15} />
            {c('Send to AI', '发送给 AI', 'AI に送る')}
          </button>
        </div>
      </div>
    </div>
  )
}

type ClarifyQuestion = { qid: string; question: string; choices?: string[] | null }

/**
 * ClarifyRequestParams {questions:[{qid, question, choices}]} → ClarifyResult {answers: {qid: text}}; no answers = cancel.
 * Choices become buttons with an "Other…" field; a question without choices gets a text field, plus yes/no buttons
 * when it is clearly a yes/no question (the model is told to send choices, this is the safety net).
 */
function ClarifyDialog({ request, onAnswer }: { request: EngineRequest; onAnswer: (r: unknown) => Promise<void> }) {
  const c = useCopy()
  const questions = ((request.params as { questions?: ClarifyQuestion[] }).questions ?? []).filter((q) => q.qid)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const set = (qid: string, v: string) => setAnswers((a) => ({ ...a, [qid]: v }))
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" data-testid="clarify-dialog">
        <h2>{c('Tomo has a question', 'Tomo 有个问题', 'Tomo からの質問')}</h2>
        {questions.map((q) => {
          const given = q.choices?.filter((x) => x.trim()) ?? []
          const buttons = given.length ? given : yesNoChoices(q.question) ?? []
          const typed = !buttons.includes(answers[q.qid] ?? '')
          return (
            <div key={q.qid} className="hatch-question" data-testid="clarify-question">
              <label>{q.question}</label>
              {buttons.length > 0 && (
                <div className="hatch-options-chips" data-testid="clarify-choices">
                  {buttons.map((ch) => <button key={ch} className={`hatch-chip-btn ${answers[q.qid] === ch ? 'selected' : ''}`} onClick={() => set(q.qid, ch)}>{ch}</button>)}
                </div>
              )}
              <input
                className="catalog-search-input clarify-other"
                data-testid="clarify-text"
                value={typed ? answers[q.qid] ?? '' : ''}
                placeholder={buttons.length ? c('Other…', '其他…', 'その他…') : ''}
                onChange={(e) => set(q.qid, e.target.value)}
              />
            </div>
          )
        })}
        <div className="modal-actions">
          <button className="secondary" onClick={() => void onAnswer({})}>{c('Skip', '跳过', 'スキップ')}</button>
          <button className="primary" disabled={questions.some((q) => !answers[q.qid]?.trim())} onClick={() => void onAnswer({ answers })}>{c('Send', '发送', '送信')}</button>
        </div>
      </div>
    </div>
  )
}
