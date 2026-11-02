// Text-layout audit (from the UI prototype): short labels (≤ 30 chars) that wrap inside a word, overflow or are
// clipped, and icons stretched or off-centre. Evaluate in the page; returns a list of findings.
export const SCAN = `(() => {
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const t = walker.currentNode; const txt = t.textContent.replace(/\\s+/g, ' ').trim()
    if (!txt || txt.length > 30) continue
    const el = t.parentElement; const cs = getComputedStyle(el)
    // descriptions under a setting title are sentences: wrapping is expected there
    if (el.closest('.setting-row > div') && el.tagName === 'SPAN') continue
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const r = document.createRange(); r.selectNodeContents(t)
    const rects = [...r.getClientRects()].filter(x => x.width > 0.5)
    if (!rects.length) continue
    const tops = new Set(rects.map(x => Math.round(x.top / 4)))
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : ''
    const p = el.parentElement; const pcls = p && typeof p.className === 'string' && p.className ? '.' + p.className.trim().split(/\\s+/)[0] : (p ? p.tagName.toLowerCase() : '')
    const sel = pcls + ' > ' + el.tagName.toLowerCase() + cls
    const pr = p ? p.getBoundingClientRect() : null; const er = el.getBoundingClientRect()
    if (tops.size > 1) out.push('WRAP  ' + sel + '  "' + txt + '"')
    else if (pr && pr.width > 0 && (er.right > pr.right + 2 || rects[rects.length-1].right > er.right + 2) && getComputedStyle(p).overflowX === 'visible') out.push('OVER  ' + sel + '  "' + txt + '"')
    else if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') out.push('CLIP  ' + sel + '  "' + txt + '"')
  }
  // layout: icons that got stretched by a layout rule (e.g. a flex child rule hitting the icon)
  for (const i of document.querySelectorAll('.icon')) {
    if (i.closest('.state-illustration')) continue
    const b = i.getBoundingClientRect()
    if (b.width > 26 || b.height > 26) out.push('ICON  ' + (i.parentElement?.className || i.parentElement?.tagName) + '  ' + Math.round(b.width) + 'x' + Math.round(b.height))
    // icons that are the only content of a small badge / mark must sit in its centre
    const p = i.parentElement
    if (p && p.children.length === 1 && !p.textContent.trim()) {
      const pr = p.getBoundingClientRect()
      if (pr.width > 0 && pr.width <= 40 && pr.height <= 40) {
        const dx = (b.left + b.width / 2) - (pr.left + pr.width / 2), dy = (b.top + b.height / 2) - (pr.top + pr.height / 2)
        if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) out.push('ICON-OFFCENTRE  ' + (p.className || p.tagName) + '  dx=' + dx.toFixed(1) + ' dy=' + dy.toFixed(1))
      }
    }
  }
  return out
})()`
