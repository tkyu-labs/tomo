// One banner above the page for things the student should act on soon: an app update that is ready (restart), a
// school pack update (done, available, or waiting for review because it adds access). Never progress bars here;
// those stay in Settings. Dismissing hides that notice until something new arrives.
import { useCopy } from '../i18n'
import { Icon, type IconName } from './Icon'

export type BannerNotice =
  | { kind: 'app-ready'; version: string }
  | { kind: 'app-portable'; version: string }
  | { kind: 'pack-updated' | 'pack-available' | 'pack-review'; name: string; version: string }

export const bannerKey = (n: BannerNotice) => `${n.kind}:${n.version}`

export function Banner({ notice, onAction, onDismiss }: { notice: BannerNotice; onAction: () => void; onDismiss: () => void }) {
  const c = useCopy()
  const v = notice.version
  const name = 'name' in notice ? notice.name : ''
  const text = {
    'app-ready': c(`Tomo ${v} is ready. Restart to finish the update.`, `Tomo ${v} 已准备好，重启即可完成更新。`, `Tomo ${v} の準備ができました。再起動すると更新が完了します。`),
    'app-portable': c(`Tomo ${v} is available. Download it and replace this folder's App files.`, `Tomo ${v} 已发布。下载后替换此文件夹里的 App 即可。`, `Tomo ${v} が公開されました。ダウンロードしてこのフォルダーの App を置き換えてください。`),
    'pack-updated': c(`${name} was updated to ${v}. It applies from your next question.`, `${name} 已更新到 ${v}，从下一个问题开始生效。`, `${name} を ${v} に更新しました。次の質問から反映されます。`),
    'pack-available': c(`${name} ${v} is available.`, `${name} ${v} 可以更新了。`, `${name} ${v} に更新できます。`),
    'pack-review': c(`${name} ${v} needs your OK: it adds new access.`, `${name} ${v} 需要你确认：它新增了访问权限。`, `${name} ${v} は新しいアクセスを追加するため、確認が必要です。`),
  }[notice.kind]
  const action = {
    'app-ready': c('Restart now', '立即重启', '今すぐ再起動'),
    'app-portable': c('Download…', '下载…', 'ダウンロード…'),
    'pack-updated': c("What's new", '更新内容', '更新内容'),
    'pack-available': c('Update', '更新', '更新'),
    'pack-review': c('Review…', '查看…', '確認…'),
  }[notice.kind]
  const icon: IconName = notice.kind.startsWith('app') ? 'refresh' : notice.kind === 'pack-review' ? 'shield' : 'box'
  return (
    <div className={`app-banner ${notice.kind === 'pack-review' ? 'attention' : ''}`} role="status" data-testid="app-banner" data-kind={notice.kind}>
      <Icon name={icon} size={14} />
      <span>{text}</span>
      <button className={notice.kind === 'app-ready' ? 'primary' : 'secondary'} data-testid="banner-action" onClick={onAction}>{action}</button>
      <button className="app-banner-close" data-testid="banner-dismiss" onClick={onDismiss} aria-label={c('Later', '稍后', '後で')} title={c('Later', '稍后', '後で')}>
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}
