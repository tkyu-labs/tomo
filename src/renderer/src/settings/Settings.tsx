import { useEffect, useState } from 'react'
import type { AppState, Prefs, UpdateStatus } from '@shared/ipc'
import { useCopy, useLocale, type Locale } from '../i18n'
import { ModelSettings } from './ModelSettings'
import { PackSettings } from './PackSettings'
import { ChangePasswordSheet } from '../setup/Portable'

const SCALES = [0.8, 0.9, 1, 1.1, 1.25]

export function Settings({ state, refresh, onPrefs, packReview, onPackReview }: { state: AppState; refresh: () => Promise<AppState>; onPrefs: (p: Partial<Prefs>) => void; packReview: boolean; onPackReview: (open: boolean) => void }) {
  const c = useCopy()
  const { locale, setLocale } = useLocale()
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<'chats' | 'everything' | null>(null)
  const [changePassword, setChangePassword] = useState(false)
  const ready = state.engine.state === 'ready'
  const mac = document.documentElement.dataset.platform === 'darwin'
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  useEffect(() => { void window.tomo.updateStatus().then(setUpdate); return window.tomo.onUpdateStatus(setUpdate) }, [])

  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label)
    setNotice(null)
    try { await fn(); if (done) setNotice(done); await refresh() } catch (e) { setNotice(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <main className="standalone-page product-page" data-testid="settings">
      <header className="page-header">
        <div>
          <span>{c('PREFERENCES', '偏好设置', '環境設定')}</span>
          <h1>{c('Settings', '设置', '設定')}</h1>
          <p>{c('Language, AI model, privacy and the AI engine.', '语言、AI 模型、隐私与 AI 引擎。', '言語、AI モデル、プライバシー、AI エンジン。')}</p>
        </div>
      </header>
      <div className="page-body settings-layout">
        {notice && <p className="hatch-note" role="status">{notice}</p>}
        <section className="settings-section">
          <h2>{c('Appearance & language', '外观与语言', '表示と言語')}</h2>
          <div className="setting-row">
            <div><strong>{c('App language', '应用语言', 'アプリの言語')}</strong><span>English · 简体中文 · 日本語</span></div>
            <select className="setting-value setting-select" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={c('App language', '应用语言', 'アプリの言語')}>
              <option value="en">English</option><option value="zh">简体中文</option><option value="ja">日本語</option>
            </select>
          </div>
          <div className="setting-row">
            <div><strong>{c('Theme', '主题', 'テーマ')}</strong><span>{state.prefs.theme === 'dark' ? c('Dark', '深色', 'ダーク') : c('Light', '浅色', 'ライト')}</span></div>
            <button className="setting-value" onClick={() => onPrefs({ theme: state.prefs.theme === 'dark' ? 'light' : 'dark' })}>{state.prefs.theme === 'dark' ? c('Dark', '深色', 'ダーク') : c('Light', '浅色', 'ライト')}</button>
          </div>
          <div className="setting-row">
            <div><strong>{c('Interface size', '界面大小', '表示サイズ')}</strong><span>{c('Automatic shrinks the UI on small screens', '自动：小屏幕上自动缩小', '自動：小さい画面では縮小')}</span></div>
            <select className="setting-value setting-select" value={String(state.prefs.uiScale)} onChange={(e) => onPrefs({ uiScale: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })} aria-label={c('Interface size', '界面大小', '表示サイズ')}>
              <option value="auto">{c('Automatic', '自动', '自動')}</option>
              {SCALES.map((z) => <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>)}
            </select>
          </div>
        </section>

        <section className="settings-section" data-testid="window-settings">
          <h2>{c('Window', '窗口', 'ウィンドウ')}</h2>
          <div className="setting-row">
            <div>
              <strong>{c('When you close the window', '关闭主窗口时', 'ウィンドウを閉じたとき')}</strong>
              <span data-testid="close-action-note">
                {state.prefs.closeAction === 'quit'
                  ? c('Closing the window quits Tomo and its AI engine. Reminders pause until you open Tomo again; a running task asks before it stops.', '关闭窗口即退出 Tomo 及其 AI 引擎。再次打开 Tomo 前提醒会暂停；有任务进行中时会先询问。', 'ウィンドウを閉じると Tomo と AI エンジンを終了します。次に開くまでリマインダーは止まります。作業中のときは先に確認します。')
                  : mac
                    ? c('Tomo keeps running in the menu bar: reminders and running tasks continue. Quit with ⌘Q or from the 伴 icon.', 'Tomo 在菜单栏继续运行：提醒和进行中的任务不中断。用 ⌘Q 或菜单栏的「伴」图标退出。', 'Tomo はメニューバーで動き続け、リマインダーや実行中の作業も続きます。終了は ⌘Q かメニューバーの「伴」アイコンから。')
                    : c('Tomo keeps running in the notification area: reminders and running tasks continue. Quit from the Tomo icon there.', 'Tomo 在通知区域继续运行：提醒和进行中的任务不中断。要退出，请从通知区域的 Tomo 图标选择退出。', 'Tomo は通知領域で動き続け、リマインダーや実行中の作業も続きます。終了は通知領域の Tomo アイコンから。')}
              </span>
            </div>
            <select className="setting-value setting-select" data-testid="close-action" value={state.prefs.closeAction} onChange={(e) => onPrefs({ closeAction: e.target.value === 'quit' ? 'quit' : 'tray' })} aria-label={c('When you close the window', '关闭主窗口时', 'ウィンドウを閉じたとき')}>
              <option value="tray">{mac ? c('Keep running in the menu bar', '缩到菜单栏继续运行', 'メニューバーで動作を続ける') : c('Keep running in the notification area', '缩到通知区域继续运行', '通知領域で動作を続ける')}</option>
              <option value="quit">{c('Quit Tomo', '退出 Tomo', 'Tomo を終了')}</option>
            </select>
          </div>
        </section>

        <ModelSettings state={state} busy={busy} run={run} />

        <PackSettings state={state} busy={busy} run={run} reviewOpen={packReview} onReview={onPackReview} />

        <section className="settings-section">
          <h2>{c('Privacy & data', '隐私与数据', 'プライバシーとデータ')}</h2>
          {state.personalConsent && (
            <div className="setting-row" data-testid="personal-consent">
              <div><strong>{c('Read my grades and records', '读取我的成绩和记录', '成績と記録の読み取り')}</strong><span>{c("On your school's portal, in the browser window you can see, when a question needs them. Names and student numbers stay placeholders.", '在需要时，于你看得见的浏览器窗口里读取学校门户上的内容。姓名和学号始终是占位符。', '質問に必要なときだけ、見えるブラウザで学校のポータルを読みます。氏名と学籍番号はプレースホルダーのままです。')}</span></div>
              <select className="setting-value setting-select" data-testid="personal-consent-select" disabled={!!busy} value={state.personalConsent}
                onChange={(e) => void run('consent', () => window.tomo.setPersonalConsent(e.target.value === 'granted'), c('Saved', '已保存', '保存しました'))}>
                {state.personalConsent === 'ask' && <option value="ask">{c('Ask me the first time', '第一次需要时问我', '最初に必要なときに確認')}</option>}
                <option value="granted">{c('Allowed', '允许', '許可')}</option>
                <option value="refused">{c('Not allowed', '不允许', '許可しない')}</option>
              </select>
            </div>
          )}
          <div className="setting-row">
            <div><strong>{c('Export your data', '导出数据', 'データを書き出す')}</strong><span>{c('Settings, what Tomo remembers and your chat list. Keys and identifiers are not included.', '设置、Tomo 记住的内容和对话列表。不含 Key 和身份信息。', '設定、Tomo の記憶、チャット一覧。キーと識別子は含みません。')}</span></div>
            <button className="secondary" disabled={!!busy} onClick={() => void run('export', async () => { const p = await window.tomo.exportData(); if (p) setNotice(c(`Saved to ${p}`, `已保存到 ${p}`, `${p} に保存しました`)) })}>{c('Export…', '导出…', '書き出す…')}</button>
          </div>
          {state.portable.enabled && (
            <div className="setting-row" data-testid="portable-password">
              <div><strong>{c('Password', '密码', 'パスワード')}</strong><span>{c("Tomo Portable encrypts your keys and identifiers with this password instead of Windows' own protection, and asks for it at every start.", 'Tomo Portable 用这个密码代替 Windows 自带的加密来保护你的 Key 和身份信息，每次启动时都会询问。', 'Tomo Portable は Windows の保護の代わりにこのパスワードでキーと識別情報を暗号化し、起動のたびに入力を求めます。')}</span></div>
              <button className="secondary" data-testid="change-password-open" onClick={() => setChangePassword(true)}>{c('Change password…', '修改密码…', 'パスワードを変更…')}</button>
            </div>
          )}
          <div className="setting-row">
            <div><strong>{c('Delete chats', '删除对话', 'チャットを削除')}</strong><span>{c('Removes every conversation from this computer.', '从这台电脑删除所有对话。', 'このコンピューターからすべての会話を削除します。')}</span></div>
            <button className="danger-button" onClick={() => setConfirmDelete('chats')}>{c('Delete…', '删除…', '削除…')}</button>
          </div>
          <div className="setting-row">
            <div><strong>{c('Delete everything', '删除全部数据', 'すべて削除')}</strong><span>{c('Keys, your profile, chats and the school pack. Tomo starts again from the first-run setup.', 'Key、个人资料、对话和学校能力包。Tomo 会回到初始设置。', 'キー、プロフィール、チャット、学校パック。Tomo は初回設定からやり直します。')}</span></div>
            <button className="danger-button" onClick={() => setConfirmDelete('everything')}>{c('Delete…', '删除…', '削除…')}</button>
          </div>
        </section>

        <section className="settings-section" data-testid="study">
          <h2>{c('User study', '用户实验', 'ユーザー調査')}</h2>
          <div className="setting-row">
            <div><strong>{c('Answer mode', '回答模式', '回答モード')}</strong><span>{c('Set by the study operator. Information chain shows where the answer is and leaves the last step to you.', '由实验负责人设置。“信息链”会告诉你答案在哪里、怎么找，最后一步由你完成。', '調査担当者が設定します。「情報チェーン」は答えの場所と調べ方を示し、最後の一歩はあなたに任せます。')}</span></div>
            <div className="segmented" role="radiogroup" aria-label={c('Answer mode', '回答模式', '回答モード')}>
              {([['direct', c('Direct answer', '直接回答', '直接回答')], ['chain', c('Information chain', '信息链', '情報チェーン')]] as const).map(([v, label]) => (
                <button key={v} role="radio" data-testid={`mode-${v}`} aria-checked={state.answerMode === v} className={state.answerMode === v ? 'active' : ''} onClick={() => void run('mode', () => window.tomo.setAnswerMode(v))}>{label}</button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div><strong>{c('Study log', '实验日志', '調査ログ')}</strong><span>{c('Answer mode, topic, tool calls, cards and times per question. No message text; stays on this computer until you export it.', '每个问题的回答模式、主题、工具调用、卡片和时间。不含消息内容；导出前只保存在这台电脑上。', '質問ごとの回答モード、トピック、ツール呼び出し、カード、時刻。メッセージ本文は含まず、書き出すまでこの端末に保存されます。')}</span></div>
            <button className="secondary" disabled={!!busy} onClick={() => void run('study', async () => { const r = await window.tomo.exportStudyLog(); if (r) setNotice(c(`${r.records} records saved to ${r.path}`, `已保存 ${r.records} 条记录到 ${r.path}`, `${r.records} 件を ${r.path} に保存しました`)) })}>{c('Export…', '导出…', '書き出す…')}</button>
          </div>
        </section>

        <section className="settings-section" data-testid="about">
          <h2>{c('About', '关于', 'このアプリについて')}</h2>
          <div className="setting-row" data-testid="updates">
            <div>
              <strong>Tomo {update?.current ?? ''}</strong>
              <span>
                {!update || update.state === 'idle' ? c('Updates are installed automatically when Tomo quits.', '更新会在 Tomo 退出时自动安装。', '更新は Tomo の終了時に自動でインストールされます。')
                  : update.state === 'checking' ? c('Checking for updates…', '正在检查更新…', '更新を確認しています…')
                  : update.state === 'up-to-date' ? c('Tomo is up to date.', 'Tomo 已是最新版本。', 'Tomo は最新です。')
                  : update.state === 'downloading' ? c(`Downloading ${update.available ?? ''}… ${update.percent ?? 0}%`, `正在下载 ${update.available ?? ''}… ${update.percent ?? 0}%`, `${update.available ?? ''} をダウンロード中… ${update.percent ?? 0}%`)
                  : update.state === 'ready' ? c(`Version ${update.available} is ready and installs when Tomo quits.`, `新版本 ${update.available} 已下载，Tomo 退出时安装。`, `バージョン ${update.available} の準備ができました。終了時にインストールされます。`)
                  : update.state === 'portable-available' ? c(`Version ${update.available} is available. Portable builds are updated by replacing the App folder.`, `新版本 ${update.available} 已发布。便携版要替换 App 文件夹来更新。`, `バージョン ${update.available} が公開されました。ポータブル版は App フォルダーを置き換えて更新します。`)
                  : c(`Update check failed: ${update.error}`, `检查更新失败：${update.error}`, `更新の確認に失敗しました：${update.error}`)}
              </span>
            </div>
            {update?.state === 'ready' || update?.state === 'portable-available'
              ? <button className="primary" onClick={() => void window.tomo.installUpdate()}>{update.state === 'ready' ? c('Restart now', '立即重启', '今すぐ再起動') : c('Download…', '下载…', 'ダウンロード…')}</button>
              : <button className="secondary" disabled={update?.state === 'checking' || update?.state === 'downloading'} onClick={() => void window.tomo.checkForUpdates()}>{c('Check now', '立即检查', '今すぐ確認')}</button>}
          </div>
          <div className="setting-row">
            <div><strong>{c('AI engine', 'AI 引擎', 'AI エンジン')}</strong><span className="engine-line" data-testid="engine-line">Hermes Agent {state.engine.version} · <span className={`status-dot ${ready ? 'ok' : ''}`} />{{
              ready: c('Running', '运行中', '実行中'), starting: c('Starting…', '正在启动…', '起動中…'),
              stopped: c('Stopped', '已停止', '停止中'), crashed: c('Stopped unexpectedly', '意外停止', '予期せず停止しました'),
            }[state.engine.state]}</span></div>
            <div className="row-actions">
              <button className="secondary" onClick={() => void window.tomo.diagnostics().then((d) => navigator.clipboard?.writeText(d))}>{c('Copy diagnostics', '复制诊断信息', '診断情報をコピー')}</button>
              <button className="secondary" disabled={!!busy} onClick={() => void run('restart', () => window.tomo.restartEngine(), c('Engine restarted', 'AI 引擎已重启', 'AI エンジンを再起動しました'))}>{c('Restart', '重启', '再起動')}</button>
            </div>
          </div>
        </section>
      </div>
      {changePassword && <ChangePasswordSheet onClose={() => setChangePassword(false)} onChanged={() => setNotice(c('Password changed.', '密码已修改。', 'パスワードを変更しました。'))} />}
      {confirmDelete && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmDelete(null)}>
          <div className="modal" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <h2>{confirmDelete === 'chats' ? c('Delete all chats?', '删除所有对话？', 'すべてのチャットを削除しますか？') : c('Delete everything?', '删除全部数据？', 'すべて削除しますか？')}</h2>
            <p className="modal-intro">{c('This cannot be undone.', '此操作无法撤销。', '元に戻せません。')}</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setConfirmDelete(null)}>{c('Cancel', '取消', 'キャンセル')}</button>
              <button className="danger-button" onClick={() => { const scope = confirmDelete; setConfirmDelete(null); void run('delete', async () => { await window.tomo.deleteData(scope); if (scope === 'everything') location.reload() }) }}>{c('Delete', '删除', '削除')}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
