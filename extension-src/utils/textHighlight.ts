// Hover-to-source highlighter.
// Finds a citation's stored source quote in the page and highlights it by wrapping the matched
// text in a <span> styled via CSSOM. We do NOT use the CSS Custom Highlight API: highlights set
// from a content script's isolated world are not painted by the page (world-scoped registry), and
// the ::highlight() stylesheet rule is blocked by strict page CSP. CSSOM style-setting (elem.style.x)
// is exempt from CSP and works from the isolated world, so wrapping is the reliable path.
// Also descends into OPEN shadow roots (CNET/YouTube bylines live in web components) which a plain
// TreeWalker skips. Falls back silently on no-match. See citations spec §8.

// A text node with its position in the page-flat normalised string, plus a map from
// normalised-offset → raw-offset so a match in the flat string resolves to real DOM offsets.
interface TextNode { node: Text; start: number; end: number; map: number[] }

// Per-node normaliser that ALSO returns map[normIndex] = rawIndex (map[normed.length] = raw length),
// so we can translate a match offset in the collapsed/normalised text back to an offset in the live
// DOM text node (whitespace collapse + char folding change the length, so a 1:1 offset is wrong).
// No NFC here — NFC can shift indices and break the mapping; targets (bylines/dates) are ASCII.
function normNodeMapped(raw: string): { normed: string; map: number[] } {
  let out = ''
  const map: number[] = []
  let prevSpace = false
  for (let i = 0; i < raw.length; i++) {
    let c = raw[i]
    const code = raw.charCodeAt(i)
    // Drop soft hyphen + zero-width characters entirely.
    if (code === 0x00ad || (code >= 0x200b && code <= 0x200f) || code === 0x2060 || code === 0xfeff) continue
    // Whitespace (incl. NBSP / narrow / figure spaces) → collapse runs to a single space.
    if (code === 0x00a0 || code === 0x2007 || code === 0x202f || /\s/.test(c)) {
      if (prevSpace) continue
      out += ' '; map.push(i); prevSpace = true; continue
    }
    prevSpace = false
    if (code === 0x2018 || code === 0x2019) c = "'"
    else if (code === 0x201c || code === 0x201d) c = '"'
    else if (code === 0x2013 || code === 0x2014) c = '-'
    else c = c.toLowerCase()
    out += c; map.push(i)
  }
  map.push(raw.length)
  return { normed: out, map }
}

// Needle normaliser (no map needed) — same folding + trim.
function norm(s: string): string {
  return normNodeMapped(s).normed.replace(/\s+/g, ' ').trim()
}

// Depth-first collect every text node (including inside OPEN shadow roots), skipping the Inkwave
// panel itself so we never highlight our own UI copy of the value.
function collectTextNodes(root: Node): { flat: string; nodes: TextNode[] } {
  const nodes: TextNode[] = []
  const parts: string[] = []
  let pos = 0
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = (node as Text).parentElement
      if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT')) return
      const raw = (node as Text).textContent ?? ''
      if (!raw) return
      const { normed, map } = normNodeMapped(raw)
      if (!normed) return
      parts.push(normed)
      nodes.push({ node: node as Text, start: pos, end: pos + normed.length, map })
      pos += normed.length
      return
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      if (el.id === 'inkwave-capture-panel') return // never highlight our own panel text
      const tag = el.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return
      // Skip HIDDEN subtrees so the flat text matches innerText. Live pages (YouTube, CNET) render
      // the title/byline MANY times in display:none scaffolding (17× for a channel name); without
      // this the regex matches the first — a hidden 0×0 copy — and highlights nothing visible.
      try {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') return
      } catch { /* detached / no view — fall through and include it */ }
      const sr = (el as HTMLElement).shadowRoot // open shadow roots only (closed → null)
      if (sr) visit(sr)
    }
    for (const child of Array.from(node.childNodes)) visit(child)
  }
  visit(root)
  return { flat: parts.join(''), nodes }
}

