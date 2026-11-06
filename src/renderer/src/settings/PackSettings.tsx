// Settings → School pack: the installed pack, how its updates are handled (automatic / manual), the last check, an
// update that is available or waiting for review, and what changed in the last update.
import type { AppState, PackUpdateMode } from '@shared/ipc'
import { pick } from '@shared/pack/types'
import { useCopy, useLocale } from '../i18n'
import { Icon } from '../ui/Icon'

type Run = (label: string, fn: () => Promise<unknown>, done?: string) => Promise<void>

export function PackSettings({ state, busy, run, reviewOpen, onReview }: { state: AppState; busy: string | null; run: Run; reviewOpen: boolean; onReview: (open: boolean) => void }) {
  const c = useCopy()
  const { locale } = useLocale()
  const pack = state.pack
  const u = state.packUpdate
  const time = (t?: number) => (t ? new Date(t).toLocaleString(locale === 'zh' ? 'zh-CN' : locale, { dateStyle: 'medium', timeStyle: 'short' }) : c('not yet', '尚未检查', 'まだ'))
  if (!pack) return null
  const name = pick(pack.manifest.name, locale)
  const install = () => run('pack', () => window.tomo.installPackUpdate(), c('Pack updated. It applies from your next question.', '能力包已更新，从下一个问题开始生效。', 'パックを更新しました。次の質問から反映されます。'))

  return (
    <section className="settings-section" data-testid="pack-settings">
      <h2>{c('School pack', '学校能力包', '学校パック')}</h2>
      <div className="setting-row">
        <div><strong>{name}</strong><span>{pick(pack.manifest.school.name, locale)} · v{pack.manifest.version} · {pack.manifest.publisher.name}</span></div>
      </div>
      <div className="setting-row" data-testid="pack-updates">
        <div>
          <strong>{c('Pack updates', '能力包更新', 'パックの更新')}</strong>
          <span>
            {u.mode === 'auto'
              ? c('Installed automatically (checked at start and every 6 hours). Updates that add new access wait for your OK.', '自动安装（启动时和每 6 小时检查一次）。新增访问权限的更新会先等你确认。', '自動でインストールします（起動時と 6 時間ごとに確認）。新しいアクセスを追加する更新は確認を待ちます。')
              : c('Tomo tells you when an update is available; you install it here.', '有可用更新时 Tomo 会提醒你，由你在这里安装。', '更新があるとお知らせします。インストールはここから行います。')}
            {' · '}
            {u.checking ? c('Checking…', '正在检查…', '確認中…') : c(`Last checked: ${time(u.checkedAt)}`, `上次检查：${time(u.checkedAt)}`, `最終確認：${time(u.checkedAt)}`)}
            {u.error && <><br /><span className="error-text">{c(`Could not check: ${u.error}`, `检查失败：${u.error}`, `確認できませんでした：${u.error}`)}</span></>}
          </span>
        </div>
        <div className="row-actions">
          <button className="secondary" data-testid="pack-check" disabled={u.checking || !!busy} onClick={() => void run('pack-check', () => window.tomo.checkPackUpdate())}>{c('Check now', '立即检查', '今すぐ確認')}</button>
          <select className="setting-value setting-select" data-testid="pack-update-mode" value={u.mode} onChange={(e) => void run('pack-mode', () => window.tomo.setPackUpdateMode(e.target.value as PackUpdateMode))} aria-label={c('Pack updates', '能力包更新', 'パックの更新')}>
            <option value="auto">{c('Automatic', '自动更新', '自動')}</option>
            <option value="manual">{c('Manual', '手动更新', '手動')}</option>
          </select>
        </div>
      </div>
      {u.available && (
        <div className="setting-row" data-testid="pack-available">
          <div>
            <strong>{c(`Version ${u.available.version} is available`, `可更新到 ${u.available.version}`, `バージョン ${u.available.version} に更新できます`)}</strong>
            <span>{u.available.addedAccess.length
              ? c('It adds new access, so it waits for your OK.', '它新增了访问权限，所以要等你确认。', '新しいアクセスを追加するため、確認を待っています。')
              : c('Same access as now.', '访问权限和现在一样。', 'アクセスは現在と同じです。')}</span>
          </div>
          <button className="primary" data-testid="pack-install" disabled={!!busy} onClick={() => (u.available!.addedAccess.length ? onReview(true) : void install())}>
            {u.available.addedAccess.length ? c('Review…', '查看…', '確認…') : c('Update', '更新', '更新')}
          </button>
        </div>
      )}
      {u.installed && (
        <div className="setting-row" data-testid="pack-whats-new">
          <div>
            <strong>{c(`What's new in ${u.installed.version}`, `${u.installed.version} 的更新内容`, `${u.installed.version} の更新内容`)}</strong>
            {u.installed.notes.length ? <ul className="pack-notes">{u.installed.notes.slice(0, 6).map((n) => <li key={n}>{n}</li>)}</ul> : <span>{time(u.installed.at)}</span>}
            {u.installed.hatchChanged && <span>{c('This version asks some new first-run questions.', '这个版本新增了一些首次设置问题。', 'このバージョンでは初回設定の質問が追加されました。')}</span>}
          </div>
        </div>
      )}
      {reviewOpen && u.available && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => onReview(false)}>
          <div className="modal" role="dialog" aria-modal="true" data-testid="pack-review" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon"><Icon name="shield" size={22} /></div>
            <h2>{c(`${name} ${u.available.version} adds access`, `${name} ${u.available.version} 新增了访问权限`, `${name} ${u.available.version} はアクセスを追加します`)}</h2>
            <p className="modal-intro">{c('The update is signed by tomo-packs. With it, Tomo may also use:', '此更新已由 tomo-packs 签名。更新后 Tomo 还可以使用：', 'この更新は tomo-packs により署名されています。更新すると次も利用できるようになります：')}</p>
            <ul className="pack-notes">{u.available.addedAccess.map((a) => <li key={a}><code>{a}</code></li>)}</ul>
            {u.available.notes.length > 0 && <><p className="modal-intro">{c("What's new", '更新内容', '更新内容')}</p><ul className="pack-notes">{u.available.notes.slice(0, 6).map((n) => <li key={n}>{n}</li>)}</ul></>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => onReview(false)}>{c('Not now', '暂不更新', '今はしない')}</button>
              <button className="primary" data-testid="pack-review-accept" onClick={() => { onReview(false); void install() }}>{c('Update', '更新', '更新')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
