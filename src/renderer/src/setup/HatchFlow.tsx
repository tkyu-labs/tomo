// Hatch questionnaire rendered from the pack's hatch.yaml: one page per section (setup questions only), then a
// summary with the USER.md Tomo will write. Ported from the UI prototype.
import { useState, type ReactNode } from "react"
import { HATCH_BUDGET, answerText, conditionHolds, isAnswered, prefills, setupQuestions, userMemoryEntries } from "@shared/pack/hatch"
import { pick, type Answer, type Answers, type Hatch, type HatchQuestion, type Lang, type MultiAnswer } from "@shared/pack/types"

const ui = {
  skip: { en: "Skip", zh: "跳过", ja: "スキップ" },
  skipped: { en: "Skipped", zh: "已跳过", ja: "スキップ" },
  other: { en: "Other…", zh: "其他…", ja: "その他…" },
  maxPick: { en: "Pick up to", zh: "最多选", ja: "最大" },
  name: { en: "Name", zh: "姓名", ja: "氏名" },
  furigana: { en: "Furigana (katakana reading)", zh: "フリガナ（片假名读音）", ja: "フリガナ" },
  invalid: { en: "This doesn't look right. Expected:", zh: "格式好像不对，应为：", ja: "形式が違うようです。想定：" },
  prefilled: { en: "Suggested from your student number", zh: "已根据学号预填", ja: "学籍番号から入力しました" },
  summary: { en: "What Tomo will remember", zh: "Tomo 将记住的内容", ja: "Tomo が覚える内容" },
  summaryIntro: {
    en: "This becomes Tomo's memory about you (Hermes USER.md). Identifiers appear only as placeholders.",
    zh: "这会成为 Tomo 关于你的记忆（Hermes 的 USER.md）。身份信息只以占位符出现。",
    ja: "これが Tomo の記憶（Hermes の USER.md）になります。識別子はプレースホルダーでのみ記録されます。",
  },
  empty: { en: "Nothing yet — all questions were skipped.", zh: "还没有内容 —— 所有问题都跳过了。", ja: "まだ何もありません。すべてスキップされました。" },
  later: { en: "Tomo asks these later, when the topic comes up", zh: "这些问题 Tomo 会在相关话题出现时再问", ja: "これらは話題になったときに Tomo が尋ねます" },
  answers: { en: "Your answers", zh: "你的回答", ja: "あなたの回答" },
  edit: { en: "Edit", zh: "修改", ja: "編集" },
  chars: { en: "characters of", zh: "字符，预算", ja: "文字／予算" },
  example: { en: "e.g. ", zh: "例：", ja: "例：" },
  savedAs: { en: "saved as", zh: "保存为", ja: "保存形式" },
  savedAsWhy: {
    en: "Only this computer keeps the real value. Tomo's AI engine and the AI model see the placeholder.",
    zh: "真实值只保存在这台电脑上，Tomo 的 AI 引擎和 AI 模型看到的是占位符。",
    ja: "実際の値はこのコンピューターにだけ保存され、Tomo の AI エンジンと AI モデルにはプレースホルダーが渡されます。",
  },
}

export function HatchPage({
  hatch,
  sectionIndex,
  answers,
  onAnswers,
  prefilled,
  lang,
}: {
  hatch: Hatch
  sectionIndex: number
  answers: Answers
  onAnswers: (next: Answers, prefilledIds: string[]) => void
  prefilled: string[]
  lang: Lang
}) {
  const section = hatch.sections[sectionIndex]!
  const questions = setupQuestions(hatch, section.id, answers)
  const set = (q: HatchQuestion, a: Answer | undefined) => {
    const next: Answers = { ...answers, [q.id]: a }
    const extra = prefills(hatch, q.id, next, prefilled)
    Object.assign(next, extra)
    // drop answers that point at options hidden by the new answer (e.g. a major of the other faculty)
    for (const other of hatch.questions) {
      const opts = other.options
      const cur = next[other.id]
      if (!opts || cur === undefined) continue
      const hidden = new Set(opts.filter((o) => !conditionHolds(o.when, next)).map((o) => o.value))
      if (!hidden.size) continue
      if (other.type === "multi") {
        const m = cur as MultiAnswer
        const kept = m.values.filter((v) => !hidden.has(v))
        if (kept.length !== m.values.length) next[other.id] = { ...m, values: kept }
      } else if (hidden.has(cur as string | number)) {
        next[other.id] = undefined
      }
    }
    onAnswers(next, [...prefilled.filter((id) => id !== q.id), ...Object.keys(extra)])
  }
  return (
    <div className="hatch-page">
      {questions.map((q) => (
        <QuestionField key={q.id} q={q} value={answers[q.id]} answers={answers} onChange={(a) => set(q, a)} lang={lang} prefilled={prefilled.includes(q.id)} />
      ))}
    </div>
  )
}

