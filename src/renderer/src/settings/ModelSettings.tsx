// Settings → Model & usage: the provider in use, its model and thinking level, the fallback (on by default with a
// second connection) and the connected providers. Changing providers rewrites Hermes' config and restarts the engine.
import { useEffect, useState } from 'react'
import type { AppState, Connection, FallbackChoice, ModelList, ProviderId, Reasoning } from '@shared/ipc'
import { useCopy } from '../i18n'
import { providerLabel, ProviderSheet, suggestModel } from '../setup/ProviderSheet'
import { Icon } from '../ui/Icon'

type Run = (label: string, fn: () => Promise<unknown>, done?: string) => Promise<void>

export function ModelSettings({ state, busy, run }: { state: AppState; busy: string | null; run: Run }) {
  const c = useCopy()
  const [models, setModels] = useState<ModelList | null>(null)
  const [sheet, setSheet] = useState(false)
  const ready = state.engine.state === 'ready'
  const active = state.provider
  const connections = state.connections
  const others = connections.filter((x) => x.id !== active?.id)
  const fb = state.fallback
  const fbConn = fb ? others.find((x) => x.id === fb.id) : undefined

  useEffect(() => { if (ready) void window.tomo.listModels().then(setModels).catch(() => setModels(null)) }, [ready, active?.id])

  const name = (id: ProviderId) => (id === 'custom' ? c('Custom endpoint', '自定义接口', 'カスタムエンドポイント') : providerLabel(id))
  const modelsOf = (x: Connection) => (x.models?.length ? x.models : [x.model])
  const recommended = (list: string[]) => suggestModel(list)
  const applying = c('Saved. The AI engine restarted with the new setting.', '已保存，AI 引擎已按新设置重启。', '保存しました。新しい設定で AI エンジンを再起動しました。')
  const levels: [Reasoning, string][] = [['off', c('Off', '关闭', 'オフ')], ['low', c('Low', '低', '低')], ['medium', c('Medium', '中', '中')], ['high', c('High', '高', '高')]]
  const setFallback = (f: FallbackChoice | null) => void run('fallback', () => window.tomo.setFallback(f), applying)

  return (
    <>
      <section className="settings-section" data-testid="model-usage">
        <h2>{c('Model & usage', '模型与用量', 'モデルと利用状況')}</h2>
        <div className="setting-row">
          <div><strong>{c('Provider', '服务商', 'プロバイダー')}</strong><span>{active ? `${name(active.id)}${state.keyHint ? ` · ${state.keyHint}` : ''}` : '—'}</span></div>
          {active && connections.length > 1 && (
            <select className="setting-value setting-select" data-testid="provider-in-use" value={active.id} disabled={!!busy} onChange={(e) => void run('provider', () => window.tomo.useProvider(e.target.value as ProviderId), applying)} aria-label={c('Provider', '服务商', 'プロバイダー')}>
              {connections.map((x) => <option key={x.id} value={x.id}>{name(x.id)}</option>)}
            </select>
          )}
        </div>
        <div className="setting-row">
          <div><strong>{c('Model', '模型', 'モデル')}</strong><span>{active?.model ?? '—'}</span></div>
          {models && models.models.length > 1 && (
            <select className="setting-value setting-select" value={active?.model} disabled={!!busy} onChange={(e) => void run('model', () => window.tomo.setModel(e.target.value))} aria-label={c('Model', '模型', 'モデル')}>
              {models.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
        <div className="setting-row">
          <div><strong>{c('Thinking level', '思考等级', '思考レベル')}</strong><span>{c('Higher is slower and costs more; Hermes uses only levels the model supports.', '等级越高越慢、费用越高；只会使用模型支持的等级。', '高いほど遅く費用もかかります。モデルが対応するレベルだけを使います。')}</span></div>
          <div className="segmented" role="radiogroup" aria-label={c('Thinking level', '思考等级', '思考レベル')}>
            {levels.map(([v, label]) => (
              <button key={v} role="radio" aria-checked={(active?.reasoning ?? 'low') === v} className={(active?.reasoning ?? 'low') === v ? 'active' : ''} disabled={!ready || !!busy} onClick={() => void run('reasoning', () => window.tomo.setReasoning(v))}>{label}</button>
            ))}
          </div>
        </div>
      </section>

      {active && (
        <section className="settings-section" data-testid="fallback">
          <h2>{c('Fallback', '备用服务', '予備のサービス')}</h2>
          {others.length === 0 ? (
            <div className="setting-row">
              <div>
                <strong>{c('No fallback', '没有备用服务', '予備なし')}</strong>
                <span data-testid="fallback-note">{c(
                  `Connect a second provider to keep answering when ${name(active.id)} can't (limit reached, outage, key rejected).`,
                  `再连接一个服务，${name(active.id)} 无法回答时（额度用完、服务中断、Key 失效）也能继续。`,
                  `もう 1 つ接続すると、${name(active.id)} が使えないとき（上限到達・障害・キー無効）も回答を続けられます。`,
                )}</span>
              </div>
              <button className="secondary" disabled={!!busy} onClick={() => setSheet(true)}>{c('Connect a provider…', '连接服务…', 'サービスを接続…')}</button>
            </div>
          ) : (
            <>
              <div className="setting-row">
                <div>
                  <strong>{c(`When ${name(active.id)} can't answer`, `${name(active.id)} 无法回答时`, `${name(active.id)} が使えないとき`)}</strong>
                  <span data-testid="fallback-note">{fbConn
                    ? c(
                        `Tomo switches to ${name(fbConn.id)} for that question when ${name(active.id)} hits its limit, has an outage or rejects the key, and tries ${name(active.id)} again next time.`,
                        `${name(active.id)} 额度用完、服务中断或 Key 失效时，这个问题改由 ${name(fbConn.id)} 回答；下一个问题会再先试 ${name(active.id)}。`,
                        `${name(active.id)} が上限到達・障害・キー無効のとき、その質問は ${name(fbConn.id)} が答えます。次の質問ではまた ${name(active.id)} を先に試します。`,
                      )
                    : c(`Off: when ${name(active.id)} can't answer, Tomo shows the error.`, `关闭：${name(active.id)} 无法回答时，Tomo 会显示错误。`, `オフ：${name(active.id)} が使えないときはエラーを表示します。`)}</span>
                </div>
                <select className="setting-value setting-select" data-testid="fallback-provider" value={fbConn?.id ?? ''} disabled={!!busy}
                  onChange={(e) => { const x = others.find((o) => o.id === e.target.value); setFallback(x ? { id: x.id, model: recommended(modelsOf(x)) } : null) }}
                  aria-label={c('Fallback provider', '备用服务', '予備のサービス')}>
                  <option value="">{c('Off', '关闭', 'オフ')}</option>
                  {others.map((x) => <option key={x.id} value={x.id}>{name(x.id)}</option>)}
                </select>
              </div>
              {fbConn && fb && (
                <div className="setting-row">
                  <div><strong>{c('Fallback model', '备用模型', '予備のモデル')}</strong><span>{c(`From ${name(fbConn.id)}`, `来自 ${name(fbConn.id)}`, `${name(fbConn.id)} のモデル`)}</span></div>
                  <select className="setting-value setting-select" data-testid="fallback-model" value={fb.model} disabled={!!busy} onChange={(e) => setFallback({ id: fbConn.id, model: e.target.value })} aria-label={c('Fallback model', '备用模型', '予備のモデル')}>
                    {modelsOf(fbConn).map((m) => <option key={m} value={m}>{m}{m === recommended(modelsOf(fbConn)) ? c(' · Recommended', ' · 推荐', ' · おすすめ') : ''}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          <p className="section-foot">
            <Icon name="lock" size={12} />
            {c(
              'Personal data protection applies to the fallback too: your name and student number stay masked. Answers from the fallback are marked in the chat.',
              '备用服务同样受个人数据保护：姓名和学号始终遮蔽。由备用服务给出的回答会在对话中标注。',
              '予備のサービスにも個人データ保護が適用され、氏名と学籍番号はマスクされたままです。予備が答えた回答はチャットに表示されます。',
            )}
          </p>
        </section>
      )}

      <section className="settings-section" data-testid="connections">
        <div className="section-head">
          <h2>{c('Connections', '已连接的服务', '接続済みのサービス')}</h2>
          <button className="secondary" data-testid="connect-provider" disabled={!!busy} onClick={() => setSheet(true)}>{c('Connect a provider…', '连接服务…', 'サービスを接続…')}</button>
        </div>
        {connections.map((x) => (
          <div className="setting-row" key={x.id} data-testid={`connection-${x.id}`}>
            <div>
              <strong>
                {name(x.id)}
                {x.id === active?.id && <em className="badge-pill active in-use">{c('In use', '使用中', '使用中')}</em>}
                {x.id === fbConn?.id && <em className="badge-pill">{c('Fallback', '备用', '予備')}</em>}
              </strong>
              <span><code>{x.id === 'openai' ? 'ChatGPT' : `${x.baseUrl && x.id === 'custom' ? x.baseUrl + ' · ' : ''}${x.keyHint ?? ''}`}</code></span>
            </div>
            <div className="row-actions">
              {x.id !== active?.id && (
                <>
                  <button className="secondary" disabled={!!busy} onClick={() => void run('provider', () => window.tomo.useProvider(x.id), applying)}>{c('Use', '使用', '使う')}</button>
                  <button className="danger-button" disabled={!!busy} onClick={() => void run('remove', () => window.tomo.removeProvider(x.id), applying)}>{c('Remove', '移除', '削除')}</button>
                </>
              )}
            </div>
          </div>
        ))}
        <p className="section-foot">
          <Icon name="lock" size={12} />
          {c("Keys are encrypted with your system's keychain (macOS) or DPAPI (Windows).", 'Key 使用系统的钥匙串（macOS）或 DPAPI（Windows）加密保存。', 'キーはシステムのキーチェーン（macOS）または DPAPI（Windows）で暗号化されます。')}
        </p>
      </section>

      {sheet && (
        <ProviderSheet
          gakuenAvailable={state.gakuenAvailable}
          onClose={() => setSheet(false)}
          onConnect={async (choice, key, list) => { setSheet(false); await run('provider', () => window.tomo.addProvider(choice, key, list), applying) }}
        />
      )}
    </>
  )
}
