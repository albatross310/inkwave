// REFLOWING A PDF PAGE INTO PARAGRAPHS — the geometry half of the PDF reader view.
//
// Peter asked two things that turn out to be one thing: "do we have a way of altering the line
// spacing on the pdf to make it wider? Or to change the font", and later "build the reader view for
// pdfs". A fixed PDF layout structurally CANNOT do the first — every glyph is at a coordinate the
// publisher chose — so the answer to both is to stop drawing the page and re-set the TEXT.
//
// This module is PURE and knows nothing about pdf.js: it takes the text items already placed in
// viewport coordinates (the same items `textExtentsOf` and the pdf.js TextLayer read) and answers
// three questions:
//   1. which characters form which paragraph          → buildPageReflow
//   2. where in the reflowed text is this phrase       → anchorInPage   (page view → reader view)
//   3. which page rectangles does this text range cover→ rectsForRange  (reader view → page view)
// (2) and (3) are the SAME mapping read in opposite directions, which is why they live in one file:
// two implementations of "where is this text on the page" is exactly how the two views would drift
// apart, and a highlight that moves when you switch views is worse than one that admits it is lost.
//
// ⚠ NOTHING HERE MAY GUESS. `anchorInPage` returns null rather than a plausible offset, because a
// null is reported to the reader ("this mark could not be placed") while a wrong offset silently
// colours words they never marked — the refusal `src/reader/marks.ts` was written around.

import type { HighlightRect } from '../citations/pdfHighlights'

/** One pdf.js text item, already converted to viewport pixels (top-left origin, y down). */
export interface PlacedItem { str: string; x: number; y: number; w: number; h: number }

/** A slice of a block's text and the item it came from. Synthetic characters (a joining space, a
 *  dropped hyphen) belong to NO item and simply have no seg — so a rect is never invented for a
 *  character the page does not contain. */
export interface Seg { item: number; from: number; to: number }

export interface ReflowBlock {
  text: string
  segs: Seg[]
  /** Set on a line whose glyphs are meaningfully taller than the page's body text. A hint for
   *  rendering only — never used for anchoring, because a heading's TEXT is what identifies it. */
  heading: boolean
}

export interface PageReflow { blocks: ReflowBlock[]; items: PlacedItem[]; pageW: number; pageH: number }

interface Line { items: number[]; text: string; segs: Seg[]; top: number; bottom: number; left: number; right: number; size: number }

/** Median — used for the body line height, which every paragraph threshold is expressed in. A mean
 *  would be dragged around by one oversized heading or a page of footnotes. */
function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Group placed items into lines, then lines into paragraphs.
 *
 * The line rule is vertical OVERLAP, not equality of `y`: a superscript, a smaller footnote marker
 * and an italic run all sit at slightly different tops on the same printed line, and requiring
 * equal tops shatters every line that has one into two paragraphs.
 */
