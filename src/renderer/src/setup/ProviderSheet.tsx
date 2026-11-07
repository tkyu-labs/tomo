// Key sheet: GakuenAI first (builds that know its URL), OpenAI by ChatGPT sign-in (the only OAuth), then OpenRouter, DeepSeek,
// OpenAI by API key and a custom OpenAI-/Anthropic-compatible endpoint. "Test" fetches the provider's model list
// with the key, so the student picks a model instead of typing an id. Keys go to the main process and the keychain.
import { useEffect, useState } from 'react'
import type { ChatGptLoginEvent, ProviderChoice, ProviderId } from '@shared/ipc'
import { useCopy } from '../i18n'
import { Icon } from '../ui/Icon'

const NAMES: Record<ProviderId, string> = {
  gakuen: 'GakuenAI', openai: 'OpenAI (ChatGPT)', 'openai-api': 'OpenAI API', openrouter: 'OpenRouter', deepseek: 'DeepSeek', custom: 'Custom endpoint',
}
export const providerLabel = (id: ProviderId) => NAMES[id]

/** Suggested defaults (model benchmark: DeepSeek Flash, GPT-6 Luna, Claude Haiku 5.5): first match in the list wins. */
const PREFERRED = [/deepseek.*flash/i, /gpt-6-luna/i, /haiku/i, /deepseek-chat/i, /luna/i, /flash/i, /mini/i]
export function suggestModel(models: string[]): string {
  for (const re of PREFERRED) {
    const hit = models.find((m) => re.test(m))
    if (hit) return hit
  }
  return models[0] ?? ''
}

type Test = { state: 'idle' } | { state: 'testing' } | { state: 'ok'; models: string[] } | { state: 'error'; error: string }