function QuestionField({
  q: rawQ,
  value,
  answers,
  onChange,
  lang,
  prefilled,
}: {
  q: HatchQuestion
  value: Answer | undefined
  answers: Answers
  onChange: (a: Answer | undefined) => void
  lang: Lang
  prefilled: boolean
}) {
  const t = (x: Record<Lang, string>) => x[lang]
  const [otherOpen, setOtherOpen] = useState(false)
  const [hint, setHint] = useState<string[] | null>(null)
  // options can depend on other answers (e.g. departments of the chosen faculty)
  const q: HatchQuestion = rawQ.options ? { ...rawQ, options: rawQ.options.filter((o) => conditionHolds(o.when, answers)) } : rawQ
  const hintProps = (o: { examples?: string[] }) =>
    o.examples?.length
      ? { title: o.examples.join("、"), onMouseEnter: () => setHint(o.examples!), onMouseLeave: () => setHint(null), onFocus: () => setHint(o.examples!), onBlur: () => setHint(null) }
      : {}
  const id = `hatch-${q.id}`
  const invalid = q.validate && typeof value === "string" && value.trim() && !new RegExp(q.validate).test(value.trim().toUpperCase())

  let control: ReactNode = null
  switch (q.type) {
    case "identifier":
      if (q.aliases?.length) {
        const v = (value ?? {}) as Record<string, string>
        control = (
          <div className={`hatch-aliases n${q.aliases.length}`}>
            {q.aliases.map((al) => (
              <input key={al} className="catalog-search-input" aria-label={t(ui[al])} placeholder={t(ui[al])} value={v[al] ?? ""} onChange={(e) => onChange({ ...v, [al]: e.target.value })} />
            ))}
          </div>
        )
      } else {
        control = (
          <input id={id} className="catalog-search-input mono" value={(value as string) ?? ""} placeholder={pick(q.placeholder, lang)} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        )
      }
      break
    case "text":
    case "municipality":
      control = <input id={id} className="catalog-search-input" value={(value as string) ?? ""} placeholder={pick(q.placeholder, lang)} onChange={(e) => onChange(e.target.value)} />
      break
    case "longtext": {
      const v = (value as string) ?? ""
      control = (
        <>
          <textarea id={id} className="catalog-search-input hatch-textarea" value={v} maxLength={q.max_length} placeholder={pick(q.placeholder, lang)} onChange={(e) => onChange(e.target.value)} rows={3} />
          {q.max_length && <span className="hatch-note right">{v.length} / {q.max_length}</span>}
        </>
      )
      break
    }
    case "number": {
      const [lo, hi] = q.range ?? [0, 0]
      control =
        hi - lo <= 6 ? (
          <div className="hatch-options-chips">
            {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((n) => (
              <button key={n} className={`hatch-chip-btn ${value === n ? "selected" : ""}`} onClick={() => onChange(value === n ? undefined : n)}>{n}</button>
            ))}
          </div>
        ) : (
          <select className="setting-value setting-select" value={(value as number) ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">—</option>
            {Array.from({ length: hi - lo + 1 }, (_, i) => hi - i).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )
      break
    }
    case "choice":
      control = (
        <div className="hatch-options-chips">
          {q.options!.map((o) => (
            <button key={String(o.value)} {...hintProps(o)} className={`hatch-chip-btn ${value === o.value ? "selected" : ""}`} onClick={() => onChange(value === o.value ? undefined : o.value)}>
              {pick(o.label, lang)}
            </button>
          ))}
          {q.allow_other && <OtherInput value={typeof value === "string" && !q.options!.some((o) => o.value === value) ? value : ""} onChange={(v) => onChange(v || undefined)} lang={lang} open={otherOpen} setOpen={setOtherOpen} />}
        </div>
      )
      break
    case "scale":
      control = (
        <div className="hatch-scale" role="radiogroup" aria-labelledby={`${id}-label`}>
          {q.options!.map((o) => (
            <label key={String(o.value)} className={`hatch-scale-row ${value === o.value ? "selected" : ""}`}>
              <input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span>{pick(o.label, lang)}</span>
            </label>
          ))}
        </div>
      )
      break
    case "multi": {
      const v = (value ?? { values: [] }) as MultiAnswer
      const full = !!q.max_select && v.values.length >= q.max_select
      const toggle = (val: string | number) => {
        const has = v.values.includes(val)
        if (!has && full) return
        onChange({ ...v, values: has ? v.values.filter((x) => x !== val) : [...v.values, val] })
      }
      control = (
        <div className="hatch-options-chips">
          {q.options!.map((o) => {
            const on = v.values.includes(o.value)
            return (
              <button key={String(o.value)} {...hintProps(o)} className={`hatch-chip-btn ${on ? "selected" : ""}`} disabled={!on && full} onClick={() => toggle(o.value)}>
                {pick(o.label, lang)}
              </button>
            )
          })}
          {q.allow_other && <OtherInput value={v.other ?? ""} onChange={(o) => onChange({ ...v, other: o })} lang={lang} open={otherOpen} setOpen={setOtherOpen} />}
        </div>
      )
      break
    }
  }

  return (
    <div className="hatch-question">
      <div className="hatch-question-head">
        <label id={`${id}-label`} htmlFor={id}>{pick(q.label, lang)}</label>
        {q.type === "multi" && q.max_select && <span className="hatch-note">{t(ui.maxPick)} {q.max_select}</span>}
      </div>
      <p className="hatch-why-line">{pick(q.why, lang)}</p>
      {control}
      {q.options?.some((o) => o.examples?.length) && (
        <span className="hatch-note examples" lang="ja">{hint ? `${t(ui.example)}${hint.join("、")}` : "\u00a0"}</span>
      )}
      {invalid && <span className="hatch-note error">{t(ui.invalid)} {pick(q.placeholder, lang) || q.validate}</span>}
      {prefilled && <span className="hatch-note ok">✓ {t(ui.prefilled)}</span>}
    </div>
  )
}

function OtherInput({ value, onChange, lang, open, setOpen }: { value: string; onChange: (v: string) => void; lang: Lang; open: boolean; setOpen: (b: boolean) => void }) {
  if (!open && !value) return <button className="hatch-chip-btn ghost" onClick={() => setOpen(true)}>{ui.other[lang]}</button>
  return <input className="catalog-search-input hatch-other" autoFocus={!value} value={value} onChange={(e) => onChange(e.target.value)} placeholder={ui.other[lang].replace("…", "")} />
}

export function HatchSummary({ hatch, answers, lang, onEdit }: { hatch: Hatch; answers: Answers; lang: Lang; onEdit: (sectionIndex: number) => void }) {
  const t = (x: Record<Lang, string>) => x[lang]
  const memory = userMemoryEntries(hatch, answers)
  const text = memory.join("\n§\n")
  const later = hatch.questions.filter((q) => q.ask === "later")
  return (
    <div className="hatch-summary">
      <h3>{t(ui.answers)}</h3>
      <div className="hatch-summary-list">
        {hatch.sections.map((sec, i) => {
          const qs = setupQuestions(hatch, sec.id, answers)
          return (
            <div className="hatch-summary-section" key={sec.id}>
              <div className="hatch-summary-section-head">
                <strong>{pick(sec.title, lang)}</strong>
                <button className="link-button" onClick={() => onEdit(i)}>{t(ui.edit)}</button>
              </div>
              {qs.map((q) => (
                <div className="hatch-summary-row" key={q.id}>
                  <span className="hatch-summary-label">{pick(q.label, lang)}</span>
                  <span className={`hatch-summary-val ${isAnswered(q, answers[q.id]) ? "" : "skipped"}`}>
                    {!isAnswered(q, answers[q.id])
                      ? t(ui.skipped)
                      : q.type === "identifier"
                        ? <>{identifierText(answers[q.id])}<span className="hatch-saved-as" title={t(ui.savedAsWhy)}>🔒 {t(ui.savedAs)} {`{{${q.variable}}}`}</span></>
                        : q.type === "multi" || q.type === "choice" || q.type === "scale"
                          ? localLabel(q, answers[q.id], lang)
                          : answerText(q, answers[q.id])}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <h3>{t(ui.summary)}</h3>
      <p className="hatch-why-line">{t(ui.summaryIntro)}</p>
      <pre className="user-md">{text || t(ui.empty)}</pre>
      <span className={`hatch-note right ${text.length > HATCH_BUDGET ? "error" : ""}`}>
        {text.length} {t(ui.chars)} {HATCH_BUDGET}
      </span>

      <h3>{t(ui.later)}</h3>
      <ul className="hatch-later">
        {later.map((q) => <li key={q.id}>{pick(q.label, lang)}</li>)}
      </ul>
    </div>
  )
}

function localLabel(q: HatchQuestion, a: Answer | undefined, lang: Lang) {
  const lab = (v: string | number) => q.options?.find((o) => o.value === v)?.label[lang] ?? String(v)
  if (q.type === "multi") {
    const m = a as MultiAnswer
    return [...m.values.map(lab), ...(m.other?.trim() ? [m.other.trim()] : [])].join(lang === "en" ? ", " : "、")
  }
  return lab(a as string)
}

function identifierText(a: Answer | undefined): string {
  if (typeof a === "string") return a
  if (a && typeof a === "object" && !("values" in a)) return Object.values(a as Record<string, string>).filter((v) => v?.trim()).join(" · ")
  return ""
}
