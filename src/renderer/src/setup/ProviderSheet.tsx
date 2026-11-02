// Key sheet: GakuenAI first (tester builds), then OpenRouter, DeepSeek, OpenAI (API key) and a
// custom OpenAI-/Anthropic-compatible endpoint. Keys go straight to the main process and the OS keychain.
import { useEffect, useState } from 'react'
import type { ProviderChoice, ProviderId } from '@shared/ipc'
import { useCopy } from '../i18n'
import { Icon } from '../ui/Icon'

const NAMES: Record<ProviderId, string> = {
  gakuen: 'GakuenAI', openai: 'OpenAI (ChatGPT)', 'openai-api': 'OpenAI', openrouter: 'OpenRouter', deepseek: 'DeepSeek', custom: 'Custom endpoint',
}
export const providerLabel = (id: ProviderId) => NAMES[id]

const DEFAULT_MODEL: Partial<Record<ProviderId, string>> = { gakuen: 'deepseek-flash', 'openai-api': 'gpt-6-luna' }

export function ProviderSheet({ onClose, onConnect, gakuenAvailable }: {
  onClose: () => void
  onConnect: (choice: ProviderChoice, key?: string) => Promise<void>
  gakuenAvailable: boolean
}) {
  const c = useCopy()
  const order: ProviderId[] = [...(gakuenAvailable ? (['gakuen'] as ProviderId[]) : []), 'openrouter', 'deepseek', 'openai-api', 'custom']
  const [provider, setProvider] = useState<ProviderId>(order[0]!)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODEL[order[0]!] ?? '')
  const [baseUrl, setBaseUrl] = useState('')
  const [customKind, setCustomKind] = useState<'openai' | 'anthropic'>('openai')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const subtitle: Record<ProviderId, string> = {
    gakuen: c('For Tomo testers · paste the key you received with Tomo', 'Tomo 测试用户 · 粘贴随 Tomo 收到的 Key', 'Tomo テスター向け · Tomo と一緒に届いたキーを貼り付け'),
    openai: '',
    'openai-api': c('OpenAI API key', 'OpenAI API Key', 'OpenAI の API キー'),
    openrouter: c('One API key for many models', '一个 API Key 使用多家模型', '1つの API キーで多くのモデル'),
    deepseek: c('DeepSeek API key', 'DeepSeek API Key', 'DeepSeek の API キー'),
    custom: c('OpenAI- or Anthropic-compatible endpoint', 'OpenAI 或 Anthropic 兼容接口', 'OpenAI / Anthropic 互換エンドポイント'),
  }
  const canConnect = !!apiKey.trim() && !!model.trim() && (provider !== 'custom' || !!baseUrl.trim())

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConnect({ id: provider, model: model.trim(), reasoning: 'low', ...(provider === 'custom' ? { baseUrl: baseUrl.trim(), customKind } : {}) }, apiKey.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal connect-sheet" role="dialog" aria-modal="true" aria-labelledby="connect-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="connect-title">{c('Connect an AI provider', '连接 AI 服务', 'AI サービスを接続')}</h2>
        <p className="modal-intro">{c('Tomo answers through one of these providers.', 'Tomo 通过以下服务之一来回答问题。', 'Tomo は次のいずれかのサービスを通じて回答します。')}</p>
        <div className="provider-list" role="radiogroup" aria-label={c('Provider', '服务商', 'プロバイダー')}>
          {order.map((id) => (
            <label key={id} className={`provider-row ${provider === id ? 'selected' : ''}`}>
              <input type="radio" name="provider" data-testid={`provider-${id}`} checked={provider === id} onChange={() => { setProvider(id); setModel(DEFAULT_MODEL[id] ?? '') }} />
              <div>
                <strong>{id === 'custom' ? c('Custom endpoint', '自定义接口', 'カスタムエンドポイント') : NAMES[id]}</strong>
                <span>{subtitle[id]}</span>
              </div>
            </label>
          ))}
        </div>
        <div className="connect-detail">
          {provider === 'custom' && (
            <>
              <div className="segmented" role="radiogroup" aria-label={c('API format', '接口格式', 'API 形式')}>
                {(['openai', 'anthropic'] as const).map((k) => (
                  <button key={k} role="radio" aria-checked={customKind === k} className={customKind === k ? 'active' : ''} onClick={() => setCustomKind(k)}>
                    {k === 'openai' ? 'OpenAI-compatible' : 'Anthropic-compatible'}
                  </button>
                ))}
              </div>
              <label className="field-label" htmlFor="base-url">Base URL</label>
              <input id="base-url" className="catalog-search-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={customKind === 'openai' ? 'https://example.com/v1' : 'https://example.com'} />
            </>
          )}
          <label className="field-label" htmlFor="api-key">{c('API key', 'API Key', 'API キー')}</label>
          <div className="key-input-row">
            <input id="api-key" type={showKey ? 'text' : 'password'} className="catalog-search-input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider === 'gakuen' ? 'gk-…' : 'sk-…'} autoComplete="off" spellCheck={false} />
            <button className="secondary" onClick={() => setShowKey(!showKey)} aria-label={c('Show key', '显示 Key', 'キーを表示')}><Icon name="eye" size={14} /></button>
          </div>
          <label className="field-label" htmlFor="model">{c('Model', '模型', 'モデル')}</label>
          <input id="model" className="catalog-search-input mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder={c('Model name, e.g. from the provider’s list', '模型名称，可在服务商的模型列表中找到', 'モデル名（プロバイダーの一覧にあります）')} spellCheck={false} />
          {error && <p className="test-result-box error"><Icon name="info" size={13} />{error}</p>}
        </div>
        <p className="approval-meta">
          <Icon name="lock" size={13} />
          {c("Stored with your system's encryption on this computer and handed to Tomo's AI engine only while it runs.", '用系统加密保存在这台电脑上，只在 Tomo 的 AI 引擎运行时交给它使用。', 'システムの暗号化でこのコンピューターに保存し、Tomo の AI エンジンの実行中だけ渡します。')}
        </p>
        <div className="modal-actions approval-actions">
          <button className="secondary" onClick={onClose}>{c('Cancel', '取消', 'キャンセル')}</button>
          <button className="primary" data-testid="provider-connect" disabled={!canConnect || busy} onClick={() => void connect()}>{c('Connect', '连接', '接続')}</button>
        </div>
      </div>
    </div>
  )
}
