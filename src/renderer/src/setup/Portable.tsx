// Windows portable build: the password that replaces DPAPI for Tomo's secret store. Set in the first-run privacy
// step, asked at every start (UnlockScreen), changeable in Settings. Tomo cannot recover a forgotten password.
import { useEffect, useState } from 'react'
import { useCopy } from '../i18n'
import { Icon } from '../ui/Icon'

export const MIN_PASSWORD = 8
export const passwordOk = (pw: string, confirm: string) => pw.length >= MIN_PASSWORD && pw === confirm

export function PasswordFields({ value, confirm, onChange, onConfirm, label }: { value: string; confirm: string; onChange: (v: string) => void; onConfirm: (v: string) => void; label?: string }) {
  const c = useCopy()
  const short = value.length > 0 && value.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && confirm !== value
  return (
    <div className="password-fields">
      <label className="field-label" htmlFor="pw-new">{label ?? c('Password', '密码', 'パスワード')}</label>
      <input id="pw-new" data-testid="pw-new" type="password" className="catalog-search-input" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" />
      <label className="field-label" htmlFor="pw-confirm">{c('Type it again', '再输入一次', 'もう一度入力')}</label>
      <input id="pw-confirm" data-testid="pw-confirm" type="password" className="catalog-search-input" value={confirm} onChange={(e) => onConfirm(e.target.value)} autoComplete="new-password" />
      <small className={short || mismatch ? 'error-text' : ''}>
        {short
          ? c(`At least ${MIN_PASSWORD} characters.`, `至少 ${MIN_PASSWORD} 个字符。`, `${MIN_PASSWORD} 文字以上にしてください。`)
          : mismatch
            ? c('The two entries are different.', '两次输入不一致。', '2 回の入力が一致しません。')
            : c(`At least ${MIN_PASSWORD} characters. A sentence you remember works well.`, `至少 ${MIN_PASSWORD} 个字符，用一句你记得住的话也可以。`, `${MIN_PASSWORD} 文字以上。覚えやすい文でもかまいません。`)}
      </small>
    </div>
  )
}

/** The first-run block under "How privacy works" (portable build only). */
export function PortablePasswordSetup({ value, confirm, onChange, onConfirm }: { value: string; confirm: string; onChange: (v: string) => void; onConfirm: (v: string) => void }) {
  const c = useCopy()
  return (
    <div className="portable-password" data-testid="portable-setup">
      <h3>{c('Set a password for Tomo Portable', '为 Tomo Portable 设置密码', 'Tomo Portable のパスワードを設定')}</h3>
      <p>{c(
        'This folder can move to another computer, so Windows cannot protect your AI keys, name and student number. Tomo encrypts them with this password and asks for it each time it starts. Tomo cannot recover a forgotten password.',
        '这个文件夹可以带到别的电脑上用，所以 Windows 无法保护你的 AI Key、姓名和学号。Tomo 会用这个密码加密它们，每次启动时都会询问。忘记密码后 Tomo 无法找回。',
        'このフォルダーは別のコンピューターに持ち運べるため、Windows では AI のキーや氏名・学籍番号を保護できません。Tomo はこのパスワードで暗号化し、起動のたびに入力を求めます。忘れたパスワードは復元できません。',
      )}</p>
      <PasswordFields value={value} confirm={confirm} onChange={onChange} onConfirm={onConfirm} />
    </div>
  )
}

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const c = useCopy()
  const [value, setValue] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const submit = async () => {
    setBusy(true)
    const ok = await window.tomo.unlockPortable(value).catch(() => false)
    setBusy(false)
    if (ok) onUnlocked()
    else { setWrong(true); setValue('') }
  }
  return (
    <main className="standalone-page onboarding-page unlock-page" data-testid="unlock">
      <div className="setup-card unlock-card">
        <div className="setup-visual"><Icon name="lock" size={30} /></div>
        <h1>{c('Open Tomo Portable', '打开 Tomo Portable', 'Tomo Portable を開く')}</h1>
        <p>{c('Enter the password you set for this Tomo folder.', '输入你为这个 Tomo 文件夹设置的密码。', 'この Tomo フォルダーに設定したパスワードを入力してください。')}</p>
        <input type="password" data-testid="unlock-password" className="catalog-search-input" value={value} autoFocus aria-label={c('Password', '密码', 'パスワード')}
          onChange={(e) => { setValue(e.target.value); setWrong(false) }} onKeyDown={(e) => { if (e.key === 'Enter' && value) void submit() }} />
        {wrong && <small className="error-text" data-testid="unlock-wrong">{c('That password is not right.', '密码不正确。', 'パスワードが違います。')}</small>}
        <div className="modal-actions">
          <button className="secondary" onClick={() => setForgot(true)}>{c('Forgot password', '忘记密码', 'パスワードを忘れた')}</button>
          <button className="primary" data-testid="unlock-open" disabled={!value || busy} onClick={() => void submit()}>{c('Open', '打开', '開く')}</button>
        </div>
        {forgot && (
          <div className="diff-banner unlock-forgot">
            <div>
              <strong>{c('Tomo cannot recover it.', 'Tomo 无法找回密码。', 'Tomo はパスワードを復元できません。')}</strong>
              <p>{c(
                'Starting over keeps your chats and what Tomo remembers, but removes the AI keys and your name and student number. You enter them again in the setup.',
                '重新开始会保留对话和 Tomo 记住的内容，但会删除 AI 服务的 Key 以及姓名和学号，需要在设置里重新输入。',
                'やり直すと会話と Tomo の記憶は残りますが、AI のキーと氏名・学籍番号は削除されます。設定で入力し直します。',
              )}</p>
            </div>
            <button className="danger-button" onClick={() => void window.tomo.resetPortable().then(onUnlocked)}>{c('Start over…', '重新开始…', 'やり直す…')}</button>
          </div>
        )}
      </div>
    </main>
  )
}

export function ChangePasswordSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const c = useCopy()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [wrong, setWrong] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const save = async () => {
    try {
      if (await window.tomo.changePortablePassword(current, pw)) { onChanged(); onClose() } else setWrong(true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" data-testid="change-password" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{c('Change password', '修改密码', 'パスワードを変更')}</h2>
        <p className="modal-intro">{c('Tomo re-encrypts your keys and identifiers with the new password.', 'Tomo 会用新密码重新加密你的 Key 和身份信息。', 'キーと識別情報を新しいパスワードで暗号化し直します。')}</p>
        <label className="field-label" htmlFor="pw-current">{c('Current password', '当前密码', '現在のパスワード')}</label>
        <input id="pw-current" data-testid="pw-current" type="password" className="catalog-search-input" value={current} onChange={(e) => { setCurrent(e.target.value); setWrong(false) }} autoComplete="current-password" />
        {wrong && <small className="error-text">{c('That password is not right.', '密码不正确。', 'パスワードが違います。')}</small>}
        <PasswordFields value={pw} confirm={confirm} onChange={setPw} onConfirm={setConfirm} label={c('New password', '新密码', '新しいパスワード')} />
        {error && <small className="error-text">{error}</small>}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>{c('Cancel', '取消', 'キャンセル')}</button>
          <button className="primary" data-testid="pw-change" disabled={!current || !passwordOk(pw, confirm)} onClick={() => void save()}>{c('Change', '修改', '変更')}</button>
        </div>
      </div>
    </div>
  )
}
