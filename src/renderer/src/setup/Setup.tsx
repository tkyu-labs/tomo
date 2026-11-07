// First run: Welcome + language → Privacy → AI provider → School pack → Hatch → Browser → Finish.
import { useEffect, useState } from 'react'
import type { AppState, BrowserInfo, EngineProgress, FinishTask, PackSummary, ProviderChoice, TaskState } from '@shared/ipc'
import { pick, type Answers } from '@shared/pack/types'
import { useCopy, useLocale, type Locale } from '../i18n'
import { Icon, type IconName } from '../ui/Icon'
import { HatchPage, HatchSummary } from './HatchFlow'
import { passwordOk, PortablePasswordSetup } from './Portable'
import { activeHatch } from '@shared/pack/core-hatch'
import { ProviderSheet, providerLabel, suggestModel } from './ProviderSheet'

function EnginePill({ state, refresh }: { state: AppState; refresh: () => Promise<AppState> }) {
  const c = useCopy()
  const [p, setP] = useState<EngineProgress | undefined>(state.engine.progress)
  useEffect(() => window.tomo.onEngineProgress((e) => { setP(e); if (e.stage === 'done') void refresh() }), [refresh])
  if (state.engine.installed || p?.stage === 'done') {
    return (
      <span className="engine-pill ready" role="status" data-testid="engine-pill">
        <Icon name="check" size={11} />
        {c('AI engine ready', 'AI 引擎已就绪', 'AI エンジン準備完了')}
      </span>
    )
  }
  if (p?.stage === 'error') {
    return (
      <span className="engine-pill missing" role="alert" data-testid="engine-pill" title={p.detail}>
        <Icon name="info" size={11} />
        {c('AI engine could not be prepared', 'AI 引擎准备失败', 'AI エンジンを準備できませんでした')}
        <button className="link-button" onClick={() => { setP({ stage: 'download', percent: 0 }); void window.tomo.retryEnginePrep().catch(() => undefined) }}>{c('Try again', '重试', '再試行')}</button>
      </span>
    )
  }
  const pct = p?.percent ?? 0
  const what = {
    download: c('Downloading the AI engine', '正在下载 AI 引擎', 'AI エンジンをダウンロード中'),
    unpack: c('Unpacking the AI engine', '正在解压 AI 引擎', 'AI エンジンを展開中'),
    install: c('Installing the AI engine', '正在安装 AI 引擎', 'AI エンジンをインストール中'),
    browser: c('Preparing browser tools', '正在准备浏览器工具', 'ブラウザツールを準備中'),
  }[p?.stage ?? 'download'] ?? ''
  return (
    <span className="engine-pill" role="status" aria-live="polite" data-testid="engine-pill">
      <span className="engine-ring" style={{ ['--p' as string]: `${pct}%` }} aria-hidden="true" />
      {what}… {pct}%
    </span>
  )
}

const STEP = { welcome: 0, privacy: 1, ai: 2, pack: 3, hatch: 4, browser: 5, finish: 6 } as const
const FINISH_TASKS: FinishTask[] = ['engine', 'settings', 'profile', 'start', 'test']