export function ProviderSheet({ onClose, onConnect, gakuenAvailable }: {
  onClose: () => void
  onConnect: (choice: ProviderChoice, key?: string, models?: string[]) => Promise<void>
  gakuenAvailable: boolean
}) {
  const c = useCopy()
  const order: ProviderId[] = [...(gakuenAvailable ? (['gakuen'] as ProviderId[]) : []), 'openai', 'openrouter', 'deepseek', 'openai-api', 'custom']
  const [provider, setProvider] = useState<ProviderId>(order[0]!)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [customKind, setCustomKind] = useState<'openai' | 'anthropic'>('openai')
  const [test, setTest] = useState<Test>({ state: 'idle' })
  const [model, setModel] = useState('')
  const [login, setLogin] = useState<ChatGptLoginEvent | { event: 'idle' } | { event: 'starting' }>({ event: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isChatGpt = provider === 'openai'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => window.tomo.onChatGptLogin((e) => {
    setLogin(e)
    if (e.event === 'approved') { setTest({ state: 'ok', models: e.models }); setModel(suggestModel(e.models)) }
  }), [])
  useEffect(() => () => { void window.tomo.cancelChatGptLogin() }, [])

  const choose = (id: ProviderId) => {
    setProvider(id)
    setTest({ state: 'idle' })
    setModel('')
    setError(null)
    if (login.event !== 'approved') { void window.tomo.cancelChatGptLogin(); setLogin({ event: 'idle' }) }
  }
  const choice = (): ProviderChoice => ({ id: provider, model, reasoning: 'low', ...(provider === 'custom' ? { baseUrl: baseUrl.trim(), customKind } : {}) })

  const runTest = async () => {
    setTest({ state: 'testing' })
    const res = await window.tomo.listProviderModels(choice(), apiKey.trim())
    if (res.ok && res.models) { setTest({ state: 'ok', models: res.models }); setModel(suggestModel(res.models)) }
    else setTest({ state: 'error', error: res.error ?? 'unreachable' })
  }

  const subtitle: Record<ProviderId, string> = {
    gakuen: c('Paste your GakuenAI key', '粘贴你的 GakuenAI Key', 'GakuenAI キーを貼り付け'),
    openai: c('Sign in with your ChatGPT account · no key needed', '用 ChatGPT 账号登录 · 无需 Key', 'ChatGPT アカウントでサインイン · キー不要'),
    'openai-api': c('OpenAI API key', 'OpenAI API Key', 'OpenAI の API キー'),
    openrouter: c('One API key for many models', '一个 API Key 使用多家模型', '1つの API キーで多くのモデル'),
    deepseek: c('DeepSeek API key', 'DeepSeek API Key', 'DeepSeek の API キー'),
    custom: c('OpenAI- or Anthropic-compatible endpoint', 'OpenAI 或 Anthropic 兼容接口', 'OpenAI / Anthropic 互換エンドポイント'),
  }
  const canTest = !!apiKey.trim() && (provider !== 'custom' || !!baseUrl.trim()) && test.state !== 'testing'
  const canConnect = test.state === 'ok' && !!model && !busy

  const connect = async () => {
    setBusy(true)
    setError(null)
    try { await onConnect(choice(), isChatGpt ? undefined : apiKey.trim(), test.state === 'ok' ? test.models : undefined) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal connect-sheet" role="dialog" aria-modal="true" aria-labelledby="connect-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="connect-title">{c('Connect an AI provider', '连接 AI 服务', 'AI サービスを接続')}</h2>
        <p className="modal-intro">{c('Tomo answers through one of these providers.', 'Tomo 通过以下服务之一来回答问题。', 'Tomo は次のいずれかのサービスを通じて回答します。')}</p>
        <div className="provider-list" role="radiogroup" aria-label={c('Provider', '服务商', 'プロバイダー')}>
          {order.map((id) => (
            <label key={id} className={`provider-row ${provider === id ? 'selected' : ''}`}>
              <input type="radio" name="provider" data-testid={`provider-${id}`} checked={provider === id} onChange={() => choose(id)} />
              <div>
                <strong>{id === 'custom' ? c('Custom endpoint', '自定义接口', 'カスタムエンドポイント') : NAMES[id]}</strong>
                <span>{subtitle[id]}</span>
              </div>
            </label>
          ))}
        </div>

        <div className="connect-detail">
          {isChatGpt ? (
            <div className="device-code-box" data-testid="chatgpt-login">
              {login.event === 'idle' || login.event === 'expired' || login.event === 'error' ? (
                <>
                  <span>{c('Sign in with the ChatGPT account you use every day. Tomo never sees your password.', '用你平时使用的 ChatGPT 账号登录。Tomo 看不到你的密码。', '普段の ChatGPT アカウントでサインインします。Tomo がパスワードを見ることはありません。')}</span>
                  <div className="device-code-actions">
                    <button className="primary" data-testid="chatgpt-start" onClick={() => { setLogin({ event: 'starting' }); void window.tomo.startChatGptLogin() }}>
                      {c('Sign in with ChatGPT', '用 ChatGPT 登录', 'ChatGPT でサインイン')}
                    </button>
                  </div>
                  {login.event === 'expired' && <small>{c('The code expired. Start again for a new one.', '验证码已过期，请重新开始。', 'コードの有効期限が切れました。もう一度お試しください。')}</small>}
                  {login.event === 'error' && <small className="error-text">{login.message}</small>}
                </>
              ) : login.event === 'starting' ? (
                <span><span className="spinner" /> {c('Asking OpenAI for a sign-in code…', '正在向 OpenAI 获取登录验证码…', 'OpenAI にサインインコードを要求しています…')}</span>
              ) : login.event === 'code' ? (
                <>
                  <span>{c('1. Open the sign-in page · 2. Sign in · 3. Enter this code', '1. 打开登录页面 · 2. 登录 · 3. 输入这个验证码', '1. サインインページを開く · 2. サインイン · 3. このコードを入力')}</span>
                  <div className="device-code-text" data-testid="chatgpt-code">{login.user_code}</div>
                  <div className="device-code-actions">
                    <button className="secondary" onClick={() => navigator.clipboard?.writeText(login.user_code)}><Icon name="copy" size={13} />{c('Copy code', '复制验证码', 'コードをコピー')}</button>
                    <button className="primary" onClick={() => window.open(login.verification_url, '_blank')}><Icon name="external" size={13} />{c('Open sign-in page', '打开登录页面', 'サインインページを開く')}</button>
                  </div>
                  <small><span className="spinner" /> {c('Waiting for you to approve in the browser… (the code is valid for 15 minutes)', '等待你在浏览器中批准…（验证码 15 分钟内有效）', 'ブラウザでの承認を待っています…（コードの有効期限は 15 分）')}</small>
                </>
              ) : (
                <p className="test-result-box success"><Icon name="check" size={13} />{c('Signed in to ChatGPT.', '已登录 ChatGPT。', 'ChatGPT にサインインしました。')}</p>
              )}
            </div>
          ) : (
            <>
              {provider === 'custom' && (
                <>
                  <div className="segmented" role="radiogroup" aria-label={c('API format', '接口格式', 'API 形式')}>
                    {(['openai', 'anthropic'] as const).map((k) => (
                      <button key={k} role="radio" aria-checked={customKind === k} className={customKind === k ? 'active' : ''} onClick={() => { setCustomKind(k); setTest({ state: 'idle' }) }}>
                        {k === 'openai' ? 'OpenAI-compatible' : 'Anthropic-compatible'}
                      </button>
                    ))}
                  </div>
                  <label className="field-label" htmlFor="base-url">Base URL</label>
                  <input id="base-url" className="catalog-search-input" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setTest({ state: 'idle' }) }} placeholder={customKind === 'openai' ? 'https://example.com/v1' : 'https://example.com'} />
                </>
              )}
              <label className="field-label" htmlFor="api-key">{c('API key', 'API Key', 'API キー')}</label>
              <div className="key-input-row">
                <input id="api-key" type={showKey ? 'text' : 'password'} className="catalog-search-input" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTest({ state: 'idle' }) }} placeholder="sk-…" autoComplete="off" spellCheck={false} />
                <button className="secondary" onClick={() => setShowKey(!showKey)} aria-label={c('Show key', '显示 Key', 'キーを表示')}><Icon name="eye" size={14} /></button>
                <button className="secondary" data-testid="provider-test" disabled={!canTest} onClick={() => void runTest()}>
                  {test.state === 'testing' ? c('Testing…', '测试中…', 'テスト中…') : c('Test', '测试', 'テスト')}
                </button>
              </div>
              {test.state === 'error' && (
                <p className="test-result-box error" data-testid="provider-test-error"><Icon name="info" size={13} />
                  {test.error === 'wrong-key'
                    ? c(`${NAMES[provider]} did not accept this key. Check that you copied all of it.`, `${NAMES[provider]} 不接受这个 Key，请确认是否完整复制。`, `${NAMES[provider]} がこのキーを受け付けませんでした。すべてコピーしたか確認してください。`)
                    : test.error === 'no-credit'
                      ? c(`This ${NAMES[provider]} account has no balance or quota left. Top it up, then press Test again.`, `这个 ${NAMES[provider]} 账户的余额或额度已用完，充值后再点“测试”。`, `この ${NAMES[provider]} アカウントの残高または利用枠がありません。チャージしてから、もう一度「テスト」を押してください。`)
                    : test.error === 'no-models'
                      ? c('The key works, but the provider listed no chat models.', 'Key 可用，但服务商没有返回可用的对话模型。', 'キーは有効ですが、利用できるチャットモデルがありません。')
                      : c('Cannot reach the provider. Check your network or the base URL.', '无法连接服务商，请检查网络或 Base URL。', '接続できません。ネットワークまたは Base URL を確認してください。')}
                </p>
              )}
            </>
          )}
          {test.state === 'ok' && (
            <>
              {!isChatGpt && <p className="test-result-box success"><Icon name="check" size={13} />{c(`Connected. ${test.models.length} models available.`, `连接成功，可用模型 ${test.models.length} 个。`, `接続できました。利用できるモデルは ${test.models.length} 件です。`)}</p>}
              <label className="field-label" htmlFor="model">{c('Model', '模型', 'モデル')}</label>
              <select id="model" data-testid="provider-model" className="setting-value setting-select model-select" value={model} onChange={(e) => setModel(e.target.value)}>
                {test.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </>
          )}
          {error && <p className="test-result-box error"><Icon name="info" size={13} />{error}</p>}
        </div>
        <p className="approval-meta">
          <Icon name="lock" size={13} />
          {isChatGpt
            ? c("The sign-in stays in Tomo's AI engine on this computer.", '登录状态只保存在这台电脑上 Tomo 的 AI 引擎里。', 'サインイン情報はこのコンピューターの Tomo の AI エンジンにだけ保存されます。')
            : c("Stored with your system's encryption on this computer and handed to Tomo's AI engine only while it runs.", '用系统加密保存在这台电脑上，只在 Tomo 的 AI 引擎运行时交给它使用。', 'システムの暗号化でこのコンピューターに保存し、Tomo の AI エンジンの実行中だけ渡します。')}
        </p>
        <div className="modal-actions approval-actions">
          <button className="secondary" onClick={onClose}>{c('Cancel', '取消', 'キャンセル')}</button>
          <button className="primary" data-testid="provider-connect" disabled={!canConnect} onClick={() => void connect()}>{c('Connect', '连接', '接続')}</button>
        </div>
      </div>
    </div>
  )
}
