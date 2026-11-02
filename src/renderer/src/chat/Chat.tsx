import { useEffect, useRef, useState } from 'react'
import type { ChatEvent, PackSummary } from '@shared/ipc'
import { pick } from '@shared/pack/types'
import { StreamUnmasker, unmask } from '@shared/privacy/masker'
import { useCopy, useLocale } from '../i18n'
import { Icon, isIconName } from '../ui/Icon'
import { Markdown } from './Markdown'

export interface ToolStep { id: string; name: string; done: boolean; seconds?: number | null }
export type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; tools: ToolStep[]; streaming: boolean }
  | { role: 'error'; text: string }
  | { role: 'stopped' }

export interface ChatSession { id: string; title: string; messages: Msg[]; busy: boolean; loaded: boolean }

/** Applies one engine event to a session (pure, so it is unit-testable). */
export function applyEvent(s: ChatSession, e: ChatEvent, unmasker: StreamUnmasker, values: Record<string, string>): ChatSession {
  const msgs = [...s.messages]
  const lastIdx = msgs.length - 1
  const last = msgs[lastIdx]
  const current = last && last.role === 'assistant' && last.streaming ? { ...last, tools: [...last.tools] } : null
  const ensure = () => {
    if (current) return current
    const fresh = { role: 'assistant' as const, text: '', tools: [] as ToolStep[], streaming: true }
    msgs.push(fresh)
    return fresh
  }
  switch (e.kind) {
    case 'title':
      return { ...s, title: unmask(e.title, values) }
    case 'delta': {
      const m = ensure()
      m.text += unmasker.push(e.text)
      break
    }
    case 'tool.start': {
      const m = ensure()
      m.tools.push({ id: e.toolId, name: e.name, done: false })
      break
    }
    case 'tool.complete': {
      const m = ensure()
      m.tools = m.tools.map((t) => (t.id === e.toolId ? { ...t, done: true, seconds: e.durationS } : t))
      break
    }
    case 'complete': {
      const m = ensure()
      m.text += unmasker.flush()
      if (!m.text.trim() && e.text) m.text = unmask(e.text, values)
      m.streaming = false
      if (e.status === 'error' || e.error) msgs.push({ role: 'error', text: unmask(e.error ?? 'The AI provider returned an error.', values) })
      if (e.status === 'interrupted') msgs.push({ role: 'stopped' })
      if (current) msgs[lastIdx] = m
      return { ...s, messages: msgs, busy: false }
    }
    case 'error':
      msgs.push({ role: 'error', text: unmask(e.message, values) })
      return { ...s, messages: msgs, busy: false }
    default:
      return s
  }
  if (current) msgs[lastIdx] = current
  return { ...s, messages: msgs }
}

