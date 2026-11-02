import { createContext, useContext } from 'react'
import type { Lang } from '@shared/pack/types'

export type Locale = Lang
export const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({ locale: 'en', setLocale: () => {} })

export const useLocale = () => useContext(LocaleContext)

/** Inline copy in three languages: c("English", "中文", "日本語"). */
export function useCopy() {
  const { locale } = useLocale()
  return (en: string, zh: string, ja: string) => (locale === 'zh' ? zh : locale === 'ja' ? ja : en)
}

/** The OS language decides the first-run default (requirements: default follows the OS). */
export function systemLocale(): Locale {
  const l = (navigator.language || 'en').toLowerCase()
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('zh')) return 'zh'
  return 'en'
}

export const htmlLang = (l: Locale) => (l === 'zh' ? 'zh-CN' : l)
