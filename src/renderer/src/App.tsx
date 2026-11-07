import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, EngineRequest, MigrationState, Prefs, SessionRow, UpdateStatus } from '@shared/ipc'
import { pick } from '@shared/pack/types'
import { StreamUnmasker } from '@shared/privacy/masker'
import { applyEvent, Chat, type ChatSession } from './chat/Chat'
import { RequestDialog } from './chat/RequestDialog'
import { htmlLang, LocaleContext, type Locale } from './i18n'
import { Memory } from './settings/Memory'
import { Settings } from './settings/Settings'
import { MigrationScreen } from './setup/Migration'
import { UnlockScreen } from './setup/Portable'
import { Setup } from './setup/Setup'
import { Sidebar, type View } from './Sidebar'
import { Banner, bannerKey, type BannerNotice } from './ui/Banner'
import { ScaleRoot } from './ui/scale'

const APP_NAME = 'Tomo（伴）'

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [locale, setLocaleState] = useState<Locale>('en')
  const [view, setView] = useState<View>({ kind: 'chat' })
  const [sessions, setSessions] = useState<Record<string, ChatSession>>({})
  const [rows, setRows] = useState<SessionRow[]>([])
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => { void window.tomo.updateStatus().then(setUpdate); return window.tomo.onUpdateStatus(setUpdate) }, [])
  const [packReview, setPackReview] = useState(false)
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

  // initial load: main's default is the OS language until the student picks one
  useEffect(() => {
    void refresh().then((s) => setLocaleState(s.prefs.locale))
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
  useEffect(() => window.tomo.onPackUpdate(() => void refresh()), [refresh])
  // the migration after an update: live progress; the chat opens when it is done
  const [migration, setMigration] = useState<MigrationState | null>(null)
  useEffect(() => window.tomo.onMigration((m) => {
    // finished: show "Update finished" for a moment, then the chat
    if (!m.active && m.tasks.start === 'done' && !m.error) {
      setMigration({ ...m, active: true })
      setTimeout(() => { setMigration(m); void refresh() }, 1200)
    } else {
      setMigration(m)
      if (!m.active) void refresh()
    }
  }), [refresh])
  useEffect(() => window.tomo.onNavigate((page) => setView({ kind: page })), [])
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

  // one banner at a time: a ready app update first, then a pack update waiting for review, then pack news
  const pu = state?.packUpdate
  const packName = state?.pack ? pick(state.pack.manifest.name, locale) : ''
  const notice: BannerNotice | null =
    update?.state === 'ready' && update.available ? { kind: 'app-ready', version: update.available }
      : update?.state === 'portable-available' && update.available ? { kind: 'app-portable', version: update.available }
      : pu?.available && state?.pack ? { kind: pu.available.addedAccess.length ? 'pack-review' : 'pack-available', name: packName, version: pu.available.version }
        : pu?.installed && state?.pack ? { kind: 'pack-updated', name: packName, version: pu.installed.version }
          : null
  const onBanner = () => {
    if (!notice) return
    if (notice.kind === 'app-ready' || notice.kind === 'app-portable') return void window.tomo.installUpdate()
    if (notice.kind === 'pack-available') return void window.tomo.installPackUpdate().then(refresh)
    setDismissed(bannerKey(notice))
    setView({ kind: 'settings' })
    if (notice.kind === 'pack-review') setPackReview(true)
  }

  if (!state) return null
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <ScaleRoot scale={state.prefs.uiScale}>
        {(migration ?? state.migration).active ? (
          <MigrationScreen m={migration ?? state.migration} />
        ) : state.portable.enabled && state.portable.hasPassword && !state.portable.unlocked ? (
          <UnlockScreen onUnlocked={() => void refresh()} />
        ) : !state.setupDone || state.hatchPending ? (
          <Setup state={state} refresh={refresh} onDone={() => void refresh()} />
        ) : (
          <div className="app-shell page-mode">
            <Sidebar view={view} onView={setView} pack={state.pack} sessions={rows} titles={titles} />
            <div className="main-column">
            {notice && bannerKey(notice) !== dismissed && <Banner notice={notice} onAction={onBanner} onDismiss={() => setDismissed(bannerKey(notice))} />}
            {view.kind === 'settings' ? (
              <Settings state={state} refresh={refresh} onPrefs={(p) => void setPrefs(p)} packReview={packReview} onPackReview={setPackReview} />
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
          </div>
        )}
        {requests[0] && <RequestDialog request={requests[0]} values={values} onDone={() => setRequests((q) => q.slice(1))} />}
      </ScaleRoot>
    </LocaleContext.Provider>
  )
}
