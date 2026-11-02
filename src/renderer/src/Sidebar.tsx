import { useEffect, useRef, useState } from 'react'
import type { PackSummary, SessionRow } from '@shared/ipc'
import { pick } from '@shared/pack/types'
import { useCopy, useLocale } from './i18n'
import { Icon, isIconName } from './ui/Icon'

export type View = { kind: 'chat'; sessionId?: string; topicId?: string } | { kind: 'settings' } | { kind: 'memory' }

export function Sidebar({ view, onView, pack, sessions, titles }: {
  view: View
  onView: (v: View) => void
  pack?: PackSummary
  sessions: SessionRow[]
  titles: Record<string, string>
}) {
  const c = useCopy()
  const { locale } = useLocale()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (searchOpen) searchRef.current?.focus() }, [searchOpen])
  const title = (s: SessionRow) => titles[s.id] || s.title || c('New chat', '新对话', '新しいチャット')
  const q = query.trim().toLowerCase()
  const visible = q ? sessions.filter((s) => title(s).toLowerCase().includes(q)) : sessions
  const topics = pack?.manifest.ui?.quick_topics ?? []

  return (
    <aside className="sidebar" aria-label={c('Sidebar', '侧栏', 'サイドバー')} data-testid="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <div className="brand-mark">伴</div>
          <div className="sidebar-text">
            <strong>Tomo</strong>
            <span lang={pack ? 'ja' : undefined}>{pack ? pack.manifest.school.short : c('No school pack', '未启用学校包', 'パック未接続')}</span>
          </div>
        </div>
      </div>
      <nav className="sidebar-group" aria-label={c('Main', '主要', 'メイン')}>
        <button className="nav-item new-chat" data-testid="new-chat" onClick={() => onView({ kind: 'chat' })}>
          <Icon name="plus" />
          <span className="nav-item-label">{c('New chat', '新对话', '新しいチャット')}</span>
        </button>
        <button className={`nav-item ${view.kind === 'memory' ? 'current' : ''}`} onClick={() => onView({ kind: 'memory' })}>
          <Icon name="eye" />
          <span className="nav-item-label">{c('About you', '关于你', 'あなたについて')}</span>
        </button>
        <button className={`nav-item ${view.kind === 'settings' ? 'current' : ''}`} data-testid="nav-settings" onClick={() => onView({ kind: 'settings' })}>
          <Icon name="settings" />
          <span className="nav-item-label">{c('Settings', '设置', '設定')}</span>
        </button>
      </nav>
      {topics.length > 0 && (
        <nav className="sidebar-group" aria-label="Quick topics" data-testid="quick-topics">
          <p className="nav-label sidebar-text">
            {c('Quick topics', '快捷主题', 'クイックトピック')}
            <span className="nav-label-origin" lang="ja">{pack!.manifest.school.short}</span>
          </p>
          {topics.map((t) => (
            <button key={t.id} className={`nav-item ${view.kind === 'chat' && view.topicId === t.id && !view.sessionId ? 'current' : ''}`} onClick={() => onView({ kind: 'chat', topicId: t.id })}>
              <Icon name={isIconName(t.icon) ? t.icon : 'chat'} />
              <span className="nav-item-label">{pick(t.label, locale)}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="conversation-area">
        {searchOpen ? (
          <div className="sidebar-search" role="search">
            <Icon name="search" size={13} />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c('Search chats', '搜索对话', '会話を検索')} aria-label={c('Search chats', '搜索对话', '会話を検索')}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false) } }} onBlur={() => { if (!query) setSearchOpen(false) }} />
          </div>
        ) : (
          <div className="section-heading">
            <span>{c('Recent chats', '最近对话', '最近の会話')}</span>
            <button onClick={() => setSearchOpen(true)} aria-label={c('Search chats', '搜索对话', '会話を検索')}><Icon name="search" size={14} /></button>
          </div>
        )}
        <div className="conversation-list" data-testid="conversation-list">
          {visible.map((s) => (
            <button key={s.id} className={`conversation ${view.kind === 'chat' && view.sessionId === s.id ? 'active' : ''}`} onClick={() => onView({ kind: 'chat', sessionId: s.id })}>
              <span><span className="conversation-title">{title(s)}</span>{s.startedAt ? <small>{new Date(s.startedAt * 1000).toLocaleDateString(locale === 'zh' ? 'zh-CN' : locale)}</small> : null}</span>
            </button>
          ))}
          {q && visible.length === 0 && <p className="sidebar-search-empty">{c(`No chats match “${query.trim()}”`, `没有找到与“${query.trim()}”相关的对话`, `「${query.trim()}」に一致する会話はありません`)}</p>}
        </div>
      </div>
    </aside>
  )
}