export function Setup({ state, refresh, onDone }: { state: AppState; refresh: () => Promise<AppState>; onDone: () => void }) {
  const c = useCopy()
  const { locale, setLocale } = useLocale()
  // after removing the school pack only the general Hatch (and Finish) runs; everything else is set up already
  const [step, setStep] = useState<number>(state.hatchPending ? STEP.hatch : 0)
  const [packs, setPacks] = useState<PackSummary[]>([])
  const [packId, setPackId] = useState<string | null>(state.pack?.id ?? null)
  const [hatchPage, setHatchPage] = useState(0)
  const [answers, setAnswers] = useState<Answers>(() => (state.hatchPending ? { reply_language: state.prefs.locale } : {}))
  const [prefilled, setPrefilled] = useState<string[]>(() => (state.hatchPending ? ['reply_language'] : []))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [gakuenKey, setGakuenKey] = useState('')
  const [showGakuenKey, setShowGakuenKey] = useState(false)
  const [gakuenTesting, setGakuenTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browsers, setBrowsers] = useState<BrowserInfo[] | null>(null)
  const [chrome, setChrome] = useState<{ stage?: string; error?: string; skipped?: boolean }>({})
  useEffect(() => window.tomo.onChromeStage((stage) => setChrome((c) => ({ ...c, stage }))), [])
  const installChrome = async () => {
    setChrome({ stage: 'download' })
    const res = await window.tomo.installChrome()
    setChrome(res.ok ? {} : { error: res.message })
    setBrowsers(await window.tomo.findBrowsers())
  }
  const [tasks, setTasks] = useState<Record<FinishTask, { state: TaskState; detail?: string }>>(
    Object.fromEntries(FINISH_TASKS.map((t) => [t, { state: 'pending' }])) as Record<FinishTask, { state: TaskState }>,
  )
  const [finishResult, setFinishResult] = useState<{ ok: boolean; failed?: FinishTask } | null>(null)

  useEffect(() => { void window.tomo.listPacks().then(setPacks) }, [])
  useEffect(() => window.tomo.onSetupTask((u) => setTasks((t) => ({ ...t, [u.task]: { state: u.state, detail: u.detail } }))), [])
  useEffect(() => { if (step === STEP.browser && !browsers) void window.tomo.findBrowsers().then(setBrowsers) }, [step, browsers])

  const pack = packs.find((p) => p.id === packId)
  // no school pack ("My school is not listed"): Tomo's general Hatch takes the pack's place
  const hatch = activeHatch(pack?.hatch)
  const hatchPages = hatch.sections.length
  const inHatchQuestions = step === STEP.hatch && hatchPage < hatchPages

  const runFinish = () => {
    setFinishResult(null)
    setTasks(Object.fromEntries(FINISH_TASKS.map((t) => [t, { state: 'pending' }])) as Record<FinishTask, { state: TaskState }>)
    void window.tomo.finishSetup(answers).then(setFinishResult)
  }

  const steps = [
    c('Welcome', '欢迎', 'ようこそ'), c('Privacy', '隐私保护', 'プライバシー'), c('AI provider', 'AI 服务', 'AI サービス'),
    c('School pack', '选择学校', '学校パック'), c('Hatch', 'Hatch 问卷', 'Hatch質問'), c('Browser', '浏览器', 'ブラウザ'),
    c('Finish', '完成设置', '仕上げ'),
  ]

  // portable build: the password is set in the privacy step, before any key is stored
  const needsPassword = state.portable.enabled && !state.portable.hasPassword
  const [pw, setPw] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const next = async () => {
    setError(null)
    try {
      if (step === STEP.privacy && needsPassword) {
        await window.tomo.setPortablePassword(pw)
        await refresh()
      }
      if (step === STEP.pack) {
        await window.tomo.selectPack(packId)
        // the general Hatch replies in the app language unless the student picks another one
        if (!packId && answers.reply_language === undefined) { setAnswers((a) => ({ ...a, reply_language: locale })); setPrefilled((p) => [...p, 'reply_language']) }
      }
      // no school pack: no portal, so no browser step
      if (step === STEP.hatch && !packId) { runFinish(); setStep(STEP.finish); return }
      if (step + 1 === STEP.finish) runFinish()
      setStep(step + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const back = () => {
    if (step === STEP.hatch && hatchPage > 0) return setHatchPage(hatchPage - 1)
    if (step === STEP.finish && !packId) return setStep(STEP.hatch)
    setStep(step - 1)
  }

  // "Test" checks the key against GakuenAI and, when it works, connects with the suggested model right away
  const connectGakuen = async () => {
    setError(null)
    setGakuenTesting(true)
    try {
      const res = await window.tomo.listProviderModels({ id: 'gakuen', model: '' }, gakuenKey.trim())
      if (!res.ok || !res.models) {
        throw new Error(res.error === 'wrong-key'
          ? c('GakuenAI did not accept this key. Check that you copied all of it.', 'GakuenAI 不接受这个 Key，请确认是否完整复制。', 'GakuenAI がこのキーを受け付けませんでした。すべてコピーしたか確認してください。')
          : res.error === 'no-credit'
            ? c('GakuenAI says the account of this key has no balance. Ask whoever gave you the key, or top it up, then press Test again.', 'GakuenAI 显示这个 Key 所在账户的余额不足。请联系提供 Key 的人，或充值后再点“测试”。', 'GakuenAI によると、このキーのアカウントに残高がありません。キーをくれた人に確認するか、チャージしてから、もう一度「テスト」を押してください。')
            : res.error === 'no-models'
              ? c('The key works, but GakuenAI listed no chat models.', 'Key 可用，但 GakuenAI 没有返回可用的对话模型。', 'キーは有効ですが、GakuenAI に利用できるチャットモデルがありません。')
              : c('Cannot reach GakuenAI. Check your network.', '无法连接 GakuenAI，请检查网络。', 'GakuenAI に接続できません。ネットワークを確認してください。'))
      }
      await window.tomo.connectProvider({ id: 'gakuen', model: suggestModel(res.models), reasoning: 'low' }, gakuenKey.trim(), res.models)
      setGakuenKey('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGakuenTesting(false)
    }
  }
  const connect = async (choice: ProviderChoice, key?: string, models?: string[]) => {
    await window.tomo.connectProvider(choice, key, models)
    await refresh()
    setSheetOpen(false)
  }

  const finishDone = finishResult?.ok === true
  const canContinue =
    (step !== STEP.ai || !!state.provider) && (step !== STEP.finish || finishDone) && !(step === STEP.privacy && needsPassword && !passwordOk(pw, pwConfirm)) && !(step === STEP.browser && chrome.stage)

  return (
    <main className="standalone-page onboarding-page">
      <div className="hatch-shell">
        <div className="hatch-brand">
          <div className="brand-mark">伴</div>
          <strong>Tomo</strong>
          <EnginePill state={state} refresh={refresh} />
        </div>
        <div className="setup-progress" aria-label="Setup progress">
          {steps.map((label, i) => (
            <div className={`${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} key={label}>
              <span>{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <div className="setup-card" data-step={step}>
          {step !== STEP.hatch && <span className="eyebrow">{c('Stage', '阶段', 'ステージ')} {step + 1} / {steps.length}</span>}

          {step === STEP.welcome && (
            <>
              <div className="setup-visual"><Icon name="language" size={30} /></div>
              <h1>{c('Welcome to Tomo', '欢迎使用 Tomo', 'Tomoへようこそ')}</h1>
              <p>{c('Your private, multilingual student assistant. Choose your preferred app language to get started.', '你的私密、多语言学生助手。选择你偏好的应用语言开始使用。', 'プライバシーを重視した、多言語対応の学生アシスタントです。言語を選択して開始してください。')}</p>
              <div className="setup-language-grid">
                {([['en', 'English'], ['zh', '简体中文'], ['ja', '日本語']] as [Locale, string][]).map(([code, name]) => (
                  <button className={locale === code ? 'selected' : ''} key={code} onClick={() => setLocale(code)}>
                    <Icon name="language" size={16} />
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === STEP.privacy && (
            <>
              <div className="setup-visual"><Icon name="shield" size={30} /></div>
              <h1>{c('How privacy works in Tomo', 'Tomo 的隐私保护原则', 'Tomoのプライバシー保護')}</h1>
              <p>{c('Your data is protected before it ever leaves this computer.', '在任何数据离开这台电脑前，均已得到严格的本地保护。', 'データがこの端末から送信される前に、厳格な保護が行われます。')}</p>
              <div className="privacy-principles">
                {([
                  ['lock', c('Masked first', '先遮蔽', '先にマスキング'), c('Your name and student number are replaced by placeholders on this computer before any AI model sees them.', '姓名和学号在本机先替换成占位符，AI 模型看不到真实身份。', '氏名や学籍番号は、AI モデルに届く前にこの端末でプレースホルダーに置き換えます。')],
                  ['shield', c('Approval each time', '每次确认', '毎回承認'), c('Grades and other personal data are sent only after you approve each item.', '成绩等个人数据只有在你逐项批准后才会发送。', '成績などの個人データは、項目ごとに承認した後でのみ送信します。')],
                  ['key', c('No passwords', '不保存密码', 'パスワードなし'), c('Tomo never stores or types your portal password; you sign in yourself.', 'Tomo 从不保存或代填门户密码，登录由你自己完成。', 'Tomo はポータルのパスワードを保存も入力もしません。ログインはご自身で。')],
                ] as [IconName, string, string][]).map(([icon, title, detail]) => (
                  <div key={title}>
                    <Icon name={icon} size={18} />
                    <strong>{title}</strong>
                    <span>{detail}</span>
                  </div>
                ))}
              </div>
              {needsPassword && <PortablePasswordSetup value={pw} confirm={pwConfirm} onChange={setPw} onConfirm={setPwConfirm} />}
            </>
          )}

          {step === STEP.ai && (
            <>
              <div className="setup-visual"><Icon name="key" size={26} /></div>
              <h1>{c('Connect an AI provider', '连接 AI 服务', 'AI サービスを接続')}</h1>
              <p>{c('Tomo needs an AI provider to answer questions.', 'Tomo 需要连接一个 AI 服务才能回答问题。', 'Tomo が質問に答えるには、AI サービスへの接続が必要です。')}</p>
              {state.provider ? (
                <div className="connected-row" data-testid="connected-provider">
                  <Icon name="check" size={14} />
                  <div>
                    <strong>{providerLabel(state.provider.id)}</strong>
                    <span>{state.provider.model}{state.keyHint ? ` · ${state.keyHint}` : ''}</span>
                  </div>
                  <button className="secondary" onClick={() => setSheetOpen(true)}>{c('Change…', '更换…', '変更…')}</button>
                </div>
              ) : (
                <div className="setup-key">
                  {state.gakuenAvailable && (
                    <>
                      <label className="setup-key-text" htmlFor="gakuen-key">{c('If you have a GakuenAI key, enter it here:', '如果你有 GakuenAI Key，可以直接在这里填入：', 'GakuenAI キーをお持ちなら、ここに入力してください：')}</label>
                      <div className="key-input-row">
                        <input id="gakuen-key" data-testid="gakuen-key" type={showGakuenKey ? 'text' : 'password'} className="catalog-search-input" value={gakuenKey} onChange={(e) => { setGakuenKey(e.target.value); setError(null) }} onKeyDown={(e) => e.key === 'Enter' && gakuenKey.trim() && !gakuenTesting && void connectGakuen()} placeholder="sk-…" autoComplete="off" spellCheck={false} />
                        <button className="secondary" data-testid="gakuen-key-show" onClick={() => setShowGakuenKey(!showGakuenKey)} aria-label={showGakuenKey ? c('Hide key', '隐藏 Key', 'キーを隠す') : c('Show key', '显示 Key', 'キーを表示')} aria-pressed={showGakuenKey}><Icon name={showGakuenKey ? 'eye-slash' : 'eye'} size={14} /></button>
                        <button className="secondary" data-testid="gakuen-test" disabled={!gakuenKey.trim() || gakuenTesting} onClick={() => void connectGakuen()}>
                          {gakuenTesting ? c('Testing…', '测试中…', 'テスト中…') : c('Test', '测试', 'テスト')}
                        </button>
                      </div>
                      <p className="setup-key-text">{c('Or use your own key:', '或者你想使用你自己的 Key：', 'または、ご自身のキーを使う：')}</p>
                    </>
                  )}
                  <button className="secondary setup-key-choose" data-testid="other-provider" onClick={() => setSheetOpen(true)}>
                    {c('Choose an AI provider…', '选择 AI 服务…', 'AI サービスを選ぶ…')}
                  </button>
                </div>
              )}
            </>
          )}

          {step === STEP.pack && (
            <>
              <div className="setup-visual"><Icon name="box" size={30} /></div>
              <h1>{c('Choose your school pack', '选择你的学校能力包', '学校パックを選択')}</h1>
              <p>{c('A school pack adds your university’s knowledge, portal guide and first-run questions. Packs are made by the community and are not affiliated with the schools.', '学校能力包会加入你所在大学的资料、门户指南和初次设置问题。能力包由社区制作，与学校无隶属关系。', '学校パックは大学の情報、ポータルの案内、初回の質問を追加します。パックはコミュニティ製で、学校とは無関係です。')}</p>
              <div className="pack-card-list" role="radiogroup" aria-label={c('School pack', '学校能力包', '学校パック')} style={{ marginTop: 0 }}>
                {packs.map((p) => (
                  <div key={p.id} role="radio" aria-checked={packId === p.id} tabIndex={0} className={`pack-card ${packId === p.id ? 'selected' : ''}`} data-testid={`pack-${p.id}`} onClick={() => setPackId(p.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPackId(p.id)}>
                    <span className="pack-check" aria-hidden="true"><Icon name="check" size={12} /></span>
                    <div className="pack-card-header">
                      <div className="pack-card-title-group">
                        <Icon name="box" size={20} />
                        <div>
                          <h3>{pick(p.manifest.name, locale)}</h3>
                          <p className="pack-card-school"><span lang="ja">{p.manifest.school.short}</span> · {p.manifest.school.domain} · v{p.manifest.version} · {p.manifest.publisher.name}</p>
                        </div>
                      </div>
                      <span className="badge-pill community">{c('Community pack', '社区贡献包', 'コミュニティパック')}</span>
                    </div>
                  </div>
                ))}
                <div role="radio" aria-checked={packId === null} tabIndex={0} className={`pack-card ${packId === null ? 'selected' : ''}`} data-testid="pack-none" onClick={() => setPackId(null)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPackId(null)}>
                  <span className="pack-check" aria-hidden="true"><Icon name="check" size={12} /></span>
                  <div className="pack-card-header">
                    <div className="pack-card-title-group">
                      <Icon name="shield" size={20} />
                      <div>
                        <h3>{c('My school is not listed', '我的学校不在列表中', '通っている学校が見つからない')}</h3>
                        <p className="pack-card-school">{c('Continue with Tomo only (general help, no school data)', '仅使用 Tomo 基础版（通用帮助，无学校资料）', 'Tomoコアのみで継続（一般的な支援、学内データなし）')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === STEP.hatch && (
            <>
              <div className="hatch-page-header" data-testid="hatch-header" data-hatch={pack ? 'pack' : 'general'}>
                <div className="hatch-page-meta">
                  <span>{pack ? pick(pack.manifest.name, locale) : 'Tomo'}</span>
                  <span className="hatch-counter">
                    {hatchPage < hatchPages ? c(`Page ${hatchPage + 1} of ${hatchPages}`, `第 ${hatchPage + 1} / ${hatchPages} 页`, `${hatchPage + 1} / ${hatchPages} ページ`) : c('Summary', '汇总', 'まとめ')}
                  </span>
                </div>
                <h1>{hatchPage < hatchPages ? pick(hatch.sections[hatchPage]!.title, locale) : c('Check your answers', '核对你的回答', '回答の確認')}</h1>
                {hatchPage < hatchPages && hatch.sections[hatchPage]!.intro && <p className="hatch-page-intro">{pick(hatch.sections[hatchPage]!.intro, locale)}</p>}
              </div>
              {hatchPage < hatchPages ? (
                <HatchPage hatch={hatch} sectionIndex={hatchPage} answers={answers} prefilled={prefilled} onAnswers={(a, p) => { setAnswers(a); setPrefilled(p) }} lang={locale} />
              ) : (
                <HatchSummary hatch={hatch} answers={answers} lang={locale} onEdit={setHatchPage} />
              )}
            </>
          )}

          {step === STEP.browser && (
            <>
              <div className="setup-visual"><Icon name="external" size={26} /></div>
              <h1>{c('Browser for web tasks', '用于网页操作的浏览器', 'Web 操作用のブラウザ')}</h1>
              <p>{c('Tomo can open school sites in a browser window you can see, after you approve each action. It uses its own browser profile and never touches your everyday one.', '在你逐项批准后，Tomo 可以在一个你看得见的浏览器窗口里打开学校网站。它使用自己独立的浏览器配置，不会动你平时用的那个。', '操作を一つずつ承認すると、Tomo は見えるブラウザウィンドウで学校のサイトを開けます。専用のブラウザプロファイルを使い、普段のものには触れません。')}</p>
              <div className="permission-list">
                {browsers === null ? (
                  <div className="permission-row"><span className="spinner" /></div>
                ) : browsers.length ? (
                  browsers.slice(0, 1).map((b) => (
                    <div className="permission-row" key={b.path} data-testid="browser-found">
                      <span className="ok"><Icon name="check" size={14} /></span>
                      <div>
                        <strong>{b.name}</strong>
                        <small>{c('Found · used with a Tomo profile', '已找到 · 使用 Tomo 专用配置', '見つかりました · Tomo 専用プロファイルで使用')}</small>
                      </div>
                      <b>{c('Ready', '就绪', '準備完了')}</b>
                    </div>
                  ))
                ) : (
                  <div className="permission-row" data-testid="browser-missing">
                    <span className="warn"><Icon name="info" size={14} /></span>
                    <div>
                      <strong>Google Chrome</strong>
                      <small>
                        {chrome.stage === 'download' && c('Downloading from Google…', '正在从 Google 下载…', 'Google からダウンロードしています…')}
                        {chrome.stage === 'verify' && c("Checking Google's signature…", '正在校验 Google 的签名…', 'Google の署名を確認しています…')}
                        {chrome.stage === 'copy' && c('Installing to your Applications folder…', '正在安装到你的“应用程序”文件夹…', 'アプリケーションフォルダーにインストールしています…')}
                        {!chrome.stage && !chrome.skipped && (chrome.error ?? c('Not installed. Tomo can install it for you (no administrator password needed).', '尚未安装。Tomo 可以帮你安装（无需管理员密码）。', '未インストールです。Tomo がインストールできます（管理者パスワード不要）。'))}
                        {!chrome.stage && chrome.skipped && c('Skipped · web tasks are off until a browser is installed', '已跳过 · 安装浏览器之前网页操作不可用', 'スキップしました · ブラウザを入れるまで Web 操作はオフです')}
                      </small>
                    </div>
                    {chrome.stage ? <span className="spinner" /> : (
                      <div className="row-actions">
                        {!chrome.skipped && <button className="secondary" onClick={() => setChrome({ skipped: true })}>{c('Skip', '跳过', 'スキップ')}</button>}
                        {navigator.userAgent.includes('Mac') && <button className="primary" data-testid="install-chrome" onClick={() => void installChrome()}>{c('Install Chrome', '安装 Chrome', 'Chrome をインストール')}</button>}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <p className="setup-footnote">{c('Screen and accessibility permissions are asked only when a task first needs them.', '屏幕录制和辅助功能权限只在任务第一次需要时才会请求。', '画面収録とアクセシビリティの権限は、タスクで初めて必要になったときにだけ確認します。')}</p>
            </>
          )}

          {step === STEP.finish && (
            <>
              <div className="setup-visual"><Icon name={finishDone ? 'check' : 'cpu'} size={26} /></div>
              <h1>{finishDone ? c('Tomo is ready', 'Tomo 已就绪', 'Tomo の準備ができました') : c('Finishing setup', '正在完成设置', '設定を仕上げています')}</h1>
              <p>{finishDone ? c('Everything is set up on this computer.', '所有设置都已在这台电脑上完成。', 'このコンピューターでの設定がすべて完了しました。') : c('Tomo is putting your answers into its AI engine.', 'Tomo 正在把你的设置写入 AI 引擎。', '回答を AI エンジンに反映しています。')}</p>
              <ul className="task-list" data-testid="finish-tasks">
                {FINISH_TASKS.map((t) => {
                  const st = tasks[t]
                  const label: Record<FinishTask, [string, string]> = {
                    engine: [c('Prepare the AI engine', '准备 AI 引擎', 'AI エンジンを準備'), c("Hermes from GitHub, installed in Tomo's folder", '从 GitHub 获取 Hermes，安装在 Tomo 的文件夹里', 'GitHub から Hermes を取得し、Tomo のフォルダーにインストール')],
                    settings: [c('Save your settings', '保存设置', '設定を保存'), c('Keys go to the system keychain', 'Key 存入系统钥匙串', 'キーはシステムのキーチェーンへ')],
                    profile: [c("Create Tomo's profile of you", '创建你的个人资料', 'あなたのプロフィールを作成'), c('Identifiers only as placeholders', '身份信息只写成占位符', '識別子はプレースホルダーのみ')],
                    start: [c('Start the AI engine', '启动 AI 引擎', 'AI エンジンを起動'), c('Runs on this computer, no network port', '在本机运行，不占用网络端口', 'このコンピューターで動作し、ネットワークポートは使いません')],
                    test: [c(`Test ${state.provider ? providerLabel(state.provider.id) : 'the AI provider'}`, `测试 ${state.provider ? providerLabel(state.provider.id) : 'AI 服务'}`, `${state.provider ? providerLabel(state.provider.id) : 'AI サービス'} をテスト`), c('Sends one short test request', '发送一次简短的测试请求', '短いテストリクエストを 1 回送信')],
                  }
                  return (
                    <li key={t} className={`task ${st.state}`} data-task={t} data-state={st.state}>
                      <span className="task-mark" aria-hidden="true">
                        {st.state === 'done' ? <Icon name="check" size={11} /> : st.state === 'error' ? <Icon name="close" size={10} /> : st.state === 'running' ? <span className="spinner" /> : null}
                      </span>
                      <div>
                        <strong>{label[t][0]}</strong>
                        <span>{st.state === 'error' ? st.detail : label[t][1]}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {finishResult && !finishResult.ok && (
                <div className="task-actions">
                  <button className="secondary" onClick={() => void window.tomo.diagnostics().then((d) => navigator.clipboard?.writeText(d))}>{c('Copy diagnostics', '复制诊断信息', '診断情報をコピー')}</button>
                  {finishResult.failed === 'test' || finishResult.failed === 'settings' ? (
                    <button className="primary" onClick={() => setStep(STEP.ai)}>{c('Change AI provider', '更换 AI 服务', 'AI サービスを変更')}</button>
                  ) : null}
                  <button className="primary" onClick={runFinish}>{c('Try Again', '重试', '再試行')}</button>
                </div>
              )}
            </>
          )}

          {error && <p className="hatch-note error" role="alert">{error}</p>}

          <div className="setup-actions">
            {step > 0 && step !== STEP.finish && (
              <button className="secondary" onClick={back}>
                {step === STEP.hatch && hatchPage > 0 ? c('Previous', '上一页', '前へ') : c('Back', '返回', '戻る')}
              </button>
            )}
            {step === STEP.welcome ? (
              <button className="primary setup-start" data-testid="setup-next" onClick={() => setStep(1)}>{c('Get Started', '开始使用', 'はじめる')}</button>
            ) : inHatchQuestions ? (
              <button className="primary" data-testid="setup-next" onClick={() => setHatchPage(hatchPage + 1)}>
                {hatchPage === hatchPages - 1 ? c('Review answers', '查看汇总', '回答を確認') : c('Next', '下一页', '次へ')}
                <Icon name="chevron" size={15} />
              </button>
            ) : (
              <button className="primary" data-testid="setup-next" disabled={!canContinue} onClick={() => (step === STEP.finish ? void window.tomo.completeSetup().then(onDone) : void next())}>
                {step === STEP.finish ? c('Start Using Tomo', '开始使用 Tomo', 'Tomo を使い始める') : c('Continue', '继续', '次へ')}
                {step !== STEP.finish && <Icon name="chevron" size={15} />}
              </button>
            )}
          </div>
        </div>
      </div>
      {/* nothing connected yet: GakuenAI has its own field on this step, so the sheet is for the other providers */}
      {sheetOpen && <ProviderSheet onClose={() => setSheetOpen(false)} onConnect={connect} gakuenAvailable={state.gakuenAvailable && !!state.provider} />}
    </main>
  )
}
