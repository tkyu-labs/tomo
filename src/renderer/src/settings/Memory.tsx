import { useEffect, useState } from 'react'
import { unmask } from '@shared/privacy/masker'
import { useCopy } from '../i18n'
import { Icon } from '../ui/Icon'

/** What Tomo remembers (Hermes USER.md). Shown with real values on this screen only; stored as placeholders. */
export function Memory({ values }: { values: Record<string, string> }) {
  const c = useCopy()
  const [entries, setEntries] = useState<string[] | null>(null)
  useEffect(() => { void window.tomo.userMemory().then(setEntries) }, [])
  return (
    <main className="standalone-page product-page" data-testid="memory">
      <header className="page-header">
        <div>
          <span>{c('MEMORY', '记忆', 'メモリー')}</span>
          <h1>{c('About you', '关于你', 'あなたについて')}</h1>
          <p>{c('What Tomo remembers about you. Your name and student number are stored only as placeholders; they are shown here from this computer’s encrypted store.', 'Tomo 记住的关于你的内容。姓名和学号只以占位符保存；这里显示的是本机加密存储中的真实值。', 'Tomo が覚えている内容です。氏名と学籍番号はプレースホルダーとしてのみ保存され、ここでは端末の暗号化領域から表示しています。')}</p>
        </div>
      </header>
      <div className="page-body">
        <section className="settings-section">
          {entries === null ? <span className="spinner" /> : entries.length === 0 ? <p>{c('Nothing yet.', '还没有内容。', 'まだありません。')}</p> : (
            entries.map((e, i) => (
              <div className="setting-row" key={i} data-testid="memory-entry">
                <div><strong>{unmask(e, values)}</strong></div>
                {e.includes('{{') && <span className="tag-v2" data-testid="masked-tag" title={`${c('Saved as', '保存为', '保存形式')}: ${e}`}><Icon name="lock" size={12} />{c('Masked', '已遮蔽', 'マスク済み')}</span>}
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  )
}