export function buildPageReflow(items: PlacedItem[], pageW: number, pageH: number): PageReflow {
  const keep: number[] = []
  for (let i = 0; i < items.length; i++) if (items[i].str && items[i].str.trim() !== '') keep.push(i)
  if (!keep.length) return { blocks: [], items, pageW, pageH }

  // ── items → lines ────────────────────────────────────────────────────────────────────────────
  const order = [...keep].sort((a, b) => {
    const A = items[a], B = items[b]
    const overlap = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y)
    if (overlap > Math.min(A.h, B.h) * 0.5) return A.x - B.x
    return A.y - B.y
  })

  const lines: Line[] = []
  for (const idx of order) {
    const it = items[idx]
    const cur = lines[lines.length - 1]
    const overlap = cur ? Math.min(it.y + it.h, cur.bottom) - Math.max(it.y, cur.top) : -1
    if (cur && overlap > Math.min(it.h, cur.bottom - cur.top) * 0.5 && it.x >= cur.left - 1) {
      // Same printed line. A gap wider than a quarter of the glyph height is a real word space that
      // the PDF drew by MOVING rather than by emitting a space character.
      const gap = it.x - cur.right
      let text = cur.text
      if (gap > it.h * 0.22 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' '
      cur.segs.push({ item: idx, from: text.length, to: text.length + it.str.length })
      cur.text = text + it.str
      cur.items.push(idx)
      cur.top = Math.min(cur.top, it.y); cur.bottom = Math.max(cur.bottom, it.y + it.h)
      cur.right = Math.max(cur.right, it.x + it.w)
      cur.size = Math.max(cur.size, it.h)
    } else {
      lines.push({ items: [idx], text: it.str, segs: [{ item: idx, from: 0, to: it.str.length }],
        top: it.y, bottom: it.y + it.h, left: it.x, right: it.x + it.w, size: it.h })
    }
  }
  for (const l of lines) { l.text = l.text.replace(/\s+$/, '') }

  // ── lines → paragraphs ───────────────────────────────────────────────────────────────────────
  const H = median(lines.map(l => l.bottom - l.top)) || 12
  const bodySize = median(lines.map(l => l.size)) || H
  const maxRight = Math.max(...lines.map(l => l.right))
  const paraLefts = lines.map(l => l.left)
  const bodyLeft = median(paraLefts)

  const blocks: ReflowBlock[] = []
  let cur: { text: string; segs: Seg[]; heading: boolean } | null = null
  let prev: Line | null = null

  const flush = () => { if (cur && cur.text.trim()) blocks.push({ ...cur }); cur = null }

  for (const l of lines) {
    if (!l.text.trim()) { continue }
    let brk = !prev
    if (prev) {
      const gap = l.top - prev.bottom
      // (a) a vertical gap much bigger than the leading — the blank line between paragraphs;
      // (b) a first-line INDENT — the other convention, used when there is no blank line;
      // (c) the previous line stopped well short of the right margin, so the paragraph ended there;
      // (d) the glyph size changed — a heading, a pull-quote, a footnote block.
      if (gap > H * 0.65) brk = true
      else if (l.left > bodyLeft + bodySize * 0.9) brk = true
      else if (prev.right < maxRight - bodySize * 2.2) brk = true
      else if (Math.abs(l.size - prev.size) > bodySize * 0.28) brk = true
      // A new COLUMN or a jump back UP the page is always a break, whatever the gap says.
      if (l.top < prev.top - H * 0.5) brk = true
    }
    if (brk) { flush(); cur = { text: '', segs: [], heading: l.size > bodySize * 1.22 } }
    const c = cur!
    let joiner = ''
    if (c.text) {
      // DE-HYPHENATE: a line ending in a hyphen before a lower-case continuation is a word the
      // typesetter split. Reflowed text must not carry the split — "iden- tity" is not a word, and
      // it would also defeat every search over the reflowed text.
      if (/[\p{L}]-$/u.test(c.text) && /^[\p{Ll}]/u.test(l.text)) c.text = c.text.slice(0, -1)
      else joiner = ' '
    }
    const base = c.text.length + joiner.length
    for (const s of l.segs) c.segs.push({ item: s.item, from: base + s.from, to: base + s.to })
    c.text += joiner + l.text
    prev = l
  }
  flush()

  // Segs are clipped to the block text that survived (trailing-space trims above can leave a seg
  // pointing past the end). A seg that outruns its text would produce a rect for a character that
  // is not there.
  for (const b of blocks) {
    b.segs = b.segs
      .map(s => ({ item: s.item, from: Math.min(s.from, b.text.length), to: Math.min(s.to, b.text.length) }))
      .filter(s => s.to > s.from)
  }
  return { blocks, items, pageW, pageH }
}

export function blockTexts(r: PageReflow): string[] { return r.blocks.map(b => b.text) }

// ── page view → reader view ──────────────────────────────────────────────────────────────────────

/** Collapse the whitespace a PDF selection carries (line breaks, double spaces, NBSPs). */
function norm(s: string): string { return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim() }

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/**
 * Find `text` in one page's reflowed blocks and return the anchor to store on the mark.
 *
 * THE RETURNED `text` IS A LITERAL SLICE OF THE BLOCK, never the caller's string. That is what lets
 * `locateMark` (src/reader/marks.ts) re-find it later with a plain indexOf: the normalisation and
 * de-hyphenation happen ONCE, here, at creation, instead of being re-guessed on every load.
 *
 * Returns null when the phrase is not in this page's text — the refusal. A selection that spans two
 * pages, or lands on a scanned image with no text layer, has no honest anchor and gets none.
 */
export function anchorInPage(
  blocks: ReflowBlock[],
  text: string,
  hintBlock = 0,
): { block: number; start: number; text: string } | null {
  const needle = norm(text)
  if (needle.length < 2) return null
  // Search outward from the hint so a phrase that occurs twice on the page resolves to the copy
  // nearest where the reader actually was.
  const order: number[] = []
  for (let d = 0; d < blocks.length; d++) {
    if (d === 0) { if (hintBlock >= 0 && hintBlock < blocks.length) order.push(hintBlock) }
    else { if (hintBlock - d >= 0) order.push(hintBlock - d); if (hintBlock + d < blocks.length) order.push(hintBlock + d) }
  }
  for (const bi of order) {
    const hay = blocks[bi].text
    const at = hay.indexOf(needle)
    if (at >= 0) return { block: bi, start: at, text: needle }
    // Whitespace-flexible: the selection crossed a line break, so its spacing is the PAGE's, not the
    // reflowed text's. Optional hyphen+space between every pair of characters covers the words the
    // typesetter split — the same de-hyphenation buildPageReflow applied, read from the other side.
    const flexible = needle.split(/\s+/).map(escapeRe).join('[\\s\\u00ad-]+')
    let m = new RegExp(flexible).exec(hay)
    if (!m) {
      const loose = [...needle.replace(/\s+/g, '')].map(escapeRe).join('-?\\s*')
      m = new RegExp(loose).exec(hay)
    }
    if (m) return { block: bi, start: m.index, text: hay.slice(m.index, m.index + m[0].length) }
  }
  return null
}

