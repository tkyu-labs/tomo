import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, EngineRequest, Prefs, SessionRow } from '@shared/ipc'
import { StreamUnmasker } from '@shared/privacy/masker'
import { applyEvent, Chat, type ChatSession } from './chat/Chat'
import { RequestDialog } from './chat/RequestDialog'
import { htmlLang, LocaleContext, systemLocale, type Locale } from './i18n'
import { Memory } from './settings/Memory'
import { Settings } from './settings/Settings'
import { Setup } from './setup/Setup'
import { Sidebar, type View } from './Sidebar'
import { ScaleRoot } from './ui/scale'

const APP_NAME = 'Tomo（伴）'

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [locale, setLocaleState] = useState<Locale>('en')
  const [view, setView] = useState<View>({ kind: 'chat' })
  const [sessions, setSessions] = useState<Record<string, ChatSession>>({})
  const [rows, setRows] = useState<SessionRow[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [requests, setRequests] = useState<EngineRequest[]>([])
  const unmaskers = useRef(new Map<string, StreamUnmasker>())
  const valuesRef = useRef(values)
  valuesRef.current = values

  const refresh = useCallback(async () => {
    const s = await window.tomo.getState()
    setState(s)
    return s
  }, [])

  // initial load: locale defaults to the OS language until the student picks one
  useEffect(() => {
    void refresh().then((s) => {
      const first = !s.setupDone && s.prefs.locale === 'en' ? systemLocale() : s.prefs.locale
      setLocaleState(first)
    })
  }, [refresh])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    void window.tomo.setPrefs({ locale: l })
  }, [])
  const setPrefs = useCallback(async (p: Partial<Prefs>) => {
    await window.tomo.setPrefs(p)
    await refresh()
  }, [refresh])

  useEffect(() => { document.documentElement.lang = htmlLang(locale) }, [locale])
  useEffect(() => { void window.tomo.appInfo().then((i) => { document.documentElement.dataset.platform = i.platform }) }, [])
  useEffect(() => { if (state) document.documentElement.dataset.theme = state.prefs.theme }, [state])

  const ready = state?.setupDone && state.engine.state === 'ready'
  const loadRows = useCallback(() => { void window.tomo.listSessions().then(setRows).catch(() => undefined) }, [])
  useEffect(() => {
    if (!ready) return
    void window.tomo.displayValues().then(setValues)
    loadRows()
  }, [ready, loadRows])

  useEffect(() => window.tomo.onEngineState(() => void refresh()), [refresh])
  useEffect(() => window.tomo.onEngineRequest((r) => setRequests((q) => [...q, r])), [])
  useEffect(() => window.tomo.onChatEvent((sessionId, e) => {
    let u = unmaskers.current.get(sessionId)
    if (!u) { u = new StreamUnmasker(valuesRef.current); unmaskers.current.set(sessionId, u) }
    const unm = u
    setSessions((all) => {
      const s = all[sessionId] ?? { id: sessionId, title: '', messages: [], busy: true, loaded: true }
      return { ...all, [sessionId]: applyEvent(s, e, unm, valuesRef.current) }
    })
    if (e.kind === 'complete' || e.kind === 'title') { unmaskers.current.delete(sessionId); if (e.kind === 'title') loadRows() }
  }), [loadRows])

  // open a stored chat: load its history once
  useEffect(() => {
    if (view.kind !== 'chat' || !view.sessionId || sessions[view.sessionId]?.loaded) return
    const id = view.sessionId
    void window.tomo.history(id).then((msgs) => {
      const row = rows.find((r) => r.id === id)
      setSessions((all) => ({
        ...all,
        [id]: {
          id, title: row?.title ?? '', busy: false, loaded: true,
          messages: msgs.filter((m) => m.role !== 'tool').map((m) => m.role === 'user' ? { role: 'user' as const, text: m.text } : { role: 'assistant' as const, text: m.text, tools: [], streaming: false }),
        },
      }))
    })
  }, [view, sessions, rows])

  const current = view.kind === 'chat' && view.sessionId ? sessions[view.sessionId] : undefined

  // window title: "{chat} — Tomo（伴）" (macOS) / "{chat} - Tomo（伴）" (Windows), plain app name otherwise
  useEffect(() => {
    const sep = navigator.userAgent.includes('Windows') ? ' - ' : ' — '
    const t = current?.title
    document.title = t ? `${t}${sep}${APP_NAME}` : APP_NAME
  }, [current?.title])

  const send = async (text: string, topic?: string) => {
    let id = view.kind === 'chat' ? view.sessionId : undefined
    if (!id) {
      id = await window.tomo.createSession()
      setView({ kind: 'chat', sessionId: id, topicId: view.kind === 'chat' ? view.topicId : undefined })
    }
    const sid = id
    unmaskers.current.set(sid, new StreamUnmasker(valuesRef.current))
    setSessions((all) => {
      const s = all[sid] ?? { id: sid, title: '', messages: [], busy: false, loaded: true }
      return { ...all, [sid]: { ...s, busy: true, messages: [...s.messages, { role: 'user', text }, { role: 'assistant', text: '', tools: [], streaming: true }] } }
    })
    try {
      await window.tomo.send(sid, text, topic)
      loadRows()
    } catch (e) {
      setSessions((all) => ({ ...all, [sid]: { ...all[sid]!, busy: false, messages: [...all[sid]!.messages, { role: 'error', text: e instanceof Error ? e.message : String(e) }] } }))
    }
  }

  const titles = useMemo(() => Object.fromEntries(Object.values(sessions).filter((s) => s.title).map((s) => [s.id, s.title])), [sessions])

  if (!state) return null
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <ScaleRoot scale={state.prefs.uiScale}>
        {!state.setupDone ? (
          <Setup state={state} refresh={refresh} onDone={() => void refresh()} />
        ) : (
          <div className="app-shell page-mode">
            <Sidebar view={view} onView={setView} pack={state.pack} sessions={rows} titles={titles} />
            {view.kind === 'settings' ? (
              <Settings state={state} refresh={refresh} onPrefs={(p) => void setPrefs(p)} />
            ) : view.kind === 'memory' ? (
              <Memory values={values} />
            ) : (
              <Chat
                key={view.sessionId ?? `new-${view.topicId ?? ''}`}
                session={current}
                topicId={view.topicId}
                pack={state.pack}
                values={values}
                onSend={(t, topic) => void send(t, topic)}
                onStop={() => view.sessionId && void window.tomo.interrupt(view.sessionId)}
                modelLabel={state.provider?.model ?? ''}
                onOpenModel={() => setView({ kind: 'settings' })}
              />
            )}
          </div>
        )}
        {requests[0] && <RequestDialog request={requests[0]} values={values} onDone={() => setRequests((q) => q.slice(1))} />}
      </ScaleRoot>
    </LocaleContext.Provider>
  )
}
