import type { Editor } from '@tiptap/react'
import type { LineRange } from './popoverConstants'

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

  // EQUAL BUFFERS. The reserved (widest-synonym) box is centred on the word: it extends
  // exp/2 to each side, so every synonym shows with an equal gap left and right and the
  // original keeps its natural x. Each side's extension is made by compressing that side's
  // text; the RIGHT side spends the line's slack before it has to compress (so we never
  // compress more than needed, and the trailing words can't wrap). If a side can't give its
  // half — too little text, or the readable cap — the shortfall moves to the other side, so
  // the box leans only at the true line edges (the left→right continuum).
  // fe carries min-width:naturalWidth here, so its rect is the word's natural box. rightRoom
  // is the room from the word's right edge to the margin — the most the box can grow right
  // before it (and the trailing words) would cross the margin and wrap.
  const wordRight = fe ? fe.getBoundingClientRect().right : naturalLineRight
  const rightRoom = Math.max(0, paraRight - wordRight)
  const SAFETY    = 2   // px: keep the line just inside the margin so it never wraps on a tie

  const MAX_LS_EM = 0.08   // px-per-em cap that still reads without glyphs touching

  // Total width the line must give up so the expanded box fits: the right slack absorbs part,
  // the rest is shared. Distribute it at a SINGLE uniform per-character rate across BOTH sides
  // — so a short side (e.g. a 2-letter trailing word) is never crushed into overlap; the long
  // side simply absorbs more total at the same gentle rate. (+SAFETY keeps the line a hair
  // inside the margin so it never wraps on a tie.)
  const compressTotal = exp > slack ? exp - slack + SAFETY : 0
  const nComp = Math.max(0, nBeforeComp) + nAfter
  const ls = nComp > 0 ? Math.min(MAX_LS_EM, compressTotal / nComp / fsz) : 0
  let beforeComp = Math.max(0, nBeforeComp) * ls * fsz
  let afterComp  = nAfter * ls * fsz

  // Box-fit: the box's right edge must not cross the margin, i.e. it must slide left at least
  // (exp − rightRoom). If the uniform split doesn't slide it far enough, move the shortfall
  // onto the before-side (long → still gentle), easing the after-side further.
  const minBefore = Math.max(0, exp - rightRoom)
  if (beforeComp < minBefore && nBeforeComp > 0) {
    const shift = Math.min(minBefore - beforeComp, afterComp)
    beforeComp += shift
    afterComp  -= shift
  }

  const lsBeforeEm = nBeforeComp > 0 ? Math.min(MAX_LS_EM, beforeComp / nBeforeComp / fsz) : 0
  const lsAfterEm  = nAfter > 0 ? Math.min(MAX_LS_EM, afterComp / nAfter / fsz) : 0

  if (lsBeforeEm === 0 && lsAfterEm === 0) return null
  // Where the word sits inside the reserved box (= how far the box slid left, as a fraction
  // of the expansion): 0.5 ≈ centred, →0 left-edge, →1 right-edge — the left→right continuum.
  const alignFraction = exp > 0 ? Math.min(1, beforeComp / exp) : 0
  return { from: lineFrom ?? wordFrom, firstWordEnd, to: lineTo ?? wordTo, lsBeforeEm, lsAfterEm, alignFraction }
}
