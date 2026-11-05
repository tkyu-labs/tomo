import type { Lang } from './pack/types'

/** Tomo's UI language for a BCP 47 tag from the OS (ja-JP → ja, zh-Hans-CN → zh, anything else → en). */
export function localeFromTag(tag: string | undefined): Lang {
  const l = (tag || 'en').toLowerCase()
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('zh')) return 'zh'
  return 'en'
}