// ── reader view → page view ──────────────────────────────────────────────────────────────────────

/**
 * The page rectangles covered by [start,end) of a block, NORMALISED to the page box — exactly the
 * shape `redrawOverlays` already draws. This is what makes a highlight made in the reader view show
 * up in the page view: the rect is not a second source of truth, it is derived from the same segs.
 *
 * Within one item the x position is interpolated by character count. That is the same approximation
 * the pdf.js text layer makes when it stretches a span to the item's measured width, so a selection
 * in either view lands on the same glyphs.
 */
export function rectsForRange(r: PageReflow, block: number, start: number, end: number): HighlightRect[] {
  const b = r.blocks[block]
  if (!b || !(r.pageW > 0) || !(r.pageH > 0) || end <= start) return []
  const raw: Array<{ x: number; y: number; w: number; h: number }> = []
  for (const s of b.segs) {
    const from = Math.max(s.from, start), to = Math.min(s.to, end)
    if (to <= from) continue
    const it = r.items[s.item]
    if (!it) continue
    const len = s.to - s.from
    const f0 = (from - s.from) / len, f1 = (to - s.from) / len
    raw.push({ x: it.x + f0 * it.w, y: it.y, w: Math.max(1, (f1 - f0) * it.w), h: it.h })
  }
  if (!raw.length) return []
  // Merge neighbours on the same printed line — one rect per line reads as a highlighter stroke;
  // one rect per pdf.js item reads as a row of coloured bricks with white seams between the words.
  raw.sort((a, b2) => (Math.abs(a.y - b2.y) > Math.min(a.h, b2.h) * 0.5 ? a.y - b2.y : a.x - b2.x))
  const merged: typeof raw = []
  for (const q of raw) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(q.y - last.y) <= Math.min(q.h, last.h) * 0.5 && q.x <= last.x + last.w + q.h * 0.6) {
      const right = Math.max(last.x + last.w, q.x + q.w)
      last.y = Math.min(last.y, q.y)
      last.h = Math.max(last.h, q.h)
      last.w = right - last.x
    } else merged.push({ ...q })
  }
  return merged.map(m => ({ x: m.x / r.pageW, y: m.y / r.pageH, w: m.w / r.pageW, h: m.h / r.pageH }))
}

/** A block's bounding box on the page, normalised. Null when no seg resolves to a real item. */
export function blockBox(r: PageReflow, block: number): HighlightRect | null {
  const b = r.blocks[block]
  if (!b || !(r.pageW > 0) || !(r.pageH > 0)) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of b.segs) {
    const it = r.items[s.item]
    if (!it) continue
    x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y)
    x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h)
  }
  if (!Number.isFinite(x0)) return null
  return { x: x0 / r.pageW, y: y0 / r.pageH, w: (x1 - x0) / r.pageW, h: (y1 - y0) / r.pageH }
}

/**
 * The block nearest a normalised page point — how a TEXT BOX gets an anchor.
 *
 * Peter: "yes anchor text boxes at nearest text." A note dropped at page coordinates has no meaning
 * in a reflowed column (the coordinates describe a layout that is no longer being drawn), so the
 * note is attached to the paragraph it was nearest and travels with it. Paragraph-level placement,
 * which he accepted; the alternative is a note that floats in the margin of nothing.
 */
export function nearestBlock(r: PageReflow, xn: number, yn: number): number | null {
  let best: number | null = null, bestD = Infinity
  for (let i = 0; i < r.blocks.length; i++) {
    const bb = blockBox(r, i)
    if (!bb) continue
    const dx = xn < bb.x ? bb.x - xn : xn > bb.x + bb.w ? xn - (bb.x + bb.w) : 0
    const dy = yn < bb.y ? bb.y - yn : yn > bb.y + bb.h ? yn - (bb.y + bb.h) : 0
    // Vertical distance dominates: a note in the right margin belongs to the line beside it, not to
    // the paragraph above that happens to be horizontally nearer.
    const d = Math.hypot(dx * 0.35, dy)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/** The anchor phrase a text note gets: the opening of its block, enough to identify it uniquely. */
export function noteAnchorText(blockText: string, max = 60): string {
  const t = norm(blockText)
  return t.length <= max ? t : t.slice(0, max)
}
