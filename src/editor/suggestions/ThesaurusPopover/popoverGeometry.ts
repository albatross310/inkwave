import type { Editor } from '@tiptap/react'
import { MAX_RIGHT_LS_EM, type LineRange } from './popoverConstants'

// Returns the PM position of el, or -1 on failure.
export function posOf(el: Element, editor: Editor): number {
  try { return editor.view.posAtDOM(el.firstChild ?? el, 0) } catch { return -1 }
}

// Rightmost visual char on the same line as rect, walking text nodes in paraEl.
// Known limitation: non-text inline content (images, widgets) is invisible to this
// walker — naturalLineRight will be underestimated. Fine for prose-only paragraphs.
export function measureNaturalLineRight(rect: DOMRect, pEl: Element): number {
  let right = rect.right
  const tw = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT)
  const rng = document.createRange()
  for (;;) {
    const nd = tw.nextNode() as Text | null
    if (!nd) break
    rng.setStart(nd, 0); rng.setEnd(nd, nd.length)
    const nr = rng.getBoundingClientRect()
    if (nr.bottom < rect.top - 2 || nr.top > rect.bottom + 2) continue
    for (let i = 0; i < nd.length; i++) {
      rng.setStart(nd, i); rng.setEnd(nd, i + 1)
      const cr = rng.getBoundingClientRect()
      if (cr.bottom >= rect.top && cr.top <= rect.bottom && cr.right > right) right = cr.right
    }
  }
  return right
}

// Computes negative letter-spacing range to absorb the focused word's min-width
// expansion without paragraph overflow.  Dispatched atomically with the min-width
// so there is no intermediate painted frame where the word is expanded but not yet
// compressed.
//
// .scas-red is display:inline-block (~45px box); midpoint±tolerance is used for
// same-line detection so adjacent-line chars inside the tall box are excluded.
export function computeLineCompressionRange(
  naturalTop: number, naturalBottom: number, naturalLineRight: number,
  naturalWidth: number, minWidth: number, wordFrom: number, wordTo: number,
  paraEl: Element, editor: Editor,
): LineRange | null {
  const midY = (naturalTop + naturalBottom) / 2
  const tol  = (naturalBottom - naturalTop) * 0.45

  let lineFrom: number | null = null, lineFromX = Infinity
  let lineTo:   number | null = null
  let nBefore = 0, nAfter = 0

  const w = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT)
  const r = document.createRange()
  for (;;) {
    const nd = w.nextNode() as Text | null
    if (!nd) break
    if (!nd.length) continue
    r.setStart(nd, 0); r.setEnd(nd, nd.length)
    const nr = r.getBoundingClientRect()
    if (nr.bottom < naturalTop - 2 || nr.top > naturalBottom + 2) continue
    for (let i = 0; i < nd.length; i++) {
      r.setStart(nd, i); r.setEnd(nd, i + 1)
      const cr = r.getBoundingClientRect()
      if (Math.abs((cr.top + cr.bottom) / 2 - midY) >= tol) continue
      try {
        const p = editor.view.posAtDOM(nd, i)
        if (p < wordFrom) { nBefore++; if (cr.left < lineFromX) { lineFromX = cr.left; lineFrom = p } }
        else if (p >= wordTo) { nAfter++; if (lineTo === null || p + 1 > lineTo) lineTo = p + 1 }
      } catch { /* skip non-editable nodes */ }
    }
  }

  if (nBefore + nAfter === 0) return null

  const paraRight = paraEl.getBoundingClientRect().right
  const slack = Math.max(0, paraRight - naturalLineRight)
  const exp   = Math.max(0, Math.ceil(minWidth) - naturalWidth)
  if (exp === 0) return null

  const fe  = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
  const fsz = parseFloat(fe ? window.getComputedStyle(fe).fontSize : '18') || 18

  // Keep the line's first word uncompressed (squeezing it would jitter the line start);
  // count its chars so the before-compression starts just after it.
  let fwc = 0
  if (lineFrom !== null) {
    const dz = editor.state.doc.content.size
    for (let p = lineFrom; p < wordFrom && p + 1 <= dz; p++) {
      try { const c = editor.state.doc.textBetween(p, p + 1); if (/[ \t\xa0]/.test(c)) break; fwc++ }
      catch { break }
    }
  }
  const firstWordEnd = (lineFrom ?? wordFrom) + fwc
  const nBeforeComp = nBefore - fwc

  const SAFETY    = 2   // px: keep the line just inside the margin so it never wraps on a tie

  const MAX_LS_EM = 0.08   // px-per-em cap that still reads without glyphs touching

  // GENTLE-RIGHT-RATE, EXCESS-LEFT. Spend the line's right slack first (free), then squeeze the
  // after-text — but only at MAX_RIGHT_LS_EM per character, so a word near the right margin with
  // few characters after it never gets crammed. Whatever the right can't absorb at that gentle
  // rate compresses the LEFT (before-text, up to the readability cap) instead — the box slides
  // left and a long synonym sits in the freed space. Short synonyms need no left compression, so
  // the word doesn't move.
  const nBC          = Math.max(0, nBeforeComp)
  const maxBeforeComp= nBC * MAX_LS_EM * fsz             // before-text may compress up to the readability cap
  const remaining    = Math.max(0, exp + SAFETY - slack) // expansion the free slack can't absorb
  const afterComp    = Math.min(remaining, nAfter * MAX_RIGHT_LS_EM * fsz)
  const beforeComp   = Math.min(maxBeforeComp, remaining - afterComp)

  const lsBeforeEm = nBC    > 0 ? Math.min(MAX_LS_EM, beforeComp / nBC    / fsz) : 0
  const lsAfterEm  = nAfter > 0 ? Math.min(MAX_LS_EM, afterComp  / nAfter / fsz) : 0

  // NOTE: we do NOT bail when both letter-spacings are 0. When the line has enough slack the box
  // expansion needs no compression — but the bare after-text was still pushed right by the wider
  // box and WILL slide back on commit. Emitting the (zero-spacing) range anyway means the after-
  // text is always wrapped in a span, which the FLIP commit (?flip=1) needs as a transform handle.
  // For the default snap path a 0-spacing span is a visual no-op.
  // Where the word sits inside the reserved box (= how far the box slid left, as a fraction
  // of the expansion): 0.5 ≈ centred, →0 left-edge, →1 right-edge — the left→right continuum.
  const alignFraction = exp > 0 ? Math.min(1, beforeComp / exp) : 0
  return { from: lineFrom ?? wordFrom, firstWordEnd, to: lineTo ?? wordTo, lsBeforeEm, lsAfterEm, alignFraction }
}