// The spans we injected for the current highlight, so we can unwrap them cleanly.
let activeMarks: HTMLElement[] = []

/** Remove the current source highlight, restoring the DOM to its original text. */
export function clearHighlight(): void {
  for (const mark of activeMarks) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    try { (parent as Element).normalize?.() } catch { /* ignore */ }
  }
  activeMarks = []
}

/**
 * Highlight `quote` in the page by wrapping the matched text in styled <span>s.
 * Returns true if a match was found and highlighted, false otherwise.
 */
export function highlightQuote(quote: string): boolean {
  try {
    clearHighlight()
    const needle = norm(quote)
    if (!needle) return false

    const { flat, nodes } = collectTextNodes(document.body)

    // Allow \s+ between words: adjacent text nodes can each contribute whitespace, producing a
    // double space in the flat string where the needle has one.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = escaped.replace(/ /g, '\\s+')
    const match = new RegExp(pattern).exec(flat)
    if (!match) return false

    const gStart = match.index
    const gEnd = gStart + match[0].length

    // Resolve the match to concrete DOM offsets across every text node it spans.
    const segs: Array<{ node: Text; rawStart: number; rawEnd: number }> = []
    for (const n of nodes) {
      if (n.end <= gStart || n.start >= gEnd) continue
      const ls = Math.max(gStart, n.start) - n.start   // normalised offsets within this node
      const le = Math.min(gEnd, n.end) - n.start
      if (ls >= le) continue
      const rawStart = n.map[ls]
      const rawEnd = n.map[le]
      if (rawStart == null || rawEnd == null || rawStart >= rawEnd) continue
      segs.push({ node: n.node, rawStart, rawEnd })
    }
    if (!segs.length) return false

    // Scroll FIRST, independent of wrapping — a found match must always "snap" even if the colour
    // wrap hits an edge case. Window scroll (the site's own scroll container would swallow
    // scrollIntoView).
    try {
      const scrollRange = document.createRange()
      scrollRange.setStart(segs[0].node, segs[0].rawStart)
      scrollRange.setEnd(segs[segs.length - 1].node, segs[segs.length - 1].rawEnd)
      const rect = scrollRange.getBoundingClientRect()
      const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      // Vertical: always centre. Horizontal: only when the match is off-screen left/right (e.g. a
      // zoomed-in page overflows the viewport width) — otherwise keep the current x so we don't jerk
      // sideways on a normally-visible match.
      const offRight = rect.right > window.innerWidth
      const offLeft = rect.left < 0
      const left = (offLeft || offRight)
        ? Math.max(0, window.scrollX + rect.left - window.innerWidth / 2 + rect.width / 2)
        : window.scrollX
      window.scrollTo({
        top: Math.max(0, window.scrollY + rect.top - window.innerHeight / 2),
        left,
        behavior: motionOk ? 'smooth' : 'auto',
      })
    } catch { /* scroll is best-effort */ }

    // Colour: wrap each segment in a CSSOM-styled span. Forward order is safe — wrapping node N
    // splits only node N's text; later nodes keep their identity + offsets.
    const marks: HTMLElement[] = []
    for (const s of segs) {
      try {
        const r = document.createRange()
        r.setStart(s.node, s.rawStart)
        r.setEnd(s.node, s.rawEnd)
        const mark = document.createElement('span')
        mark.className = 'inkwave-source-mark'
        // Inline CSSOM styles — exempt from page CSP, and paint reliably from the isolated world.
        mark.style.cssText = 'background-color:rgba(48, 36, 56, 0.9);color:#fff;border-radius:2px;box-shadow:0 0 0 2px rgba(48, 36, 56, 0.9)'
        r.surroundContents(mark)
        marks.push(mark)
      } catch { /* skip nodes that resist wrapping */ }
    }
    activeMarks = marks
    return true
  } catch {
    return false
  }
}
