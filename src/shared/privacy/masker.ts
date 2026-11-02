// Identifier masking, TypeScript twin of plugins/tomo-privacy/masking.py (same rules, same shared test cases in
// test/fixtures/masking-cases.json). Used by the main process before `prompt.submit` and on every gateway event
// before logging; the renderer only unmasks for display.

export interface IdentifierEntry {
  /** Placeholder variable, e.g. STUDENT_NUMBER. */
  name: string
  values: string[]
  kind?: 'id' | 'name'
  label?: string
}

export const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g
const SPACE = '[\\s\\u3000]*'
const ALNUM_EDGE = '0-9A-Za-z\\uFF10-\\uFF19\\uFF21-\\uFF3A\\uFF41-\\uFF5A'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function fullwidth(ch: string): string {
  const code = ch.codePointAt(0)!
  return code >= 0x21 && code <= 0x7e && /[0-9A-Za-z]/.test(ch) ? String.fromCodePoint(code + 0xfee0) : ch
}

function charClass(ch: string): string {
  const variants = new Set([ch, ch.normalize('NFKC'), fullwidth(ch)])
  if (variants.size === 1) return escape(ch)
  return '(?:' + [...variants].sort((a, b) => b.length - a.length).map(escape).join('|') + ')'
}

export class Masker {
  private patterns: [RegExp, string][] = []
  private byName = new Map<string, IdentifierEntry>()

  constructor(readonly identifiers: IdentifierEntry[]) {
    const entries: [string, IdentifierEntry][] = []
    for (const ident of identifiers) {
      this.byName.set(ident.name, ident)
      for (const raw of ident.values) {
        const value = (raw ?? '').normalize('NFKC').trim()
        if ([...value].length >= 2) entries.push([value, ident])
      }
    }
    entries.sort((a, b) => [...b[0]].length - [...a[0]].length)
    for (const [value, ident] of entries) {
      let pattern: string
      if (ident.kind === 'name') {
        pattern = value.split(/[\s\u3000]+/).filter(Boolean).map((part) => [...part].map(charClass).join('')).join(SPACE)
      } else {
        pattern = `(?<![${ALNUM_EDGE}])` + [...value].map(charClass).join('') + `(?![${ALNUM_EDGE}])`
      }
      this.patterns.push([new RegExp(pattern, 'giu'), `{{${ident.name}}}`])
    }
  }

  mask(text: string): string {
    if (!text) return text
    for (const [re, placeholder] of this.patterns) text = text.replace(re, placeholder)
    return text
  }

  /** Masks every string inside arrays / plain objects (keys included). */
  maskAny<T>(value: T): T {
    if (typeof value === 'string') return this.mask(value) as T
    if (Array.isArray(value)) return value.map((v) => this.maskAny(v)) as T
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[this.mask(k)] = this.maskAny(v)
      return out as T
    }
    return value
  }

  valueOf(name: string): string | undefined {
    return this.byName.get(name)?.values[0]
  }

  names(): string[] {
    return [...this.byName.keys()]
  }
}

/** Replace known placeholders with real values (display only). Unknown or altered placeholders stay visible. */
export function unmask(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (m, name: string) => values[name] ?? m)
}

/**
 * Unmasks a token stream whose chunks may split a placeholder ("{{STUD" + "ENT_NUMBER}}"). Holds back a trailing
 * fragment that could still become a placeholder and releases it once it is complete or clearly is not one.
 */
export class StreamUnmasker {
  private pending = ''

  constructor(private readonly values: Record<string, string>) {}

  push(chunk: string): string {
    const text = this.pending + chunk
    const cut = this.holdFrom(text)
    this.pending = text.slice(cut)
    return unmask(text.slice(0, cut), this.values)
  }

  flush(): string {
    const rest = unmask(this.pending, this.values)
    this.pending = ''
    return rest
  }

  private holdFrom(text: string): number {
    const open = text.lastIndexOf('{')
    if (open < 0) return text.length
    const start = open > 0 && text[open - 1] === '{' ? open - 1 : open
    const tail = text.slice(start)
    // A possible placeholder prefix: "{", "{{", "{{NAME", "{{NAME}" — hold it; anything else is released.
    if (/^\{(\{[A-Z0-9_]*\}?)?$/.test(tail) && tail.length <= 64) return start
    return text.length
  }
}
