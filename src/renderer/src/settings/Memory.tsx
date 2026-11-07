import { useEffect, useState } from 'react'
import type { MemoryTarget } from '@shared/ipc'
import { unmask } from '@shared/privacy/masker'
import { useCopy } from '../i18n'
import { Icon } from '../ui/Icon'

/**
 * What Tomo remembers (Hermes USER.md and MEMORY.md): visible, editable, deletable. Shown with real values on this
 * screen only; the main process turns them back into placeholders before writing. Hermes reads memory when a chat
 * starts, so a change applies from the next chat.
 */
export function Memory({ values }: { values: Record<string, string> }) {
  const c = useCopy()
  const [user, setUser] = useState<string[] | null>(null)
  const [notes, setNotes] = useState<string[] | null>(null)
  const [forget, setForget] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    void window.tomo.userMemory('user').then(setUser)
    void window.tomo.userMemory('notes').then(setNotes)
  }, [])

  const save = async (target: MemoryTarget, entries: string[]) => {
    const stored = await window.tomo.saveMemory(target, entries.map((e) => unmask(e, values)))
    if (target === 'user') setUser(stored)
    else setNotes(stored)
    setSaved(true)
  }

  return (
    <main className="standalone-page product-page" data-testid="memory">
      <header className="page-header">
        <div>
          <span>{c('MEMORY', '记忆', 'メモリー')}</span>
          <h1>{c('What Tomo remembers', 'Tomo 记住的内容', 'Tomo が覚えていること')}</h1>
          <p>{c('You can change or delete anything here. Your name and student number are stored only as placeholders; they are shown here from this computer’s encrypted store.', '这里的内容都可以修改或删除。姓名和学号只以占位符保存；这里显示的是本机加密存储中的真实值。', 'ここにある内容はすべて変更・削除できます。氏名と学籍番号はプレースホルダーとしてのみ保存され、ここでは端末の暗号化領域から表示しています。')}</p>
        </div>
      </header>
      <div className="page-body">
        {saved && <p className="hatch-note" data-testid="memory-saved"><Icon name="check" size={13} /> {c('Saved. It applies from your next chat.', '已保存，从下一个对话开始生效。', '保存しました。次のチャットから反映されます。')}</p>}
        <MemorySection title={c('About you', '关于你', 'あなたについて')} target="user" entries={user} values={values} onSave={save} />
        <MemorySection title={c("Tomo's notes", 'Tomo 的笔记', 'Tomo のメモ')} target="notes" entries={notes} values={values} onSave={save} />
        <div className="memory-forget">
          <button className="danger-button" data-testid="memory-forget" disabled={!user?.length && !notes?.length} onClick={() => setForget(true)}>{c('Forget everything…', '全部忘记…', 'すべて忘れる…')}</button>
        </div>
      </div>
      {forget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setForget(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" data-testid="memory-forget-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon"><Icon name="trash" size={22} /></div>
            <h2>{c('Forget everything Tomo remembers?', '让 Tomo 忘记全部内容？', 'Tomo が覚えていることをすべて忘れますか？')}</h2>
            <p className="modal-intro">{c('Tomo learns about you again from your chats. Your chats, keys and school pack stay.', 'Tomo 会在之后的对话中重新了解你。对话、Key 和学校能力包都会保留。', 'Tomo はこれからのチャットで改めてあなたを知っていきます。チャット、キー、学校パックは残ります。')}</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setForget(false)}>{c('Cancel', '取消', 'キャンセル')}</button>
              <button className="danger-button" data-testid="memory-forget-confirm" onClick={() => void Promise.all([save('user', []), save('notes', [])]).then(() => setForget(false))}>{c('Forget', '忘记', '忘れる')}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function MemorySection({ title, target, entries, values, onSave }: {
  title: string; target: MemoryTarget; entries: string[] | null; values: Record<string, string>; onSave: (t: MemoryTarget, e: string[]) => Promise<void>
}) {
  const c = useCopy()
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const replace = (i: number, text: string | null) => {
    const next = [...(entries ?? [])]
    if (text === null) next.splice(i, 1)
    else next[i] = text
    setEditing(null)
    void onSave(target, next)
  }
  return (
    <section className="settings-section" data-testid={`memory-${target}`}>
      <h2>{title}</h2>
      {entries === null ? <div className="setting-row"><span className="spinner" /></div> : entries.length === 0 ? (
        <div className="setting-row"><div><span>{c('Nothing yet.', '还没有内容。', 'まだありません。')}</span></div></div>
      ) : entries.map((e, i) => (
        <div className="setting-row" key={`${i}-${e}`} data-testid="memory-entry">
          {editing === i ? (
            <>
              <textarea className="catalog-search-input memory-edit" data-testid="memory-edit" value={draft} autoFocus onChange={(ev) => setDraft(ev.target.value)} />
              <div className="row-actions">
                <button className="secondary" onClick={() => setEditing(null)}>{c('Cancel', '取消', 'キャンセル')}</button>
                <button className="primary" data-testid="memory-save" disabled={!draft.trim()} onClick={() => replace(i, draft)}>{c('Save', '保存', '保存')}</button>
              </div>
            </>
          ) : (
            <>
              <div><strong>{unmask(e, values)}</strong></div>
              {e.includes('{{') && <span className="tag-v2" data-testid="masked-tag" title={`${c('Saved as', '保存为', '保存形式')}: ${e}`}><Icon name="lock" size={12} />{c('Masked', '已遮蔽', 'マスク済み')}</span>}
              <div className="row-actions">
                <button className="secondary" data-testid="memory-edit-open" onClick={() => { setDraft(unmask(e, values)); setEditing(i) }}>{c('Edit', '修改', '編集')}</button>
                <button className="secondary" data-testid="memory-delete" onClick={() => replace(i, null)}>{c('Delete', '删除', '削除')}</button>
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  )
}
