// The first start after an update that needs it (src/main/app/controller.ts migrate): a new engine next to the old
// one, new tools, the data format, then the engine starts. A failure brings the previous engine back; the student can
// retry or keep using Tomo with it.
import type { MigrationState, MigrationTask } from '@shared/ipc'
import { useCopy } from '../i18n'
import { Icon } from '../ui/Icon'

const TASKS: MigrationTask[] = ['engine', 'tools', 'data', 'start']

export function MigrationScreen({ m }: { m: MigrationState }) {
  const c = useCopy()
  const done = TASKS.every((t) => m.tasks[t] === 'done')
  const failed = TASKS.find((t) => m.tasks[t] === 'error')
  const overall = Math.round((TASKS.filter((t) => m.tasks[t] === 'done').length * 100 + (m.tasks.engine === 'running' ? m.percent : 0)) / TASKS.length)
  const ver = m.engine ? `Hermes ${m.engine.from ?? '?'} → ${m.engine.to}` : 'Hermes'
  const label: Record<MigrationTask, [string, string]> = {
    engine: [c('Update the AI engine', '更新 AI 引擎', 'AI エンジンを更新'), m.tasks.engine === 'running' ? `${ver} · ${m.percent}%` : c(`${ver} in Tomo's folder`, `${ver} · 位于 Tomo 文件夹`, `${ver} · Tomo のフォルダー`)],
    tools: [c('Install new tools', '安装新工具', '新しいツールをインストール'), c('Browser runtime and search for the new version', '新版本需要的浏览器运行环境和搜索组件', '新しいバージョンのブラウザー実行環境と検索')],
    data: [c('Update your data', '更新你的数据', 'データを更新'), c('Settings and memory move to the new format; nothing is deleted', '设置和记忆转为新格式，不会删除任何内容', '設定と記憶を新しい形式に移します。何も削除しません')],
    start: [c('Start the AI engine', '启动 AI 引擎', 'AI エンジンを起動'), m.tasks.start === 'error'
      ? (m.rolledBack ? c('The new engine did not start. Tomo keeps using the previous one until this works.', '新引擎未能启动。在修复之前，Tomo 会继续使用之前的版本。', '新しいエンジンを起動できませんでした。解決するまで以前のバージョンを使います。') : c('The engine did not start.', 'AI 引擎未能启动。', 'AI エンジンを起動できませんでした。'))
      : c('Runs on this computer, no network port', '在本机运行，不占用网络端口', 'このコンピューターで動作し、ネットワークポートは使いません')],
  }
  return (
    <main className="standalone-page onboarding-page migration-page" data-testid="migration">
      <div className="hatch-shell">
        <div className="hatch-brand"><div className="brand-mark">伴</div><strong>Tomo</strong></div>
        <div className="setup-card">
          {m.app && <span className="eyebrow">{m.app.from ? `Tomo ${m.app.from} → ${m.app.to}` : `Tomo ${m.app.to}`}</span>}
          <h1>{done ? c('Update finished', '更新完成', '更新が完了しました') : failed ? c('The update could not finish', '更新没能完成', '更新を完了できませんでした') : c('Finishing the update', '正在完成更新', '更新を仕上げています')}</h1>
          <p>{failed
            ? c('Your chats, settings and keys are safe. Try again, or copy the diagnostics for help.', '你的对话、设置和 Key 都完好无损。可以重试，或复制诊断信息寻求帮助。', '会話・設定・キーはそのままです。再試行するか、診断情報をコピーして問い合わせてください。')
            : c('This version needs a few changes on this computer. It takes about a minute; please keep Tomo open.', '这个版本需要在这台电脑上做一些调整，大约需要一分钟，请不要关闭 Tomo。', 'このバージョンでは、このコンピューターでいくつか変更が必要です。1 分ほどかかります。Tomo を閉じずにお待ちください。')}</p>
          <div className="usage-progress-bar migration-progress" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100} data-testid="migration-progress">
            <div className={`usage-progress-fill ${failed ? 'warn' : ''}`} style={{ width: `${done ? 100 : overall}%` }} />
          </div>
          <ul className="task-list">
            {TASKS.map((t) => (
              <li key={t} className={`task ${m.tasks[t]}`} data-testid={`migration-${t}`}>
                <span className="task-mark" aria-hidden="true">
                  {m.tasks[t] === 'done' ? <Icon name="check" size={11} /> : m.tasks[t] === 'error' ? <Icon name="close" size={10} /> : m.tasks[t] === 'running' ? <span className="spinner" /> : null}
                </span>
                <div><strong>{label[t][0]}</strong><span>{label[t][1]}</span></div>
              </li>
            ))}
          </ul>
          {failed && (
            <div className="task-actions">
              <button className="secondary" onClick={() => void window.tomo.diagnostics().then((d) => navigator.clipboard?.writeText(`${m.error ?? ''}\n\n${d}`))}>{c('Copy diagnostics', '复制诊断信息', '診断情報をコピー')}</button>
              {m.rolledBack && <button className="secondary" data-testid="migration-dismiss" onClick={() => void window.tomo.dismissMigration()}>{c('Use the previous version', '先用之前的版本', '以前のバージョンで使う')}</button>}
              <button className="primary" data-testid="migration-retry" onClick={() => void window.tomo.runMigration()}>{c('Try Again', '重试', '再試行')}</button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
