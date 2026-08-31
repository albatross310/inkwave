// THE CONTENT ANCHOR — keeping the reading line on the same WORDS across a snapshot step.
//
// Versions differ in LENGTH, so preserving the scroll OFFSET does not preserve the CONTENT:
// identical offsets, sliding text (measured on this pane: drift p50 186px per version step). So the
// midline holds a short TEXT SIGNATURE of whatever sits on it, and after the next snapshot renders
// we find that text again and scroll it back to the line. The document "scrolls around a bit" to
// keep the words put. Falls back to fractional anchoring when the anchored text was edited away.
//
// Extracted from SnapshotView.tsx verbatim. Two functions are exported; the four below them stay
// private, which is the whole interface: 150 lines of DOM measurement behind `what is on the line?`
// and `where do I scroll to put it back?`.
//
// ─── ONE RULE, ONE HOME ──────────────────────────────────────────────────────────────────────────
// `SIG_LEN`/`SIG_MIN` and the nearest-occurrence search are GONE from here. provenance/anchorMap.ts
// already declared `ANCHOR_LEN`/`ANCHOR_MIN` and `offsetOfNearest`, with comments reading "matches
// SnapshotView's SIG_LEN" and "the same tie-break the DOM search uses" — two implementations of one
// rule, kept in step by hand, and only the provenance copy had tests. They are now imported. The
// comments over there became true by construction instead of by vigilance.
//
// ⚠ WHY THE GEOMETRIC FALLBACK IS NOT OPTIONAL — it was dead code at load for as long as it existed.
// See `midlineSignature`.

import { ANCHOR_LEN, ANCHOR_MIN, offsetOfNearest } from '../provenance/anchorMap'

/** Cross-browser caret hit-test → the text node + offset at a viewport point. */
function caretAtPoint(x: number, y: number): { node: Text; offset: number } | null {
  // Firefox
  const anyDoc = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (anyDoc.caretPositionFromPoint) {
    const p = anyDoc.caretPositionFromPoint(x, y)
    if (p && p.offsetNode.nodeType === Node.TEXT_NODE) return { node: p.offsetNode as Text, offset: p.offset }
  }
  if (anyDoc.caretRangeFromPoint) {
    const r = anyDoc.caretRangeFromPoint(x, y)
    if (r && r.startContainer.nodeType === Node.TEXT_NODE) return { node: r.startContainer as Text, offset: r.startOffset }
  }
  return null
}

/** Global character offset of (node, offset) within root's textContent. */
export function globalOffsetOf(root: HTMLElement, node: Text, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  let n = walker.nextNode() as Text | null
  while (n) {
    if (n === node) return acc + offset
    acc += n.data.length
    n = walker.nextNode() as Text | null
  }
  return acc
}

/** Locate the text node + in-node offset for a global textContent offset. */
export function locateOffset(root: HTMLElement, globalOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  let n = walker.nextNode() as Text | null
  while (n) {
    const len = n.data.length
    if (acc + len >= globalOffset) return { node: n, offset: globalOffset - acc }
    acc += len
    n = walker.nextNode() as Text | null
  }
  return null
}

/** Global char offset of the character at content-y `y`, by BINARY SEARCH over Range rects — no
 *  hit-testing, so nothing that covers the pane can defeat it. Text lays out monotonically down a
 *  block flow, so ~log2(chars) rect reads find the line. (The pane is a handful of giant
 *  [data-opidx] spans, so each locateOffset walk is a few nodes, not a tree.) */
function offsetAtContentY(el: HTMLElement, y: number): number | null {
  const full = el.textContent ?? ''
  if (!full.length) return null
  const elRect = el.getBoundingClientRect()
  const zf = elRect.width > 0 && el.offsetWidth > 0 ? elRect.width / el.offsetWidth : 1
  const range = document.createRange()
  const topAt = (i: number): number => {
    const loc = locateOffset(el, i)
    if (!loc || !loc.node.data.length) return NaN
    const off = Math.min(loc.offset, loc.node.data.length - 1)
    try {
      range.setStart(loc.node, off)
      range.setEnd(loc.node, Math.min(off + 1, loc.node.data.length))
      const r = range.getBoundingClientRect()
      if (!r.height && !r.width) return NaN
      return (r.top - elRect.top) / zf + el.scrollTop
    } catch { return NaN }
  }
  let lo = 0, hi = full.length - 1
  for (let g = 0; g < 40 && lo < hi; g++) {
    const mid = (lo + hi) >> 1
    const t = topAt(mid)
    if (Number.isNaN(t)) { lo = mid + 1; continue } // collapsed/hidden run — step past it
    if (t < y) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The text signature currently sitting on the midline (or null if not over text).
 *
 *  The caret hit-test is the fast path, but it reads the TOPMOST element at the point — and at
 *  mount the LoadingVeil covers this pane, so it returned the veil (not a text node) and the
 *  anchor came back null. This effect only re-runs on a snapshot/mode change, so the anchor then
 *  stayed null for the WHOLE SESSION unless the reader happened to scroll: content anchoring was
 *  silently never engaging at load and every reposition fell back to the RATIO (probed 2026-07-17:
 *  23/23 warm layers took `ratio.nosig`). Hence the overlay-immune geometric fallback. */
export function midlineSignature(el: HTMLElement): string | null {
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + el.clientHeight / 2
  const caret = caretAtPoint(x, y)
  const globalOffset = caret
    ? globalOffsetOf(el, caret.node, caret.offset)
    : offsetAtContentY(el, el.scrollTop + el.clientHeight / 2)
  if (globalOffset == null) return null
  const sig = (el.textContent ?? '').slice(globalOffset, globalOffset + ANCHOR_LEN)
  return sig.trim().length >= ANCHOR_MIN ? sig : null
}

/** scrollTop that places `sig` on the midline, preferring the occurrence nearest ratioBias. */
export function scrollTopForSignature(el: HTMLElement, sig: string, ratioBias: number): number | null {
  const full = el.textContent ?? ''
  // Full signature first; if the anchor text was lightly edited, retry a shorter prefix.
  let at = offsetOfNearest(full, sig, ratioBias)
  if (at < 0) {
    const short = sig.slice(0, 28)
    if (short.trim().length < ANCHOR_MIN) return null
    at = offsetOfNearest(full, short, ratioBias)
    if (at < 0) return null
  }
  const loc = locateOffset(el, at)
  if (!loc) return null
  const range = document.createRange()
  const end = Math.min(loc.offset + 1, loc.node.data.length)
  range.setStart(loc.node, Math.min(loc.offset, loc.node.data.length))
  range.setEnd(loc.node, end)
  const rect = range.getBoundingClientRect()
  if (!rect.height && !rect.top) return null
  const elRect = el.getBoundingClientRect()
  const targetTopInContent = rect.top - elRect.top + el.scrollTop
  return targetTopInContent - el.clientHeight / 2
}