export function Chat({ session, topicId, pack, values, onSend, onStop, modelLabel, onOpenModel }: {
  session?: ChatSession
  topicId?: string
  pack?: PackSummary
  values: Record<string, string>
  onSend: (text: string) => void
  onStop: () => void
  modelLabel: string
  onOpenModel: () => void
}) {
  const c = useCopy()
  const { locale } = useLocale()
  const [message, setMessage] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const topic = pack?.manifest.ui?.quick_topics?.find((q) => q.id === topicId)
  const busy = session?.busy ?? false
  const title = session?.title || (topic ? pick(topic.label, locale) : c('New chat', '新对话', '新しいチャット'))

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [session?.messages])

  const send = () => {
    const text = message.trim()
    if (!text || busy) return
    setMessage('')
    onSend(text)
  }

  const toolLabel = (name: string) => {
    if (name.startsWith('browser_')) return c('Browser', '浏览器', 'ブラウザ')
    if (name === 'skill_view' || name === 'skills_list') return c('Reading a skill', '读取技能', 'スキルを確認')
    if (name.startsWith('web_')) return c('Web search', '网页搜索', 'Web 検索')
    if (name === 'memory') return c('Memory', '记忆', 'メモリー')
    return name
  }

  return (
    <main className="main" data-testid="chat">
      <header className="topbar">
        <div>
          <h1 data-testid="chat-title">{title}</h1>
          <span><i></i> {pack ? pick(pack.manifest.name, locale) : c('Tomo core', 'Tomo 基础', 'Tomoコア')}</span>
        </div>
      </header>
      <div className="chat-scroll" ref={scrollRef}>
        {!session?.messages.length && topic && (
          <div className="topic-empty">
            <div className="topic-icon"><Icon name={isIconName(topic.icon) ? topic.icon : 'chat'} size={24} /></div>
            <h2>{pick(topic.label, locale)}</h2>
            <p>{pick(topic.description, locale)}</p>
            <span className="suggestion-label">{c('Suggested questions', '推荐问题', 'おすすめの質問')}</span>
            <div className="prompt-chips">
              {topic.prompts.map((p) => (
                <button key={p.en} onClick={() => setMessage(pick(p, locale))}>
                  <Icon name="book" size={14} />
                  <span>{pick(p, locale)}</span>
                  <Icon name="chevron" size={13} />
                </button>
              ))}
            </div>
          </div>
        )}
        {!session?.messages.length && !topic && (
          <div className="topic-empty">
            <div className="topic-icon"><span className="brand-mark">伴</span></div>
            <h2>{c('What can I help with?', '有什么可以帮你？', '何をお手伝いしましょうか？')}</h2>
            <p>{c('Ask about courses, school rules, procedures or Japanese.', '可以问课程、校规、手续或日语相关的问题。', '科目、学校の規則、手続き、日本語について質問できます。')}</p>
          </div>
        )}
        {session?.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="sent-turn"><div className="user-message new-message" data-testid="user-message">{m.text}</div></div>
          ) : m.role === 'assistant' ? (
            <div key={i} className="assistant-message" data-testid="assistant-message">
              <div className="assistant-avatar"><span>伴</span></div>
              <div className="answer">
                {m.tools.length > 0 && (
                  <details className="tool-summary" data-testid="tool-steps">
                    <summary>
                      {m.tools.every((t) => t.done) ? <Icon name="check" size={14} /> : <span className="spinner" />}
                      {m.tools.map((t) => toolLabel(t.name)).filter((v, j, a) => a.indexOf(v) === j).join(' · ')}
                      {' · '}{c(`${m.tools.length} steps`, `${m.tools.length} 个步骤`, `${m.tools.length} ステップ`)}
                      <Icon name="chevron" size={13} />
                    </summary>
                    <ul>{m.tools.map((t) => <li key={t.id}><code>{t.name}</code>{t.seconds != null ? ` · ${t.seconds.toFixed(1)} s` : ''}</li>)}</ul>
                  </details>
                )}
                {m.text ? <div className="answer-body" data-testid="answer-text"><Markdown text={m.text} /></div> : m.streaming ? <p className="working-text">{c('Thinking…', '思考中…', '考えています…')}</p> : null}
              </div>
            </div>
          ) : m.role === 'error' ? (
            <div key={i} className="allowance-alert-card" role="alert" data-testid="chat-error"><p>{m.text}</p></div>
          ) : (
            <p key={i} className="turn-stopped">{c('Stopped', '已停止', '停止しました')}</p>
          ),
        )}
      </div>
      <div className="composer-wrap">
        <div className={`composer ${busy ? 'lg-busy' : ''}`}>
          <textarea
            data-testid="composer"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
            }}
            placeholder={pack ? c(`Ask Tomo about ${pack.manifest.school.name.en}…`, `向 Tomo 询问 ${pack.manifest.school.name.zh} 的问题…`, `${pack.manifest.school.name.ja}について Tomo に質問…`) : c('Ask Tomo…', '问 Tomo…', 'Tomo に質問…')}
            rows={2}
          />
          <div className="composer-tools">
            <div>
              <span title={Object.keys(values).map((k) => `{{${k}}}`).join(', ')}><Icon name="lock" size={12} /> {c('Personal data protection is on', '个人数据保护已开启', '個人データ保護オン')}</span>
              <button className="model-chip" onClick={onOpenModel} title={c('Model & usage', '模型与用量', 'モデルと利用状況')}>{modelLabel}</button>
            </div>
            {busy ? (
              <button className="send-button stop" data-testid="stop" onClick={onStop} aria-label={c('Stop', '停止', '停止')}><Icon name="stop" size={16} /></button>
            ) : (
              <button className="send-button" data-testid="send" disabled={!message.trim()} onClick={send} aria-label={c('Send', '发送', '送信')}><Icon name="send" size={18} /></button>
            )}
          </div>
        </div>
        <p className="disclaimer">{c('Tomo can make mistakes. Check important university information.', 'Tomo 可能会出错，请核对重要的校务信息。', 'Tomo は間違えることがあります。大切な情報は大学の公式情報で確認してください。')}</p>
      </div>
    </main>
  )
}
