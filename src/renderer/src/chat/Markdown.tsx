// Small Markdown renderer for answers: paragraphs, headings, lists, code, tables, bold/italic, links.
// Builds React elements only (never raw HTML), so model output cannot inject markup.
import type { ReactNode } from 'react'

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k}>{inline(m[2].slice(2, -2), i)}</strong>)
    else if (m[3]) out.push(<em key={k}>{m[3].slice(1, -1)}</em>)
    else if (m[4]) out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer">{m[4].slice(1, m[4].indexOf(']'))}</a>)
    else if (m[6]) out.push(<a key={k} href={m[6]} target="_blank" rel="noreferrer">{m[6]}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (/^```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i]!)) body.push(lines[i++]!)
      i++
      blocks.push(<pre key={k++}><code>{body.join('\n')}</code></pre>)
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { blocks.push(<h4 key={k++} className={`md-h${h[1]!.length}`}>{inline(h[2]!, k)}</h4>); i++; continue }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(cells(lines[i++]!))
      blocks.push(
        <div className="md-table-wrap" key={k++}>
          <table className="md-table">
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, j)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={k++}>{items.map((it, j) => <li key={j}>{inline(it, j)}</li>)}</List>)
      continue
    }
    if (!line.trim()) { i++; continue }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+)/.test(lines[i]!) && !isTableRow(lines[i]!)) para.push(lines[i++]!)
    blocks.push(<p key={k++}>{para.flatMap((p, j) => (j ? [<br key={`br${j}`} />, ...inline(p, j)] : inline(p, j)))}</p>)
  }
  return <>{blocks}</>
}
