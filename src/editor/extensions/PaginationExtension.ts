// PAGE-BREAK MEASUREMENT for both page modes: a PM plugin that measures the document's real line
// layout and places a widget at each page boundary — a tall "page gap" when gapped, a zero-size
// MARKER at the SAME positions when not. ONE shared break model, so toggling the switch never moves
// content across pages and screen breaks == print/PDF breaks.
//
// THE RULES, each of them a live bug once:
//   1. ⚠ BREAKS ARE CANONICAL. Every measure runs inside a forced canonical context
//      (canonicalMeasure.ts: mm paper width, desktop side margins, zoom 1, 1.125rem base), so a
//      break is a DOCUMENT POSITION identical at every zoom, on phone and desktop, and in print.
//      The live layout affects RENDERING only. Provenance page labels and the print path depend on
//      this. → docs/archive/pagination-rounds.md#canonical-measure
//   2. ⚠ PAGE HEIGHT COMES FROM `pageModel` (physical mm through the 96dpi reference px), NEVER
//      `sheet.clientWidth` — its integer rounding flips with browser zoom/DPR (R9).
//   3. ⚠ THE MEASURE IS LOOP-FREE: block positions are read as INTRINSIC (gap-widget heights
//      subtracted back out), so adding gaps cannot change the measured layout, and a signature
//      guard stops the recompute→dispatch→recompute cycle once nothing moves.
//   4. ⚠ CLEAR THE GAPS BEFORE MEASURING. A gap widget is display:block and FORCES a line break, so
//      measuring with them present shows the forced break, not the natural wrap — deletions never
//      reflowed back. The cleared state never paints (same synchronous window).

import { Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { getPaperSize, getOrientation, getTopMarginPx, getSideMarginPx, getColumns, getParaSpacingEm, MARGIN_BOTTOM } from '../pageSettings'
import { pageBoxPx } from '../pageModel'
import { isLineRect, sameLine } from '../lineRects'
import { forceCanonicalContext } from '../canonicalMeasure'
import { buildArithMeasure, arithBlockLayout } from '../arithMeasure'
import { makeCanvasMeasure, canvasShapingMatchesEditor, type Measure } from '../arithmeticLayout'
import { scaleFor } from '../magnify'
import { stepToZoom, zoomToStep, ZOOM_STEP_MIN, ZOOM_STEP_MAX } from '../zoomStep'
import { planLiveWarm } from '../zoomWarm'
// gapEl + GAP/PHONE_PAGE_MARGIN/phoneLike live in pageGap.ts — shared with the snapshot view's
// static paginator (staticPagination.ts) so both build byte-identical gap DOM.
import { PHONE_PAGE_MARGIN, PHONE_PAGE_MARGIN_BOTTOM, GAP, PHONE_GAP, PHONE_SHEET_RADIUS, phoneLike, gapEl } from '../pageGap'
import { bibProvider } from '../../citations/bibProvider'
import { harvestCiteBoxes, clearCiteBoxes } from '../../citations/citeBox'
import { getCitationStyle } from '../../citations/citationsBus'
import { notePerf, probePerf } from '../perflog'

const KEY = new PluginKey<DecorationSet>('pagination')
export const MARGIN_TOP = 72 // px parchment margin at the top of every page (incl. page 1)
export { MARGIN_BOTTOM } // moved to pageSettings — see note there (shell-chunk weight)

// ── Decision 6: ARITHMETIC canonical measure (flag `inkwave:arithLayout`, default OFF) ──────────
// The third acquisition path — see arithMeasure.ts. Flag cached; toggling needs a reload, as usual.
let _arithLayoutFlag: boolean | null = null
function arithLayoutOn(): boolean {
  if (_arithLayoutFlag !== null) return _arithLayoutFlag
  // ⚠ DEFAULT OFF, AND DO NOT FLIP IT ON A CHROMIUM PROOF ALONE — canonical breaks are a
  // CROSS-DEVICE invariant, so graduation needs a WebKit pass on Peter's device class plus a
  // scoped-arith typing A/B. The engine also no longer implements `shouldSnapToBlock`, which is now
  // the first blocker. → docs/archive/pagination-rounds.md#arith-engine
  try { _arithLayoutFlag = typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:arithLayout') === '1' } catch { _arithLayoutFlag = false }
  return _arithLayoutFlag
}
const arithMeasureFn = makeCanvasMeasure() // one cached canvas 2d measure, shared across measures
function arithFaceLoaded(stack: string, sizePx: number): boolean {
  try { const fam = stack.split(',')[0].replace(/['"]/g, '').trim(); return typeof document !== 'undefined' && document.fonts.check(`${sizePx}px "${fam}"`) } catch { return false }
}

// ── Decision 1: RENDER-FILL phone splits (flag `inkwave:renderFill`, default OFF) ───────────────
// Peter: "abandon perfect pagination for the better look." Mid-paragraph splits at the RENDER width
// so the last line before a split FILLS.
// ⚠ IT DIVERGES FROM CANONICAL, so it is gated to the LIVE PHONE EDITOR and must NEVER touch
// print/export/verify/snapshot — those force the canonical measure via measure-now → forceFullOnce,
// which this path skips. Phone page numbers then differ from print: an accepted consequence.
// → docs/archive/pagination-rounds.md#canonical-measure
let _renderFillFlag: boolean | null = null
function renderFillOn(): boolean {
  if (_renderFillFlag !== null) return _renderFillFlag
  try { _renderFillFlag = typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:renderFill') === '1' } catch { _renderFillFlag = false }
  return _renderFillFlag
}

// ── Job 2: ARITH ZOOM-EXIT (flag `inkwave:arithBands`, default OFF) ─────────────────────────────
// The pinch exit un-skips the whole document and forces one full relayout to re-pin the anchor —
// O(doc), measured 240/722/2688ms at 5k/20k/40k words. Computing the bands arithmetically lets it
// keep the content-visibility window ON and lay out only what is on screen.
// ⚠ Gated on whole-doc eligibility AND the empirical shaping gate; anything else returns null and
// the caller falls back to the un-skip, which is always correct (R8).
// → docs/archive/pagination-rounds.md#arith-bands
let _arithBandsFlag: boolean | null = null
function arithBandsOn(): boolean {
  if (_arithBandsFlag !== null) return _arithBandsFlag
  try { _arithBandsFlag = typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:arithBands') === '1' } catch { _arithBandsFlag = false }
  return _arithBandsFlag
}

export interface PaginationOptions {
  enabled: boolean // measure page breaks at all (the live editor; off for headless/snapshot use)
  gapped: boolean  // true: tall gap widgets + sheet panels; false: zero-size break markers
}

// Collect every LINE as { intrinsic top, LAZY doc position } — so a page break can land
// mid-paragraph (a gap widget at a line start splits the paragraph in two).
//
//   1. ⚠ "INTRINSIC" MEANS THE LAYOUT AS IF NO GAP WIDGETS EXISTED, and the gap heights above a
//      line are subtracted BY SCREEN Y, never by walking top-level children — a gap can render
//      NESTED inside a paragraph, and missing its height makes page heights drift and oscillate.
//      Intrinsic tops are invariant to the gaps, so the pagination is a stable fixpoint.
//   2. `scale` is the transform-magnify: rects come back VISUAL while pageH is unscaled, so every
//      measured distance divides by it. scale = 1 is a no-op.
//   3. ⚠ POSITIONS STAY LAZY. Only ~1 line per PAGE ever needs one, and the eager version cost
//      ~4,400 hit-tests on a 100-page doc. Each line carries the coords the old call sampled, so
//      the formula — and therefore every break position — is identical.
//   4. ⚠ THE LINE CACHE IS KEYED BY PM NODE IDENTITY (a WeakMap): an untouched block is the same
//      node and renders the same canonical geometry, so only changed blocks are re-measured.
//      · the caller REPLACES the map whenever the canonical CONTEXT changes — fonts, page settings,
//        bibliography label hydration (R7);
//      · NEVER pass it for fluid 'scroll' paper, whose canonical width IS the live width;
//      · entries are written/read ONLY on the gap-free measure, so gap subtraction can never bake
//        into a cached top.
//   5. ⚠ AN INLINE ATOM CONTRIBUTES EXACTLY ONE RECT — its own bounding box. It has no internal
//      break opportunity, and its interior boxes survived the 3px dedup as PHANTOM LINES whose
//      sample point sits MID-LINE, opening page gaps in the middle of rendered lines. Atomhood
//      comes from ProseMirror (`isInline && isAtom`), NEVER a CSS class, which would silently miss
//      the next NodeView (R9). SCOPE: inline atoms only — a TOP-LEVEL atom (refList, block math) is
//      `atomLike` and keeps its pseudo-block-per-line treatment.
// → docs/archive/pagination-rounds.md#collect-lines · #inline-atom-rect
function inlineAtomRoots(view: EditorView, child: PMNode, offset: number): Element[] {
  const roots: Element[] = []
  child.descendants((node, pos) => {
    if (!node.isInline || !node.isAtom) return true
    const el = view.nodeDOM(offset + 1 + pos)
    if (el && (el as Node).nodeType === 1) roots.push(el as Element)
    return false // an atom's interior is opaque to the line collector by definition
  })
  return roots
}

// ─── A CONTAINER'S ELEMENT CHILDREN ARE NOT LINES (the list break fix) ────────────────────────
// ⚠ A RECT MAY ONLY BE ADMITTED IF IT *IS* A LINE — the same principle as the inline-atom rule
// above, one level up. `selectNodeContents(el).getClientRects()` also returns the border box of
// every element it contains, and a `<li>`/`<blockquote>` box is a CONTAINER of lines: admitted, its
// sample point (`top + height/2`) lands on the item's SECOND line, so the break resolves one line
// late and the page carries more than its own text area allows.
// ⚠ So rects come per TEXTBLOCK, and PM decides what a textblock is (`node.isTextblock`) — never a
// tag name or a CSS class, which would silently miss the next container node (R9). A block that IS
// a textblock takes the byte-identical old path by construction.
// → docs/archive/pagination-rounds.md#container-rects
export function textblockEls(view: EditorView, child: PMNode, offset: number, el: HTMLElement): HTMLElement[] {
  if (child.isTextblock) return [el] // the overwhelming case — unchanged, one range, as before
  const out: HTMLElement[] = []
  child.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const d = view.nodeDOM(offset + 1 + pos)
    if (d && (d as Node).nodeType === 1) out.push(d as HTMLElement)
    return false // a textblock's interior is its own line collection
  })
  // No textblock inside (a container of atoms, or an unmapped subtree) ⇒ fall back to the whole
  // element rather than lose the block's lines entirely.
  return out.length ? out : [el]
}

// The block's line rects, with each inline-atom subtree contributing its single bounding rect.
// Text between atoms is measured by ranges exactly as before, so rects stay in document order and
// the 3px same-line dedup downstream is untouched.
export function blockLineRects(el: HTMLElement, atoms: Element[]): DOMRect[] {
  const range = document.createRange()
  if (!atoms.length) { // no NodeViews ⇒ EXACTLY the original call
    range.selectNodeContents(el)
    return Array.from(range.getClientRects())
  }
  // Outermost atoms only, in document order (a nested atom is already inside its parent's box).
  const roots = atoms
    .filter((a) => el.contains(a) && !atoms.some((o) => o !== a && o.contains(a)))
    .sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  const out: DOMRect[] = []
  let curNode: Node = el, curOff = 0
  const flushTo = (endNode: Node, endOff: number) => {
    try {
      range.setStart(curNode, curOff)
      range.setEnd(endNode, endOff)
      if (!range.collapsed) for (const r of Array.from(range.getClientRects())) out.push(r)
    } catch { /* an unmappable boundary — skip the segment rather than fabricate a line */ }
  }
  for (const a of roots) {
    const parent = a.parentNode
    if (!parent) continue
    const idx = Array.prototype.indexOf.call(parent.childNodes, a)
    if (idx < 0) continue
    flushTo(parent, idx)                    // the text before this atom
    out.push(a.getBoundingClientRect())     // THE ATOM: one rect, never its interior
    curNode = parent; curOff = idx + 1
  }
  flushTo(el, el.childNodes.length)         // the tail
  return out
}

// ONE RECT PER LINE: dedup inline rects on the same line; skip tall boxes. Height thresholds are in
// SCREEN px, so they scale by `s`. Extracted VERBATIM from collectLines so a test exercises the REAL
// filter — a comparison where both sides run through the same stale copy cancels its own error (R6).
export function keepLineRects(rects: DOMRect[], s: number): DOMRect[] {
  const out: DOMRect[] = []
  let lastTop = -1e9
  for (const r of rects) {
    // ⚠ `isLineRect`/`sameLine` (lineRects.ts) is ONE predicate for the editor and the /snapshot
    // pane. The pane once carried its own copy, its own `80` and its own `3`, under a comment
    // claiming they were the same — and the container-box bug had to be fixed twice (R2).
    if (!isLineRect(r, s) || sameLine(r.top, lastTop)) continue
    lastTop = r.top
    out.push(r)
  }
  return out
}

const POS_LAZY = -2
interface MeasuredLine {
  top: number      // intrinsic top (unscaled, editor-relative)
  blockIdx: number // index into the blocks array (per top-level DOM block)
  cx: number       // screen coords for the lazy posAtCoords (exact same point the old code sampled)
  cy: number
  pos: number      // POS_LAZY until resolved; then the old `at > 0 ? at : 0` value
  bake?: BlockLines   // cache entry to persist a lazy resolution into (block-relative)
  bakeIdx?: number    // line index within that entry
  bakeOffset?: number // the block's doc offset at collect time (rel = pos - offset)
}
interface MeasuredBlock { start: number; end: number } // doc pos range; start -1 = unresolvable
interface BlockLines { // block-relative line geometry (canonical context only)
  atomLike: boolean  // top-level atom → pseudo-block per line (per-line orphan reset)
  relStart: number   // block range relative to the node's doc offset (NaN = unresolvable → -1)
  relEnd: number
  relTops: number[]  // line tops relative to the block's intrinsic top
  relCx: number[]    // posAtCoords sample point relative to the block's own rect (screen px)
  relCy: number[]
  relPos: number[]   // NaN = still lazy; -Infinity = resolved to 0 (failed); else pos - offset
}
type LineCache = WeakMap<object, BlockLines>

// Snapshot of a successful measure's block layout — the incremental measure's starting point.
// nodes/tops are parallel (top-level doc children, in order, intrinsic canonical tops); blockW is
// the canonical CONTENT width blocks lay out at (the measurement host mirrors it exactly).
interface IncMeta { nodes: object[]; offsets: number[]; tops: number[]; blockW: number }

function collectLines(view: EditorView, editorTop: number, scale: number, cache?: LineCache): { lines: MeasuredLine[]; blocks: MeasuredBlock[]; meta: IncMeta | null } {
  const dom = view.dom as HTMLElement
  const s = scale > 0.01 ? scale : 1
  const gaps = Array.from(dom.querySelectorAll('.inkwave-page-gap')).map((g) => {
    const r = g.getBoundingClientRect(); return { top: r.top, h: r.height }
  })
  const accumAbove = (top: number): number => {
    let acc = 0; for (const g of gaps) if (g.top <= top - 2) acc += g.h; return acc
  }
  const lines: MeasuredLine[] = []
  const blocks: MeasuredBlock[] = []
  const usable = cache && gaps.length === 0
  // IncMeta capture rides the cache-usable (gap-free canonical) measure; any skipped/unmappable
  // child poisons it (the incremental diff needs EVERY top-level block accounted for).
  let meta: IncMeta | null = usable ? { nodes: [], offsets: [], tops: [], blockW: 0 } : null
  const doc = view.state.doc
  doc.forEach((child, offset) => {
    const el = view.nodeDOM(offset) as HTMLElement | null
    if (!el || el.nodeType !== 1 || el.classList?.contains('inkwave-page-gap')) { meta = null; return }
    const br = el.getBoundingClientRect()
    const blockTop = (br.top - editorTop - accumAbove(br.top)) / s
    if (meta) {
      meta.nodes.push(child)
      meta.offsets.push(offset)
      meta.tops.push(blockTop)
      if (!meta.blockW) meta.blockW = br.width / s
    }
    // CACHE HIT: rebuild this block's lines from block-relative geometry — one
    // getBoundingClientRect, zero getClientRects, zero posAtDOM. Tops rebase from the block's
    // intrinsic top; the lazy sample point rebases from the block's live rect; an already-baked
    // relPos rebuilds its absolute position by offset arithmetic (no hit-test ever again).
    if (usable) {
      const hit = cache.get(child)
      if (hit) {
        const start = Number.isNaN(hit.relStart) ? -1 : offset + hit.relStart
        const end = Number.isNaN(hit.relEnd) ? -1 : offset + hit.relEnd
        let blockIdx = -1
        if (!hit.atomLike) { blocks.push({ start, end }); blockIdx = blocks.length - 1 }
        for (let k = 0; k < hit.relTops.length; k++) {
          if (hit.atomLike) { blocks.push({ start, end }); blockIdx = blocks.length - 1 } // pseudo-block per line
          const rel = hit.relPos[k]
          lines.push({
            top: blockTop + hit.relTops[k],
            blockIdx,
            cx: br.left + hit.relCx[k],
            cy: br.top + hit.relCy[k],
            pos: Number.isNaN(rel) ? POS_LAZY : rel === -Infinity ? 0 : offset + rel,
            bake: hit, bakeIdx: k, bakeOffset: offset,
          })
        }
        return
      }
    }
    // MISS (or cache off): block boundaries once per block — posAtDOM on the block's own element
    // (cheap DOM-tree walk, not a hit-test), resolved to the top-level range — the same
    // $p.before(1)/after(1) the old per-line resolve produced for every line inside this block
    // (for depth-1 blocks this equals {offset, offset + child.nodeSize}; cached offset-relative
    // so hits reconstruct it exactly wherever the block has moved to).
    let start = -1, end = -1, atomLike = false
    try {
      const inner = view.posAtDOM(el, 0)
      const $p = doc.resolve(Math.min(Math.max(0, inner), doc.content.size))
      if ($p.depth >= 1) { start = $p.before(1); end = $p.after(1) }
      else if ($p.nodeAfter) { start = $p.pos; end = $p.pos + $p.nodeAfter.nodeSize; atomLike = true } // top-level ATOM (refList, math block)
      else if ($p.nodeBefore) { end = $p.pos; start = $p.pos - $p.nodeBefore.nodeSize; atomLike = true }
    } catch { /* widget/unmapped element — lines fall back to their own resolved pos */ }
    // Atom blocks get one pseudo-block PER LINE, replicating what the old per-line resolve produced
    // — so the snap/orphan decisions, and hence the sig, stay byte-identical around tall atoms.
    const entry: BlockLines = {
      atomLike,
      relStart: start < 0 ? NaN : start - offset,
      relEnd: end < 0 ? NaN : end - offset,
      relTops: [], relCx: [], relCy: [], relPos: [],
    }
    let blockIdx = -1
    if (!atomLike) { blocks.push({ start, end }); blockIdx = blocks.length - 1 }
    const push = (top: number, cx: number, cy: number) => {
      if (atomLike) { blocks.push({ start, end }); blockIdx = blocks.length - 1 }
      entry.relTops.push(top - blockTop)
      entry.relCx.push(cx - br.left)
      entry.relCy.push(cy - br.top)
      entry.relPos.push(NaN) // lazy — posOf bakes the resolution back when a break needs it
      lines.push({ top, blockIdx, cx, cy, pos: POS_LAZY, bake: usable ? entry : undefined, bakeIdx: entry.relTops.length - 1, bakeOffset: offset })
    }
    let rects: DOMRect[] = []
    // Inline-atom NodeViews collapse to ONE rect each (see blockLineRects): their interiors are not
    // line starts, and letting them in put page breaks mid-line.
    // Rects come PER TEXTBLOCK (see textblockEls): a container's own element children — a list's
    // `<li>`, a blockquote's `<p>` — have border boxes that are NOT lines, and admitting one made
    // its break sample land on a later line. A textblock block resolves to [el] and takes the
    // identical single-range call it always did.
    try {
      const atoms = inlineAtomRoots(view, child, offset)
      const tbs = textblockEls(view, child, offset, el)
      if (tbs.length === 1) rects = blockLineRects(tbs[0], atoms)
      else for (const d of tbs) {
        const rs = blockLineRects(d, atoms)
        // An EMPTY textblock (a blank list item) has no text rect but still occupies a line — the
        // same rule the whole-block `!rects.length` fallback below applies, per textblock. Without
        // it a blank item would vanish from the line list and every break under it would shift.
        if (rs.length) rects.push(...rs)
        else rects.push(d.getBoundingClientRect())
      }
    } catch { /* ignore */ }
    if (!rects.length) { // empty block (e.g. a blank paragraph) → one line at the block top
      push((br.top - editorTop - accumAbove(br.top)) / s, br.left + 1, br.top + Math.min(8, br.height / 2))
    } else {
      for (const r of keepLineRects(rects, s)) push((r.top - editorTop - accumAbove(r.top)) / s, r.left + 1, r.top + r.height / 2)
    }
    if (usable) cache.set(child, entry)
  })
  lines.sort((a, b) => a.top - b.top)
  return { lines, blocks, meta }
}

function compute(view: EditorView, pageH: number, topM: number, scale: number, gapped: boolean, cache?: LineCache): { set: DecorationSet; sig: string; meta: IncMeta | null } {
  if (pageH <= 0) return { set: DecorationSet.empty, sig: 'empty', meta: null }
  const editorTop = (view.dom as HTMLElement).getBoundingClientRect().top
  const doc = view.state.doc

  const { lines, blocks, meta } = collectLines(view, editorTop, scale, cache)
  if (!lines.length) return { set: DecorationSet.empty, sig: 'empty', meta: null }
  // ⚠ THIS IS THE ONE PLACE A CITATION'S CANONICAL WIDTH EXISTS — inside the forced context, with
  // the layout already flushed, so each box costs one rect and no reflow. The arith path skips the
  // force by design and can never measure it; an un-harvested key defers that block back here,
  // which harvests it. basePx 18 is the base they are keyed under, so a render-base measure MISSES
  // and defers rather than wrapping 117px where the phone renders 143 (R9).
  // → docs/archive/pagination-rounds.md#citation-harvest
  try { harvestCiteBoxes(doc, (pos) => view.nodeDOM(pos), getCitationStyle(), bibProvider.getVersion(), 18) } catch { /* never break a measure */ }
  // Resolve a line's doc position on demand — the exact posAtCoords sample the old eager path made.
  // Must run before any DOM mutation (compute never mutates; the caller dispatches after).
  // The resolution is baked back into the line cache BLOCK-RELATIVE, so the next measure rebuilds
  // it from the node's (possibly shifted) offset without repeating the hit-test.
  const posOf = (l: MeasuredLine): number => {
    if (l.pos !== POS_LAZY) return l.pos
    const at = view.posAtCoords({ left: l.cx, top: l.cy })?.pos
    l.pos = at != null && at > 0 ? at : 0
    if (l.bake && l.bakeIdx !== undefined && l.bakeOffset !== undefined) {
      l.bake.relPos[l.bakeIdx] = l.pos > 0 ? l.pos - l.bakeOffset : -Infinity
    }
    return l.pos
  }
  const { decos, sig } = computeBreaks(lines, blocks, findRefListPos(doc), pageH, topM, gapped, posOf)
  return { set: DecorationSet.create(doc, decos), sig, meta }
}

function findRefListPos(doc: EditorView['state']['doc']): number {
  let refListPos = -1
  doc.descendants((n, pos) => { if (refListPos < 0 && n.type.name === 'referenceList') refListPos = pos; return refListPos < 0 })
  return refListPos
}

// ── The BREAK LOOP — one shared implementation for the full (forced-context) measure and the
// incremental (cache+clone) measure, so break decisions are byte-identical BY CONSTRUCTION: both
// paths feed it the same lines/blocks shape; only how those lines were obtained differs. posOf
// resolves a line's doc position (full: lazy posAtCoords + bake; incremental: baked value or an
// on-demand clone resolution — a failure there throws INC_BAIL and the caller falls back). ──────
class IncBail extends Error {}
// TEST SEAM. ⚠ THIS is the ORIGINAL — the editor's own break rule and the definition of canonical
// pagination — and it was the one copy of three no test could reach. The other two each mirror it,
// each was pinned against its OWN fixture, and each passed while the pane ran +2 pages for a week:
// self-consistency is what the disease preserves (R6). `sig` is the shared vocabulary.
// → docs/archive/pagination-rounds.md#three-copies
export function _computeBreaksForTest(
  lines: MeasuredLine[],
  blocks: MeasuredBlock[],
  refListPos: number,
  pageH: number,
  topM: number,
  gapped: boolean,
  posOf: (l: MeasuredLine) => number,
): { sig: string } {
  return { sig: computeBreaks(lines, blocks, refListPos, pageH, topM, gapped, posOf).sig }
}

// ⚠ IS THE LAYOUT THE WRITER SEES CANONICAL? Set by the measure BEFORE it enters the forced context
// — inside that window the DOM is canonical by construction, so `canonicalIsLive` cannot be asked
// there and would answer about the wrong layout (R7).
/**
 * Should this break snap to the block boundary instead of splitting the paragraph?
 * Pure and exported, because the whole fix is one predicate and a browser probe that ran once is not
 * a guard (R3). ⚠ Both extra conditions are load-bearing: `orphan > 0` (with 0 the block begins at
 * this very line, so snapping is a no-op) and `blockStart > lastBreakAt` (or a block TALLER than a
 * page is pushed whole, overflows again, and snaps to the same boundary forever).
 * → docs/archive/pagination-rounds.md#zoom-snap
 */
export function shouldSnapToBlock(o: {
  liveIsCanonical: boolean; orphan: number; blockStart: number; lastBreakAt: number
}): boolean {
  return !o.liveIsCanonical && o.orphan > 0 && o.blockStart > o.lastBreakAt
}

let liveIsCanonical = true
export function _setLiveIsCanonicalForTest(v: boolean): void { liveIsCanonical = v }

/**
 * ⚠ A CANONICAL LINE START IS NOT A RENDERED LINE START AT ANY OTHER ZOOM. A break placed at a
 * canonical line start lands MID-LINE in a layout that wraps elsewhere, and the gap widget is
 * `display:block`, so it slices that line. Measured: every zoom except exactly 1 cut almost every
 * page. A BLOCK BOUNDARY is a line start in EVERY layout by construction, so when the rendering is
 * not canonical the break snaps there instead — the page is a little less full and no line is cut.
 * At canonical rendering (default desktop, and every print/PDF path) NOTHING changes, byte for byte.
 * → docs/archive/pagination-rounds.md#zoom-snap
 */
function computeBreaks(
  lines: MeasuredLine[],
  blocks: MeasuredBlock[],
  refListPos: number,
  pageH: number,
  topM: number,
  gapped: boolean,
  posOf: (l: MeasuredLine) => number,
  // ARITH BAND GEOMETRY (Job 2): when supplied, collects per-break {brokeUsed, botMargin} — the
  // content px used on the page + the gap's bottom margin — enough to reconstruct every band's
  // pixel top arithmetically (see computeArithBands), so the zoom-exit never un-skips the doc.
  bandOut?: { breaks: Array<{ at: number; brokeUsed: number; botMargin: number }>; lastUsed: number },
): { decos: Decoration[]; sig: string } {
  // TEXT area per page = pageH minus the top margin (from settings) and the bottom margin constant.
  // Using the live topM ensures the break lands at pageH - MARGIN_BOTTOM from the sheet top —
  // the same Y as the dashed rule in non-gapped mode — regardless of the top-margin setting.
  const textArea = Math.max(1, pageH - topM - MARGIN_BOTTOM)
  // The reference list always starts on a fresh page (position from findRefListPos). It's an atom
  // the paginator can't split internally, so this at least guarantees a clean start (Peter's call).
  let refBroken = false
  const decos: Decoration[] = []
  const sig: string[] = []
  let used = 0
  let pageNo = 1
  // Block identity comes from the collector (one posAtDOM per block); doc positions of individual
  // lines resolve LAZILY via posOf — only the line a break actually lands on pays the hit-test.
  // `curBlock = -1` after a break mirrors the old reset: orphan counting restarts per page.
  let curBlock = -1, blockStartUsed = 0
  let lastBreakAt = -1 // guards the block snap against pushing an over-tall block forever
  for (let i = 0; i < lines.length; i++) {
    const lh = i < lines.length - 1 ? Math.max(1, lines[i + 1].top - lines[i].top) : 24
    if (lines[i].blockIdx !== curBlock) {
      curBlock = lines[i].blockIdx
      blockStartUsed = used
    }
    const blockStart = blocks[lines[i].blockIdx].start
    // Force the reference list onto a fresh page (before the normal overflow check). Block-level
    // test: a line is at/after the refList exactly when its block starts at/after refListPos.
    if (refListPos > 0 && !refBroken && blockStart >= refListPos && used > 4) {
      const botMargin = phoneLike() ? PHONE_PAGE_MARGIN_BOTTOM : Math.max(MARGIN_BOTTOM, pageH - topM - used)
      const gapTopM = phoneLike() ? PHONE_PAGE_MARGIN : topM
      decos.push(Decoration.widget(refListPos, () => gapEl(botMargin, gapTopM, gapped), { side: -1, ignoreSelection: true, stopEvent: () => true, key: `gapref-${refListPos}` }))
      sig.push(`ref:${refListPos}:${Math.round(botMargin)}`)
      bandOut?.breaks.push({ at: refListPos, brokeUsed: used, botMargin })
      pageNo++; used = 0; curBlock = -1; refBroken = true; lastBreakAt = refListPos
    }
    // Break before the LINE that would overflow the text area.
    if (i > 0 && used + lh > textArea && posOf(lines[i]) > 0) {
      const orphan = used - blockStartUsed             // height of the current block already on this page
      // ⚠ ALWAYS SPLIT mid-block so the page fills (Decision 5, Peter 2026-07-15: "probably split")
      // — the widow/orphan snap is GONE, and `orphan` survives only for the sig/used accounting.
      // Snap ONLY where a mid-block break would cut a RENDERED line, i.e. off-canonical rendering.
      // → docs/archive/pagination-rounds.md#zoom-snap
      const snap = shouldSnapToBlock({ liveIsCanonical, orphan, blockStart, lastBreakAt })
      const at = snap ? blockStart : lines[i].pos      // else break mid-block so the page fills
      const brokeUsed = snap ? blockStartUsed : used   // used-on-page at the actual break point
      const botMargin = phoneLike() ? PHONE_PAGE_MARGIN_BOTTOM : Math.max(MARGIN_BOTTOM, pageH - topM - brokeUsed)
      // MID-PARAGRAPH split? — the line before the break is in the SAME block, so this block spans
      // the boundary. Decision 1's dotted continuation bracket marks these, and it is INDEPENDENT of
      // renderFill: a mid-paragraph split is semantically true at canonical breaks too.
      const midBlock = i > 0 && lines[i - 1].blockIdx === lines[i].blockIdx
      // Don't re-break at the reference-list boundary (already forced above; the atom can't split).
      if (at > 0 && !(refBroken && at === refListPos)) {
        // ignoreSelection: the gap is a TALL block widget; without this, ProseMirror folds its height
        // into cursor/selection mapping so a click at the page-above end jumps the caret past the gap.
        decos.push(Decoration.widget(at, () => gapEl(botMargin, phoneLike() ? PHONE_PAGE_MARGIN : topM, gapped, midBlock), { side: -1, ignoreSelection: true, stopEvent: () => true, key: `gap-${pageNo}-${at}${midBlock ? 'b' : ''}` }))
        sig.push(`${at}:${Math.round(botMargin)}`)
        bandOut?.breaks.push({ at, brokeUsed, botMargin })
        pageNo++
        lastBreakAt = at
        used = snap ? orphan : 0  // snapped: the orphan lines move to the next page; mid-block: line i starts it
        curBlock = -1             // recompute the block-on-page baseline at the next line
      }
    }
    used += lh
  }
  sig.push(`pages:${pageNo}`)
  if (bandOut) bandOut.lastUsed = used
  return { decos, sig: sig.join('|') }
}

// ─── SCOPED CANONICAL MEASURE ─────────────────────────────────────────────────────────────────
// EXACT NEAR THE WRITER, DEFERRED FAR AWAY — never approximated. The scoped measure runs in the
// REAL forced canonical context (real DOM, real NodeViews, real posAtCoords) and reads only the
// CHANGED blocks; unchanged blocks reuse their cached block-relative lines at the previous
// measure's tops, and gaps in/next to the region are cleared by a REGION-SCOPED dispatch.
//   1. ⚠ FALLBACK IS THE RULE. Non-paragraph blocks in or beside the region, a refList there, a
//      pure end-append, an unrendered block, a failed resolution, >24 changed blocks: bail to the
//      full measure, which is always correct (R8).
//   2. ⚠ A FULL MEASURE RE-VERIFIES LAZILY AFTER EVERY SCOPED ONE (idle-gated, input-gated) and
//      refreshes the incremental base — and runs SYNCHRONOUSLY before print. `inkwave:pagCheck=1`
//      runs BOTH paths and compares signatures (R3).
//   3. ⚠ NEVER APPROXIMATE FROM A CLONE. Round-5's measurement-host clones could not replicate
//      NodeViews, and one bad baked position poisons every later measure.
// → docs/archive/pagination-rounds.md#scoped-measure
//
// `canonicalIsLive`: the live layout IS the canonical layout whenever nothing canonical-relevant is
// overridden, so forceCanonicalContext would be a byte-level no-op — skip it and save BOTH
// full-document reflows (the force's first read and the restore's live relayout).
function canonicalIsLive(surface: HTMLElement | null): boolean {
  if (phoneLike()) return false
  if (!surface) return false
  const zoom = parseFloat(surface.style.getPropertyValue('--iw-editor-zoom') || '') || 1
  if (zoom !== 1) return false
  const magnify = parseFloat(surface.style.getPropertyValue('--iw-magnify') || '') || 1
  if (magnify !== 1) return false
  if ((surface.querySelector('.ProseMirror') as HTMLElement | null)?.classList.contains('iw-zoom-live')) return false
  return true
}

const INC_MAX_CHANGED = 24

// Identity diff of top-level blocks: shared prefix + suffix; [s..eo] replaced by [s..en].
function diffBlocks(oldN: object[], newN: object[]): { s: number; eo: number; en: number } {
  let s = 0
  while (s < oldN.length && s < newN.length && oldN[s] === newN[s]) s++
  let eo = oldN.length - 1
  let en = newN.length - 1
  while (eo >= s && en >= s && oldN[eo] === newN[en]) { eo--; en-- }
  return { s, eo, en }
}

// The live rect→lines formula — ONE implementation shared with collectLines (byte-identity).
function pushLineRects(rects: DOMRect[], push: (top: number, cx: number, cy: number) => void, s: number, topOf: (r: DOMRect) => number): void {
  let lastTop = -1e9
  for (const r of rects) {
    if (r.width < 1 || r.height < 1 || r.height > 80 * s || r.top - lastTop <= 3) continue
    lastTop = r.top
    push(topOf(r), r.left + 1, r.top + r.height / 2)
  }
}

interface ScopedCtx {
  surfaceEl: HTMLElement | null
  scroller: HTMLElement | null // null = window/body scroll (phone)
  /** Region-scoped gap-widget clear (dispatches a decoration removal) — natural wrapping. */
  clearGapsIn: (from: number, to: number) => void
}

function computeScoped(
  view: EditorView,
  incState: IncMeta,
  cache: LineCache,
  pageH: number,
  topM: number,
  gapped: boolean,
  ctx: ScopedCtx,
  why: (reason: string) => void = () => {},
  // ARITH SCOPED (2026-07-16): when supplied, the CHANGED blocks are laid out ARITHMETICALLY
  // instead of measured live. That removes the only reason this path needs a forced canonical
  // context — so the caller runs it with NO force and NO reflow at all. Any changed block that
  // isn't arithmetic-eligible ⇒ null ⇒ the caller falls back to the DOM scoped measure.
  arithOpts?: {
    contentW: number; ratio: number; paraSpacingEm: number
    measure: Measure; fontLoaded: (stack: string, sizePx: number) => boolean
    citationStyle: string; bibEpoch: number
  },
): { set: DecorationSet; sig: string; meta: IncMeta } | null {
  const doc = view.state.doc
  const newNodes: object[] = []
  const newOffsets: number[] = []
  doc.forEach((child, offset) => { newNodes.push(child); newOffsets.push(offset) })
  const { s, eo, en } = diffBlocks(incState.nodes, newNodes)
  const changedNew = newNodes.slice(s, en + 1)
  const changedOld = incState.nodes.slice(s, eo + 1)
  if (changedNew.length > INC_MAX_CHANGED || changedOld.length > INC_MAX_CHANGED) { why('region-size'); return null }
  // Paragraphs only, in AND beside the region (the tops arithmetic assumes bottom-only margins).
  const isPara = (n: object) => (n as { type: { name: string } }).type.name === 'paragraph'
  for (const n of [...changedNew, ...changedOld]) if (!isPara(n)) { why('region-nonpara'); return null }
  if (s > 0 && !isPara(newNodes[s - 1])) { why('seam-above'); return null }
  if (en + 1 < newNodes.length && !isPara(newNodes[en + 1])) { why('seam-below'); return null }
  // Pure append at the very end has no measured advance below the last old block — full measure.
  if (s > 0 && s >= incState.nodes.length) { why('end-append'); return null }
  const refListPos = findRefListPos(doc)

  // Natural wrapping around the edit: clear gap widgets inside/adjacent to the changed region
  // (the full measure clears the WHOLE set for exactly this; the final dispatch replaces it all).
  if (changedNew.length && !arithOpts) {
    const clearTo = (en + 1 < newNodes.length ? newOffsets[en + 1] : doc.content.size) + 1
    ctx.clearGapsIn(newOffsets[s], clearTo)
  }
  const getScrollTop = () => (ctx.scroller ? ctx.scroller.scrollTop : window.scrollY)
  const setScrollTop = (y: number) => {
    if (ctx.scroller) ctx.scroller.scrollTop = Math.max(0, y)
    else window.scrollTo(window.scrollX, Math.max(0, y))
  }
  // Bring a block into the canonical render window (content-visibility renders viewport blocks).
  const renderBlock = (offset: number): HTMLElement | null => {
    const el = view.nodeDOM(offset) as HTMLElement | null
    if (!el || el.nodeType !== 1) return null
    const vh = ctx.scroller ? ctx.scroller.clientHeight : window.innerHeight
    const r = el.getBoundingClientRect()
    const refTop = ctx.scroller ? ctx.scroller.getBoundingClientRect().top : 0
    if (r.top - refTop < 0 || r.bottom - refTop > vh) {
      setScrollTop(getScrollTop() + (r.top - refTop) - Math.min(150, vh / 4))
    }
    return el
  }
  const blockRects = (el: HTMLElement): DOMRect[] => {
    try { const range = document.createRange(); range.selectNodeContents(el); return Array.from(range.getClientRects()) } catch { return [] }
  }

  // ── the changed blocks: ARITHMETIC when eligible (no DOM), else measured LIVE ──
  const changedEntries: BlockLines[] = []
  const changedAdvances: number[] = []
  if (arithOpts && changedNew.length) {
    for (let i = 0; i < changedNew.length; i++) {
      const lay = arithBlockLayout(
        changedNew[i] as PMNode, arithOpts.contentW, arithOpts.ratio, arithOpts.paraSpacingEm,
        arithOpts.measure, arithOpts.fontLoaded, arithOpts.citationStyle, arithOpts.bibEpoch,
      )
      if (!lay) { why('arith-ineligible'); return null }
      changedEntries.push({
        atomLike: false,
        relStart: 0,                    // a paragraph's own start IS its offset ($p.before(1))
        relEnd: lay.relEnd,
        relTops: lay.relTops,
        // Never read: relPos is BAKED (arithmetic positions are exact), so posOf never hit-tests.
        relCx: lay.relTops.map(() => 0),
        relCy: lay.relTops.map(() => 0),
        relPos: lay.relPos,
      })
      changedAdvances.push(lay.advance)
    }
    for (let i = 0; i < changedNew.length; i++) cache.set(changedNew[i], changedEntries[i])
  } else if (changedNew.length) {
    const els: HTMLElement[] = []
    for (let i = 0; i < changedNew.length; i++) {
      const el = renderBlock(newOffsets[s + i])
      if (!el) { why('no-el'); return null }
      els.push(el)
    }
    for (let i = 0; i < changedNew.length; i++) {
      const el = els[i]
      const node = changedNew[i] as { nodeSize: number; content: { size: number } }
      let rects = blockRects(el)
      if (!rects.length && node.content.size > 0) {
        renderBlock(newOffsets[s + i]) // re-scroll (long region can outgrow the window) and retry
        rects = blockRects(el)
        if (!rects.length) { why('unrendered'); return null } // full measure
      }
      const br = el.getBoundingClientRect()
      // Block boundaries exactly like the live collector (posAtDOM — tree walk, no layout).
      let bStart = -1, bEnd = -1
      try {
        const inner = view.posAtDOM(el, 0)
        const $p = doc.resolve(Math.min(Math.max(0, inner), doc.content.size))
        if ($p.depth >= 1) { bStart = $p.before(1); bEnd = $p.after(1) }
      } catch { /* fall through; -1 keeps the full-path fallback semantics */ }
      const entry: BlockLines = {
        atomLike: false,
        relStart: bStart < 0 ? NaN : bStart - newOffsets[s + i],
        relEnd: bEnd < 0 ? NaN : bEnd - newOffsets[s + i],
        relTops: [], relCx: [], relCy: [], relPos: [],
      }
      if (!rects.length) {
        entry.relTops.push(0)
        entry.relCx.push(1)
        entry.relCy.push(Math.min(8, br.height / 2))
        entry.relPos.push(NaN)
      } else {
        pushLineRects(rects, (top, cx, cy) => {
          entry.relTops.push(top)
          entry.relCx.push(cx - br.left)
          entry.relCy.push(cy - br.top)
          entry.relPos.push(NaN)
        }, 1, (r) => r.top - br.top)
      }
      changedEntries.push(entry)
    }
    // Advances from consecutive live canonical tops; the block AFTER the region provides the last.
    const tops = els.map((el) => el.getBoundingClientRect().top)
    for (let i = 0; i < changedNew.length - 1; i++) changedAdvances.push(tops[i + 1] - tops[i])
    if (en + 1 < newNodes.length) {
      const nextEl = renderBlock(newOffsets[en + 1])
      if (!nextEl) { why('no-next'); return null }
      changedAdvances.push(nextEl.getBoundingClientRect().top - els[els.length - 1].getBoundingClientRect().top)
    } else {
      changedAdvances.push(0) // region ends the document — advance below it is never used
    }
    for (let i = 0; i < changedNew.length; i++) cache.set(changedNew[i], changedEntries[i])
  }

  // ── absolute tops: prefix bit-identical; region from the telescoped seam; suffix + one delta ──
  const newTops: number[] = new Array(newNodes.length)
  for (let i = 0; i < s; i++) newTops[i] = incState.tops[i]
  let seamTop: number
  if (s === 0) seamTop = incState.tops.length ? incState.tops[0] : 0
  else seamTop = incState.tops[s] // = tops[s-1] + advance(s-1), telescoped EXACTLY
  let cursor = seamTop
  for (let i = 0; i < changedNew.length; i++) {
    newTops[s + i] = cursor
    cursor += changedAdvances[i]
  }
  const oldAfterIdx = eo + 1
  if (oldAfterIdx < incState.nodes.length) {
    const delta = cursor - incState.tops[oldAfterIdx]
    for (let i = en + 1; i < newNodes.length; i++) {
      newTops[i] = incState.tops[oldAfterIdx + (i - (en + 1))] + delta
    }
  }

  // ── assemble lines/blocks from entries at the reconstructed tops ──
  const lines: MeasuredLine[] = []
  const blocks: MeasuredBlock[] = []
  const homeOf = new Map<BlockLines, { offset: number }>()
  for (let i = 0; i < newNodes.length; i++) {
    const offset = newOffsets[i]
    const entry = i >= s && i <= en ? changedEntries[i - s] : cache.get(newNodes[i])
    if (!entry) { why('missing-entry'); return null } // full measure
    homeOf.set(entry, { offset })
    const start = Number.isNaN(entry.relStart) ? -1 : offset + entry.relStart
    const end = Number.isNaN(entry.relEnd) ? -1 : offset + entry.relEnd
    let blockIdx = -1
    if (!entry.atomLike) { blocks.push({ start, end }); blockIdx = blocks.length - 1 }
    for (let k = 0; k < entry.relTops.length; k++) {
      if (entry.atomLike) { blocks.push({ start, end }); blockIdx = blocks.length - 1 }
      const rel = entry.relPos[k]
      lines.push({
        top: newTops[i] + entry.relTops[k],
        blockIdx,
        cx: 0, cy: 0, // rebuilt from the LIVE canonical block rect at resolution time (below)
        pos: Number.isNaN(rel) ? POS_LAZY : rel === -Infinity ? 0 : offset + rel,
        bake: entry, bakeIdx: k, bakeOffset: offset,
      })
    }
  }
  if (!lines.length) { why('no-lines'); return null }
  lines.sort((a, b) => a.top - b.top)

  // ── the shared break loop; unresolved positions use the REAL posAtCoords in this window ──
  const posOf = (l: MeasuredLine): number => {
    if (l.pos !== POS_LAZY) return l.pos
    const home = l.bake ? homeOf.get(l.bake) : undefined
    if (!home || l.bakeIdx === undefined) throw new IncBail()
    const el = renderBlock(home.offset)
    if (!el) throw new IncBail()
    const br = el.getBoundingClientRect()
    if (br.height < 1) throw new IncBail() // still unrendered — full measure
    // EXACTLY the full path's lazy sample: same block-relative point, same posAtCoords.
    const at = view.posAtCoords({ left: br.left + l.bake!.relCx[l.bakeIdx], top: br.top + l.bake!.relCy[l.bakeIdx] })?.pos
    l.pos = at != null && at > 0 ? at : 0
    l.bake!.relPos[l.bakeIdx] = l.pos > 0 ? l.pos - home.offset : -Infinity
    return l.pos
  }
  let out: { decos: Decoration[]; sig: string }
  try {
    out = computeBreaks(lines, blocks, refListPos, pageH, topM, gapped, posOf)
  } catch (e) {
    if (e instanceof IncBail) { why('pos-unresolved'); return null }
    throw e
  }
  return {
    set: DecorationSet.create(doc, out.decos),
    sig: out.sig,
    meta: { nodes: newNodes, offsets: newOffsets, tops: newTops, blockW: incState.blockW },
  }
}

export const PaginationExtension = Extension.create<PaginationOptions>({
  name: 'pagination',
  addOptions() { return { enabled: false, gapped: false } },
  addProseMirrorPlugins() {
    const enabled = this.options.enabled
    const gapped = this.options.gapped
    return [
      new Plugin<DecorationSet>({
        key: KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(KEY) as DecorationSet | undefined
            return meta ?? old.map(tr.mapping, tr.doc)
          },
        },
        props: { decorations(state) { return KEY.getState(state) } },
        view(view) {
          if (!enabled) return {}
          ;(window as unknown as { __iwPaginationReady?: boolean }).__iwPaginationReady = false // fresh doc → re-latch
          let raf = 0
          let paintRaf = 0
          let lastInputSig  = '' // doc size + page height — only re-measure when these change
          let lastLayoutSig = '' // gap positions/sizes — only re-dispatch when breaks actually moved
          let lastSet: DecorationSet = DecorationSet.empty // stable set to restore when sig unchanged
          let sheet: HTMLElement | null = null
          let layer: HTMLElement | null = null
          let observed = false
          let lastPageH = 0 // canonical page height from the last recompute — the full-final-page fallback
          let lastMinH = 0  // applyBands' full-final-page sheet extension — recompute's baseline must
                            // respect it or the RO oscillates (reset→shrink→paint→grow→RO→reset…)
          // ⚠ THE RESIZE OBSERVER MUST FOLD INTO THE EDIT DEBOUNCE, on BOTH platforms. A keystroke
          // that adds or removes a LINE resizes the sheet, so this fires one frame after the edit
          // with a fresh inputSig and ran the full multi-reflow measure IMMEDIATELY, bypassing the
          // debounce — the ablation's biggest desktop longtask source. Genuine resizes (rotate,
          // keyboard, panel dock — no edit pending) still measure straight away.
          // → docs/archive/pagination-rounds.md#measure-scheduling
          const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
            // ⚠ ZOOM-GESTURE HOLD: every font-zoom frame resizes the sheet, so this re-ran per frame
            // and repositioned the panels 1–2 frames BEHIND the reflowing text — the sheet edge
            // visibly oscillated at the zoom target. Scroll.tsx raises __iwZoomHold for the whole
            // gesture; the settle re-measure repaints once, against the settled layout.
            if ((window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold) return
            if (editDebounce) scheduleAfterEdit()
            else schedule()
          }) : null

          // A background layer of REAL parchment sheet panels, one per page, positioned at the
          // measured page regions (between the gap bands). Each is its own <div>, so it gets a real
          // 4-side drop shadow + rounded corners — discrete sheets like Word — and the gaps between
          // them are genuinely transparent, so the fixed background + waves show through and match
          // the surroundings exactly. Lives behind the text (z-index 0); text container is z-index 1.
          // Resolved LAZILY: at plugin-view construction the editor isn't inside .scroll-paper yet.
          const ensureSheet = () => {
            if (!sheet) sheet = (view.dom as HTMLElement).closest('.scroll-paper') as HTMLElement | null
            if (sheet && !layer && gapped) {
              layer = document.createElement('div')
              layer.className = 'inkwave-sheets'
              layer.setAttribute('aria-hidden', 'true')
              sheet.insertBefore(layer, sheet.firstChild)
            }
            if (sheet && ro && !observed) { ro.observe(sheet); observed = true }
            return sheet
          }
          // ── Page-band geometry: read (live DOM) / apply (panel styles) — split so the step
          // cache can APPLY precomputed geometry without reading anything (see below). ──────────
          interface BandGeo { tops: number[]; heights: number[]; total: number }
          // Read the CURRENT band geometry from the live DOM, in sheet-local LAYOUT px. Unlike the
          // break MEASURE (canonical context, magnify forced to 1), this reads the live, possibly
          // transform-magnified DOM: band rects come back in VISUAL px while scrollHeight and the
          // panel styles are LAYOUT px — divide rect-derived distances by the scale (magnify.ts).
          const readBands = (): BandGeo | null => {
            if (!sheet || !layer) return null
            const s = scaleFor(sheet)
            // PHASE PROBES (zero cost unless a harness defines window.__iwPerf). They are what
            // turned "zoom is slow" into a fix — see the archive entry below.
            const _t0 = performance.now()
            const sheetR = sheet.getBoundingClientRect()
            probePerf('zoom-rbFirstRect', performance.now() - _t0)
            const _t1 = performance.now()
            const bands = Array.from(sheet.querySelectorAll('.inkwave-page-gap-band')) as HTMLElement[]
            const tops: number[] = []
            const heights: number[] = []
            for (const band of bands) {
              const r = band.getBoundingClientRect()
              tops.push((r.top - sheetR.top) / s)
              heights.push(r.height / s)
            }
            probePerf('zoom-rbBandLoop', performance.now() - _t1)
            // ⚠ DERIVE THE CONTENT EXTENT FROM THE IN-FLOW CHILDREN'S RECTS, IN THE SAME LAYOUT
            // PASS as the band reads. The old `display:none` + minHeight-clear `scrollHeight` read
            // was a SECOND forced full layout on every paint, cache miss and atomic exit.
            // ⚠ SKIP EVERY ABSOLUTELY-POSITIONED CHILD, not just the sheet layer: they are inset:0
            // overlays that STRETCH to minHeight, so reading their bottom folds our own
            // full-final-page minHeight back into `total` — a per-paint RATCHET. Only real in-flow
            // content may set the extent. → docs/archive/pagination-rounds.md#band-geometry
            let bottom = sheetR.top
            for (const c of Array.from(sheet.children) as HTMLElement[]) {
              if (c === layer) continue
              const pos = getComputedStyle(c).position
              if (pos === 'absolute' || pos === 'fixed') continue // inset:0 overlay → tracks minHeight
              const r = c.getBoundingClientRect()
              if (r.bottom > bottom) bottom = r.bottom
            }
            const padB = parseFloat(getComputedStyle(sheet).paddingBottom) || 0
            const total = (bottom - sheetR.top) / s + padB
            probePerf('zoom-rbRest', performance.now() - _t1)
            return { tops, heights, total }
          }
          // Position panels at every region NOT covered by a gap band: [0..band0], [band0..band1], …
          // Pure style writes — no layout reads — so a step-cache hit can run it mid-gesture and
          // the writes batch into the SAME reflow as the font-zoom change (panels move WITH text).
          const applyBands = (geo: BandGeo) => {
            if (!layer) return
            const segs: Array<{ top: number; height: number }> = []
            let cursor = 0
            for (let i = 0; i < geo.tops.length; i++) {
              const top = Math.round(geo.tops[i])
              const bottom = Math.round(geo.tops[i] + geo.heights[i])
              if (top <= cursor) { cursor = Math.max(cursor, bottom); continue }
              segs.push({ top: cursor, height: top - cursor })
              cursor = bottom
            }
            // FULL FINAL PAGE (MS-Word style, Peter 2026-07-10): a barely-filled last page still
            // paints as a whole sheet. ⚠ Its height is derived from `geo` ALONE (the average of the
            // previous ≤5 regions), so step-cache hits reproduce it exactly and it stays right under
            // font zoom / phone reflow, where the canonical pageH would not match.
            const prior = segs.map((s) => s.height)
            const fullH = prior.length
              ? prior.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, prior.length)
              : lastPageH
            segs.push({ top: cursor, height: Math.max(Math.max(0, geo.total - cursor), Math.round(fullH)) })
            // Give the extended panel somewhere to paint + keep scroll range == visual: min-height
            // covers the last panel's bottom (readBands neutralizes it during the total read, so
            // it can retract when content shrinks).
            if (sheet) {
              const last = segs[segs.length - 1]
              lastMinH = Math.max(Math.round(lastPageH), Math.ceil(last.top + last.height))
              sheet.style.minHeight = `${lastMinH}px`
            }
            // Reconcile the panel divs to match the segment list (reuse to avoid churn). Each panel
            // carries its page number as a footer pinned to its bottom margin (not in the gap).
            while (layer.children.length > segs.length) layer.lastElementChild!.remove()
            while (layer.children.length < segs.length) {
              const d = document.createElement('div')
              d.className = 'inkwave-sheet'
              const f = document.createElement('div')
              f.className = 'inkwave-sheet-num'
              // Inline styles guarantee alignment even if CSS layer ordering shifts.
              f.style.cssText = 'position:absolute;bottom:22px;left:0;right:0;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:8px;pointer-events:none'
              const logo = document.createElement('img')
              logo.src = '/inkwave-logo-v7.png'
              logo.alt = ''
              // Phone: NO logo (no room) — just a centred, solid-black, larger number (Peter).
              const ph = phoneLike()
              logo.style.cssText = `width:22px;height:22px;opacity:0.75;flex-shrink:0;display:${ph ? 'none' : 'block'}`
              f.appendChild(logo)
              const num = document.createElement('span')
              num.style.cssText = `font-family:"EB Garamond",Georgia,serif;color:${ph ? 'var(--iw-page-num, #000)' : '#9b5ccc'};font-size:${ph ? '1.25rem' : '0.9rem'};font-weight:${ph ? '700' : '400'};line-height:1;display:block`
              f.appendChild(num)
              d.appendChild(f)
              layer.appendChild(d)
            }
            segs.forEach((s, i) => {
              const d = layer!.children[i] as HTMLElement
              d.style.top = `${s.top}px`
              d.style.height = `${s.height}px`
              const numSpan = (d.firstChild as HTMLElement).querySelector('span')
              if (numSpan) numSpan.textContent = String(i + 1)
            })
          }
          // ── ARITH BAND GEOMETRY (Job 2, flag inkwave:arithBands) ──────────────────────────────
          // BandGeo computed REFLOW-FREE from two arith passes: a CANONICAL one for the break set +
          // each gap's botMargin, and a RENDER-zoom one for each break line's render pixel top. Gap
          // WIDGETS are fixed px, so break k's rendered top is its render line top + the gaps above.
          // ⚠ WRAP IN THE PARAGRAPH'S OWN CONTENT BOX, never `clientWidth` — that is INTEGER-rounded
          // and ~6/88 times at 22.5px runs +0.42px too generous, fitting one word too many and
          // losing a line, with the per-page error compounding. Floor to the 1/64px LayoutUnit grid.
          // ⚠ ONE helper feeds BOTH the band geometry and the render-fill measure, so they cannot
          // drift (R2). → docs/archive/pagination-rounds.md#arith-bands
          const renderWrapCtx = (): { w: number; base: number; ratio: number } | null => {
            const edEl = view.dom as HTMLElement
            const firstBlk = Array.from(edEl.children).find((c) => !(c as HTMLElement).classList.contains('inkwave-page-gap')) as HTMLElement | undefined
            const cs = getComputedStyle(firstBlk ?? edEl)
            const boxEl = firstBlk ?? edEl
            const w = boxEl.getBoundingClientRect().width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
              - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0)
            if (!(w > 40)) return null
            const base = parseFloat(cs.fontSize) || 18
            const lhPx = parseFloat(cs.lineHeight)
            const ratio = lhPx && base ? lhPx / base : (phoneLike() ? 1.55 : 1.618)
            return { w: Math.floor(w * 64) / 64, base, ratio } // floored to the LayoutUnit grid
          }
          // The CANONICAL page-break positions (base 18, canonical A4 width) — where the paginator
          // splits pages. Each `at` is a DOCUMENT position; the ones falling INSIDE a block are the
          // mid-paragraph gaps the render pass must honour as forced line-ends. Shared by
          // computeArithBands and the __iwCmpBlockLines debug probe so both model gaps identically.
          const canonicalArithBreaks = (): Array<{ at: number; brokeUsed: number; botMargin: number }> | null => {
            const paper = getPaperSize(); const topM = getTopMarginPx()
            const { pageWidthPx, pageHeightPx: pageH } = pageBoxPx({
              paperSize: paper === 'letter' ? 'letter' : 'a4', orientation: getOrientation(),
              topMarginPx: topM, bottomMarginPx: MARGIN_BOTTOM,
            })
            const canonW = Math.floor((pageWidthPx - 2 * getSideMarginPx()) * 64) / 64
            const canon = buildArithMeasure(view.state.doc, canonW, 1.618, getParaSpacingEm(), arithMeasureFn, arithFaceLoaded, true, 18, getCitationStyle(), bibProvider.getVersion())
            if (!canon) return null
            const bandOut = { breaks: [] as Array<{ at: number; brokeUsed: number; botMargin: number }>, lastUsed: 0 }
            computeBreaks(canon.lines as unknown as MeasuredLine[], canon.blocks, findRefListPos(view.state.doc), pageH, topM, gapped, (l) => (l as unknown as { pos: number }).pos, bandOut)
            return bandOut.breaks
          }
          // `out.blockHeights` (optional) = each top-level block's RENDER border-box height, in the
          // SAME order as the doc's paragraphs — the exact content-visibility reservation, so the
          // exit can keep the window on without the un-skip's full relayout.
          const computeArithBands = (out?: { blockHeights?: number[] }): BandGeo | null => {
            if (!sheet || !gapped) return null
            const rc = renderWrapCtx()
            if (!rc) return null
            const renderW = rc.w, renderBase = rc.base, renderRatio = rc.ratio
            const style = getCitationStyle(); const epoch = bibProvider.getVersion(); const paraSp = getParaSpacingEm()
            // (1) CANONICAL breaks + botMargins.
            const breaks = canonicalArithBreaks()
            if (!breaks) return null
            const topM = getTopMarginPx()
            // (2) RENDER pixel tops of every break line (render width + render font). The canonical
            // break positions are fed back as FORCED line-ends: a mid-paragraph page gap is a
            // display:block widget that ends the pre-gap line partial, so the render wrap MUST break
            // there too — else it fills the slack and loses a render line, drifting every band below.
            const render = buildArithMeasure(view.state.doc, renderW, renderRatio, paraSp, arithMeasureFn, arithFaceLoaded, true, renderBase, style, epoch, breaks.map((b) => b.at))
            if (!render) return null
            if (out) {
              // Block advance = the gap between consecutive blocks' FIRST line tops (the render pass
              // accumulates height + marginBottom per block); the border-box height the placeholder
              // must reserve is that advance minus the (collapsed) bottom margin.
              const firstTop: number[] = []
              for (const l of render.lines) if (firstTop[l.blockIdx] === undefined) firstTop[l.blockIdx] = l.top
              const mb = paraSp * renderBase
              const hs: number[] = []
              for (let i = 0; i < render.blocks.length; i++) {
                const next = i + 1 < render.blocks.length ? firstTop[i + 1] : render.contentHeight
                hs.push(Math.max(1, (next ?? render.contentHeight) - (firstTop[i] ?? 0) - mb))
              }
              out.blockHeights = hs
            }
            // Render lines sorted by top, each with its own height (top→next top). A canonical break
            // at doc position `at` sits at the render BOTTOM of the line CONTAINING at (the gap forces
            // a line end there) — unless `at` is itself a render line start, when it's that line's top.
            const rl = render.lines.map((l, i) => ({ pos: l.pos, top: l.top, h: i + 1 < render.lines.length ? Math.max(1, render.lines[i + 1].top - l.top) : Math.max(1, render.contentHeight - l.top) }))
              .sort((a, b) => a.top - b.top)
            const gapTopOf = (at: number): number | null => {
              // the render line with the greatest top whose pos-range starts at/before `at`
              let best: { pos: number; top: number; h: number } | null = null
              for (const l of rl) if (l.pos <= at && (!best || l.top > best.top)) best = l
              if (!best) return null
              return best.pos === at ? best.top : best.top + best.h
            }
            // Assemble. Origin = sheet paddingTop; band top = padTop + gapTop + gapsAbove +
            // botMargin − bleed. Gap widget height (fixed px) = botMargin + GAP + nextTopM.
            const padTop = phoneLike() ? PHONE_PAGE_MARGIN : topM
            const gap = phoneLike() ? PHONE_GAP : GAP
            const bleed = phoneLike() ? PHONE_SHEET_RADIUS : 0
            const nextTopM = phoneLike() ? PHONE_PAGE_MARGIN : topM
            const tops: number[] = []; const heights: number[] = []
            let gapAccum = 0
            for (const b of breaks) {
              const gt = gapTopOf(b.at)
              if (gt === null) return null
              tops.push(padTop + gt + gapAccum + b.botMargin - bleed)
              heights.push(gap + 2 * bleed)
              gapAccum += b.botMargin + gap + nextTopM
            }
            const total = padTop + render.contentHeight + gapAccum + (parseFloat(getComputedStyle(sheet).paddingBottom) || 0)
            return { tops, heights, total }
          }
          // ⚠ THE SHAPING GATE IS EMPIRICAL AND MEASURES INSIDE THE REAL .ProseMirror — that is
          // where the ligature state lives, and a plain-div harness certifies a fiction (R5). NOT
          // `canvasCanMatchEditorShaping()`, which only sniffs for ctx.textRendering: Safari never
          // exposes it even though the stripped faces make canvas match there anyway.
          let _shapeOk: boolean | null = null
          const shapingMatchesEditor = (): boolean => {
            if (_shapeOk !== null) return _shapeOk
            try {
              const ed = view.dom as HTMLElement
              const cs = getComputedStyle(ed)
              const font = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize)}px ${cs.fontFamily}`
              const domWidth = (text: string, cssFont: string): number => {
                const s = document.createElement('span')
                // ⚠ THE PROBE SPAN MUST SHAPE AND LAY OUT EXACTLY AS THE BODY TEXT, or the gate
                // silently DISABLES the feature it guards (R5). Two halves, both once wrong: the
                // `font:` SHORTHAND resets font-variant-ligatures to `normal`, so re-assert the
                // editor's real longhands AFTER it; and `content-visibility:visible` is load-bearing
                // — parked off-screen under the zoom-live `> *` rule the span is SKIPPED and its
                // rect came back 177px against a true 1186px.
                // → docs/archive/pagination-rounds.md#shaping-gate
                s.style.cssText = `position:absolute;left:-99999px;top:0;white-space:pre;content-visibility:visible;contain:none;font:${cssFont}`
                  + `;font-variant-ligatures:${cs.fontVariantLigatures};font-feature-settings:${cs.fontFeatureSettings}`
                  + `;font-kerning:${cs.fontKerning};font-optical-sizing:${cs.fontOpticalSizing};text-rendering:${cs.textRendering}`
                s.textContent = text
                ed.appendChild(s)
                const w = s.getBoundingClientRect().width
                s.remove() // synchronous: PM never sees a transaction, so its observer never rebuilds
                return w
              }
              _shapeOk = canvasShapingMatchesEditor(font, domWidth, arithMeasureFn)
              ;(window as unknown as { __iwShape?: unknown }).__iwShape = { font, ok: _shapeOk,
                canvas: arithMeasureFn('The quick brown fox jumps over the lazy dog 0123456789', font),
                dom: domWidth('The quick brown fox jumps over the lazy dog 0123456789', font) }
            } catch { _shapeOk = false }
            return _shapeOk
          }
          // ── THE ZOOM-EXIT (Job 2) ───────────────────────────────────────────────────────────────
          // Scroll.tsx's gesture exit asks US for the geometry before it decides how to land. If we
          // answer, the bands are applied in THIS task (atomic with the caller's anchor re-pin) and
          // the caller keeps content-visibility ON using our exact per-block heights — so it never
          // un-skips, and the exit costs O(visible) instead of O(doc). No answer ⇒ it falls back to
          // the un-skip + readBands, which is always correct.
          const onArithExit = (e: Event) => {
            const d = (e as CustomEvent).detail as { surface?: Element; ok?: boolean; blockHeights?: number[]; why?: string } | undefined
            if (!d) return
            if (!arithBandsOn()) { d.why = 'flag-off'; return }
            if (!gapped || !sheet || !layer) { d.why = 'not-gapped'; return }
            if (d.surface !== surfaceOf()) { d.why = 'other-surface'; return } // SnapshotView's zoom
            if (!shapingMatchesEditor()) { d.why = 'shaping'; return }
            const out: { blockHeights?: number[] } = {}
            const geo = computeArithBands(out)
            if (!geo || !out.blockHeights) { d.why = 'arith-null'; return } // deferred block ⇒ fall back
            applyBands(geo)
            d.blockHeights = out.blockHeights
            d.ok = true
          }
          window.addEventListener('inkwave:arith-exit', onArithExit)
          // Debug: per-block render line-count parity (arith render measure vs the DOM's rendered
          // line rects). Pins whether a band drift is an engine wrap divergence (line count) or the
          // band assembly, and at what font SIZE it happens.
          ;(window as unknown as { __iwCmpBlockLines?: () => unknown }).__iwCmpBlockLines = () => {
            const rc = renderWrapCtx(); if (!rc) return { rc: false }
            const fb = canonicalArithBreaks() // mid-paragraph gap positions forced as render line-ends
            const am = buildArithMeasure(view.state.doc, rc.w, rc.ratio, getParaSpacingEm(), arithMeasureFn, arithFaceLoaded, true, rc.base, getCitationStyle(), bibProvider.getVersion(), (fb ?? []).map((b) => b.at))
            if (!am) return { am: false }
            const arLines = new Map<number, number>()
            for (const l of am.lines) arLines.set(l.blockIdx, (arLines.get(l.blockIdx) ?? 0) + 1)
            const edEl = view.dom as HTMLElement
            const kids = Array.from(edEl.children).filter((c) => !(c as HTMLElement).classList.contains('inkwave-page-gap')) as HTMLElement[]
            const out: string[] = []
            for (let i = 0; i < kids.length && out.length < 6; i++) {
              const rng = document.createRange(); rng.selectNodeContents(kids[i])
              let domN = 0, lastTop = -1e9
              for (const r of Array.from(rng.getClientRects())) { if (r.width > 1 && r.height > 1 && r.height < 90 && r.top - lastTop > 3) { domN++; lastTop = r.top } }
              const ar = arLines.get(i) ?? 0
              if (ar !== domN) {
                const bcs = getComputedStyle(kids[i])
                const ownW = kids[i].getBoundingClientRect().width - (parseFloat(bcs.paddingLeft) || 0) - (parseFloat(bcs.paddingRight) || 0) - (parseFloat(bcs.borderLeftWidth) || 0) - (parseFloat(bcs.borderRightWidth) || 0)
                const fs = getComputedStyle(kids[i].querySelector('span') ?? kids[i]).fontSize
                out.push(`blk${i} DOM ${domN}L arith ${ar}L font=${fs} ownW=${(Math.floor(ownW * 64) / 64).toFixed(3)} ti=${bcs.textIndent} ml=${bcs.marginLeft} pl=${bcs.paddingLeft} "${(kids[i].textContent || '').slice(0, 32)}"`)
              }
            }
            return { blocks: kids.length, mismatches: out.length ? out : 'NONE — all blocks line-count parity', renderW: rc.w, base: rc.base, ratio: +rc.ratio.toFixed(4) }
          }
          // Debug: compare arith bands vs the DOM readBands at the CURRENT zoom (must match ~0px).
          ;(window as unknown as { __iwCmpArithBands?: () => unknown }).__iwCmpArithBands = () => {
            const dom = readBands(); const ar = computeArithBands()
            if (!dom || !ar) return { dom: !!dom, arith: !!ar }
            const n = Math.min(dom.tops.length, ar.tops.length)
            let maxDT = 0, maxDH = 0
            for (let i = 0; i < n; i++) { maxDT = Math.max(maxDT, Math.abs(dom.tops[i] - ar.tops[i])); maxDH = Math.max(maxDH, Math.abs(dom.heights[i] - ar.heights[i])) }
            const edEl = view.dom as HTMLElement; const cs = getComputedStyle(edEl)
            const deltas = []; for (let i = 0; i < n; i++) deltas.push(+(ar.tops[i] - dom.tops[i]).toFixed(1))
            return { bands: `${dom.tops.length}/${ar.tops.length}`, maxTopΔ: +maxDT.toFixed(2), maxHtΔ: +maxDH.toFixed(2), totalΔ: +Math.abs(dom.total - ar.total).toFixed(2),
              renderFont: cs.fontSize, renderLH: cs.lineHeight, perBandΔ: deltas.slice(0, 10) }
          }
          const paint = () => {
            const paintT0 = performance.now() // perflog: band repaint cost
            paintRaf = 0
            if (!sheet || !layer) return
            const geo = readBands()
            if (!geo) return
            applyBands(geo)
            // A settle/idle paint IS a fresh measurement of the current step — cache it for free.
            stepCache.set(currentStep(), geo)
            notePerf('pm-paint', performance.now() - paintT0)
          }
          const schedulePaint = () => { if (!paintRaf) paintRaf = requestAnimationFrame(paint) }

          // ── PREDICTIVE STEP CACHE (Peter: "the pages wait until the scrolling is finished to
          // change") ────────────────────────────────────────────────────────────────────────────
          // Canonical breaks don't move with zoom, so per lattice step only the band GEOMETRY
          // differs and ONE hypothetical-reflow measure per step is the whole cost. A committed step
          // applies its cached geometry as pure style writes that batch into the same reflow as the
          // font change.
          // ⚠ BANDS AND TEXT MUST LAND IN THE SAME FRAME, cached or not — so a MISS reads the bands
          // LIVE in that same task. Leaving the panels at stale geometry while the text reflowed
          // made the gap visually collapse and let text paint out over the water.
          // → docs/archive/pagination-rounds.md#step-cache
          const stepCache = new Map<number, BandGeo>()
          // ⚠ TWO CACHES, AND THEY MUST NOT MIX. Geometry read under the live-reflow window's
          // placeholder heights is a DIFFERENT regime: it must never leak into `stepCache`
          // (placeholder-squashed panels replayed at rest), and stepCache's full-layout geometry
          // must never apply mid-gesture (R7).
          const liveCache = new Map<number, BandGeo>()
          const cacheStats = { hits: 0, misses: 0, precomputed: 0, warmed: 0 } // debug/smoke counters
          ;(window as unknown as { __iwStepCache?: typeof cacheStats }).__iwStepCache = cacheStats
          // Also cancels any in-flight between-notch warm: it is scheduled against the geometry of
          // the context being cleared, so letting it land would cache exactly what this invalidates.
          const clearStepCache = () => { stepCache.clear(); liveCache.clear(); cancelLiveWarm() }
          const surfaceOf = () => (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
          const currentStep = () => zoomToStep(parseFloat(surfaceOf()?.style.getPropertyValue('--iw-editor-zoom') || '') || 1)
          // ── ATOMIC TEXT+BAND through reflow zoom (Peter: "Zooming should change text and page
          // atomically … the gapped page arbitrarily joining up or the text flowing over the
          // water") ───────────────────────────────────────────────────────────────────────────
          // ⚠ ATOMICITY BEATS FREEZE (Peter's ruling). A page's rendered height changes NON-uniformly
          // with zoom — discrete lines-per-page jumps no smooth (z/z0)² factor can track — so the
          // round-5 freeze left bands not matching their pages. The bands are re-derived in the SAME
          // task as every reflow step, read from the live DOM where content-visibility renders
          // on-screen blocks EXACTLY.
          //
          // ── THE BETWEEN-NOTCH WARM — what actually makes a notch cheap ────────────────────────
          // ⚠ THE ONLY LEVER IS *WHEN* THE MEASURE HAPPENS, NOT HOW CHEAP IT IS. Measured: a notch's
          // 78ms step event is 98% `readBands()`, and that is ONE forced layout the anchor read did
          // not cover — two cheaper-read theories were measured and both failed. So one step is
          // warmed BETWEEN notches, in the PLACEHOLDER REGIME (into liveCache, never stepCache), and
          // it is CANCELLED by the next notch so a fast trackpad stream never fires it.
          // ⚠ A MISS STAYS EXACTLY AS CORRECT — this makes the miss rarer, never the answer
          // different (R8).
          // ⚠ THE SCHEDULING RULE IS A PURE FUNCTION in `editor/zoomWarm.ts`, because a browser probe
          // is not a guard: warming too eagerly puts the measure back on the input path, warming
          // never restores the old cost, and neither shows up as a wrong pixel (R3).
          // → docs/archive/pagination-rounds.md#step-cache
          const LIVE_WARM_DELAY_MS = 45   // > a trackpad's ~16ms cadence, so a fast stream cancels it
          let liveWarmTimer: ReturnType<typeof setTimeout> | undefined
          let lastStepAt = 0
          let lastStepIdx: number | null = null
          let lastWarmMs = 0 // what a warm ACTUALLY costs on this machine — the cadence gate reads it
          const cancelLiveWarm = () => { if (liveWarmTimer) { clearTimeout(liveWarmTimer); liveWarmTimer = undefined } }
          // Measure one lattice step's bands UNDER THE LIVE WINDOW. Same set→read→restore shape as
          // measureStep (the hypothetical layout never paints).
          // ⚠ IT MUST ALSO MOVE `--iw-cis-scale`: the placeholder heights it drives are part of this
          // regime's geometry, and reading without it caches geometry no commit can reproduce.
          const measureLiveStep = (k: number, z0: number) => {
            const surface = surfaceOf()
            if (!surface || !sheet || !layer) return
            const scroller = surface.classList.contains('iw-fill') && !surface.classList.contains('is-phone') ? surface : null
            const savedTop = scroller ? scroller.scrollTop : window.scrollY
            const savedLeft = scroller ? scroller.scrollLeft : window.scrollX
            const prevZ = surface.style.getPropertyValue('--iw-editor-zoom')
            const prevCis = surface.style.getPropertyValue('--iw-cis-scale')
            const z = stepToZoom(k)
            surface.style.setProperty('--iw-editor-zoom', String(z))
            if (prevCis) surface.style.setProperty('--iw-cis-scale', ((z / z0) ** 2).toFixed(4))
            let geo: BandGeo | null = null
            try {
              geo = readBands()
            } finally {
              if (prevZ) surface.style.setProperty('--iw-editor-zoom', prevZ)
              else surface.style.removeProperty('--iw-editor-zoom')
              if (prevCis) surface.style.setProperty('--iw-cis-scale', prevCis)
              if (scroller) { scroller.scrollTop = savedTop; scroller.scrollLeft = savedLeft }
              else window.scrollTo(savedLeft, savedTop)
            }
            if (geo) { liveCache.set(k, geo); cacheStats.warmed++ }
          }
          const scheduleLiveWarm = (step: number, from: number | null, gapMs: number, placeholders: boolean, z0: number) => {
            cancelLiveWarm()
            const plan = planLiveWarm({
              enabled: (window as unknown as { __iwLiveWarm?: boolean }).__iwLiveWarm !== false, // live known-negative
              placeholders, phone: phoneLike(), step, from, gapMs,
              delayMs: LIVE_WARM_DELAY_MS, lastWarmMs,
              minStep: ZOOM_STEP_MIN, maxStep: ZOOM_STEP_MAX, cached: liveCache.has(step + Math.sign(step - (from ?? step))),
            })
            if (!plan.warm) return
            const k = plan.step
            liveWarmTimer = setTimeout(() => {
              liveWarmTimer = undefined
              // ⚠ Re-checked AT FIRE TIME, never at schedule time: 45ms is long enough for the
              // gesture to have ended, the window to have come down, or another step to have landed,
              // and a warm under any of those caches geometry no commit can reproduce (R7).
              if (destroyed || !(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold) return
              if (!(view.dom as HTMLElement).classList.contains('iw-zoom-live')) return
              if (currentStep() !== step) return
              const t0 = performance.now()
              measureLiveStep(k, z0)
              lastWarmMs = performance.now() - t0
              probePerf('zoom-liveWarm', lastWarmMs)
            }, LIVE_WARM_DELAY_MS)
          }
          const onZoomStep = (e: Event) => {
            const d = (e as CustomEvent).detail as { step?: number; surface?: Element; z0?: number; resync?: boolean } | undefined
            if (!gapped || !sheet || !layer || !d || typeof d.step !== 'number') return
            if (d.surface !== surfaceOf()) return // another surface's zoom (SnapshotView) — not ours
            cancelLiveWarm() // a notch has landed: whatever we were about to warm is superseded
            const placeholders = (view.dom as HTMLElement).classList.contains('iw-zoom-live')
            const cache = placeholders ? liveCache : stepCache
            if (d.resync) {
              // The zoom guard (Scroll.tsx) detected a content-visibility relevancy wave between
              // commits: the layout shifted, so every placeholder-regime entry is stale — drop
              // them and re-derive the bands from the CURRENT layout in this same task.
              liveCache.clear()
              const geo = readBands()
              if (geo) { applyBands(geo); cache.set(d.step, geo) }
              return
            }
            const hit = cache.get(d.step)
            if (hit) {
              cacheStats.hits++
              // AUDIT (probe-only, `window.__iwWarmAudit = true`): is a cached entry the same
              // geometry a live measure would produce at this instant? ⚠ A cache that is fast and
              // WRONG is the regression this subsystem exists to prevent, so the question must be
              // ASKABLE rather than argued about (R3).
              if ((window as unknown as { __iwWarmAudit?: boolean }).__iwWarmAudit) {
                const live = readBands()
                if (live) {
                  let dT = 0, dH = 0
                  const n = Math.min(live.tops.length, hit.tops.length)
                  for (let i = 0; i < n; i++) { dT = Math.max(dT, Math.abs(live.tops[i] - hit.tops[i])); dH = Math.max(dH, Math.abs(live.heights[i] - hit.heights[i])) }
                  const w = (window as unknown as { __iwWarmAuditLog?: unknown[] })
                  ;(w.__iwWarmAuditLog ||= []).push({ step: d.step, bandsLive: live.tops.length, bandsHit: hit.tops.length,
                    maxTopDelta: +dT.toFixed(1), maxHeightDelta: +dH.toFixed(1), totalDelta: +(live.total - hit.total).toFixed(1) })
                }
              }
              const tA0 = performance.now()
              applyBands(hit)
              probePerf('zoom-applyBands', performance.now() - tA0)
            }
            else {
              // MISS → measure the bands LIVE, synchronously, in this same task. Scroll.tsx forces
              // the step's layout (its anchor read) before dispatching, so readBands' single-pass
              // rect reads ride it — visually identical to a hit, one layout flush dearer. Bands
              // and text land in the SAME frame — no join, no overflow.
              cacheStats.misses++
              const tR0 = performance.now()
              const geo = readBands()
              const tR1 = performance.now()
              probePerf('zoom-readBands', tR1 - tR0)
              if (geo) { applyBands(geo); cache.set(d.step, geo); probePerf('zoom-applyBands', performance.now() - tR1) }
            }
            // ARM THE NEXT STEP'S WARM. ⚠ Direction from the PREVIOUS committed step where there is
            // one, else from the gesture's own start zoom (z0) — the first notch is exactly the one
            // a writer notices, so it must not be the one that cannot predict.
            const now = performance.now()
            const gap = lastStepIdx === null ? Infinity : now - lastStepAt
            // ⚠ A step seen a second ago is this gesture's previous notch (and catches a mid-gesture
            // reversal); anything older belongs to a FINISHED gesture and must not be trusted as
            // "where we came from" — the gesture's own start zoom is, and it is monotonic (R7).
            const from = gap <= 1000 ? lastStepIdx : (typeof d.z0 === 'number' ? zoomToStep(d.z0) : null)
            lastStepAt = now
            lastStepIdx = d.step
            scheduleLiveWarm(d.step, from, gap, placeholders, d.z0 ?? stepToZoom(d.step))
          }
          window.addEventListener('inkwave:zoom-step', onZoomStep)
          // Idle precompute: one step per frame, nearest-first, until the WHOLE lattice is warm (it
          // is only ~18 steps and a miss costs a synchronous mid-gesture reflow). Each measure is
          // the canonicalMeasure trick on the LIVE zoom var — set, read, restore, one task, never
          // painted. ⚠ STRICTLY DESKTOP AND GENUINELY IDLE: never during a gesture, never in a
          // typing pause, never on phone, never while hidden. Each step is a full-document
          // hypothetical reflow, and the old 350ms start landed ~18 long frames right on the reveal
          // chain. A zoom during the cold window stays CORRECT — a miss measures live.
          // → docs/archive/pagination-rounds.md#step-cache
          let preTimer: ReturnType<typeof setTimeout> | undefined
          let preRaf = 0
          let quietUntil = 0
          // ⚠ The raw last-input timestamp is kept ALONGSIDE `quietUntil`, not derived from it:
          // quietUntil is a POLICY (a 1500ms hold tuned for the full-lattice sweep) and the early
          // warm needs the underlying FACT so it can apply its own, much shorter hold (R9).
          let lastInputAt = 0
          const bumpQuiet = (ms: number) => {
            quietUntil = Math.max(quietUntil, performance.now() + ms)
          }
          const onPreActivity = () => {
            lastInputAt = performance.now()
            bumpQuiet(1500)
            // ⚠ CANCEL the zoom-scoped warm on ANY input (Peter: "scrolling is jittery") — each warm
            // step is a full-document hypothetical reflow. The 150ms grace exempts the settle's OWN
            // scroll events; anything later is a real user input (R9).
            if (performance.now() > zoomWarmStart + 150) zoomWarmUntil = 0
          }
          const onPreChoreo = () => bumpQuiet(3000)
          const PRE_ACT_EVS = ['pointerdown', 'wheel', 'keydown', 'touchmove', 'scroll'] as const
          const PRE_CHOREO_EVS = ['inkwave:open-begin', 'inkwave:reveal-imminent', 'inkwave:editor-revealed'] as const
          PRE_ACT_EVS.forEach((ev) => window.addEventListener(ev, onPreActivity, { passive: true, capture: true }))
          PRE_CHOREO_EVS.forEach((ev) => window.addEventListener(ev, onPreChoreo))
          bumpQuiet(3000) // the mount itself is a choreography
          // ZOOM-SCOPED WARM WINDOW (Peter: "build/refresh the step cache only on zoom-zone entry /
          // first step / idle after settle — never on the typing path"). The idle gate's activity
          // events include 'wheel'/'scroll', so a zoom session pushed its own warm-up out 1.5s
          // forever and the cache was measured COLD through whole gestures. A settle opens this
          // window: inside it the quietUntil gate is bypassed (typing and the gesture hold still
          // block) and the warm is RADIUS-LIMITED, so the next notches hit without a full-lattice
          // reflow burst on every settle. → docs/archive/pagination-rounds.md#step-cache
          let zoomWarmUntil = 0
          let zoomWarmStart = 0 // grace anchor: inputs within 150ms of the settle are our own
          const ZOOM_WARM_RADIUS = 5
          const preBusy = () =>
            (window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold === true
            || editDebounce !== undefined
            || bibDebounce !== undefined
            || (performance.now() < quietUntil && performance.now() >= zoomWarmUntil)
            || document.visibilityState === 'hidden'
          const nextUncached = (): number | null => {
            const k0 = currentStep()
            const radius = performance.now() < zoomWarmUntil ? ZOOM_WARM_RADIUS : ZOOM_STEP_MAX - ZOOM_STEP_MIN
            for (let d = 0; d <= radius; d++) {
              for (const k of d === 0 ? [k0] : [k0 + d, k0 - d]) {
                if (k < ZOOM_STEP_MIN || k > ZOOM_STEP_MAX) continue
                if (!stepCache.has(k)) return k
              }
            }
            return null
          }
          const measureStep = (k: number) => {
            const surface = surfaceOf()
            if (!surface || !sheet || !layer) return
            // The hypothetical layout can be shorter than the live one → the browser would clamp
            // the scroll; save/restore exactly (same pattern as the canonical measure window).
            const scroller = surface.classList.contains('iw-fill') && !surface.classList.contains('is-phone') ? surface : null
            const savedTop = scroller ? scroller.scrollTop : window.scrollY
            const savedLeft = scroller ? scroller.scrollLeft : window.scrollX
            const prev = surface.style.getPropertyValue('--iw-editor-zoom')
            surface.style.setProperty('--iw-editor-zoom', String(stepToZoom(k)))
            let geo: BandGeo | null = null
            try {
              geo = readBands() // forces the hypothetical layout; set → read → restore never paints
            } finally {
              if (prev) surface.style.setProperty('--iw-editor-zoom', prev)
              else surface.style.removeProperty('--iw-editor-zoom')
              if (scroller) { scroller.scrollTop = savedTop; scroller.scrollLeft = savedLeft }
              else window.scrollTo(savedLeft, savedTop)
            }
            if (geo) { stepCache.set(k, geo); cacheStats.precomputed++ }
          }
          const precomputeTick = () => {
            preRaf = 0
            if (destroyed || !gapped || phoneLike()) return
            if (preBusy()) { schedulePrecompute(500); return } // back off, retry when quiet
            const k = nextUncached()
            if (k == null) return // the whole lattice is warm
            const preT0 = performance.now() // perflog: each step is a full hypothetical reflow
            measureStep(k)
            notePerf('precompute-step', performance.now() - preT0)
            preRaf = requestAnimationFrame(precomputeTick) // spread: one hypothetical reflow per frame
          }
          const schedulePrecompute = (delay = 350) => {
            if (!gapped) return // panels are the cache's only consumer; markers repaint live
            if (preTimer) clearTimeout(preTimer)
            preTimer = setTimeout(() => {
              preTimer = undefined
              if (!preRaf) preRaf = requestAnimationFrame(precomputeTick)
            }, delay)
          }
          // EARLY WARM (Peter: "are we warm loading the first few levels of zoom in and out… it
          // feels slow coz its lagging, not the actual distance"). Every reveal-chain event bumps
          // `preBusy()`'s quietUntil by 3000ms, so the FULL warm cannot start until seconds after
          // the page is interactive — and a writer who opens a document and reaches for zoom hits a
          // stone-cold cache, which reads as "laggy" rather than "needs more finger travel".
          // ⚠ IT DOES NOT TOUCH quietUntil OR preBusy — a SEPARATE warm, fired once a short beat
          // after the reveal, that skips only the part of preBusy protecting the reveal's own
          // settling from a much bigger sweep. It still defers behind a genuine gesture or edit.
          // → docs/archive/pagination-rounds.md#step-cache
          let earlyWarmDone = false
          const earlyWarmTick = (remaining: number[]) => {
            if (destroyed || !gapped || phoneLike() || earlyWarmDone) return
            if (remaining.length === 0) { earlyWarmDone = true; return }
            // Defer while anything real is happening: __iwZoomHold covers an in-flight gesture, the
            // debounces cover typing, and `lastInputAt` covers scroll/pointer work nothing else here
            // would catch. ⚠ 250ms, deliberately far shorter than the full sweep's 1500ms hold —
            // this warm must resume promptly BETWEEN a writer's interactions (R9).
            const busy = (window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold === true
              || editDebounce !== undefined || bibDebounce !== undefined
              || document.visibilityState === 'hidden'
              || performance.now() - lastInputAt < 250
            if (busy) { setTimeout(() => earlyWarmTick(remaining), 300); return }
            const [k, ...rest] = remaining
            if (!stepCache.has(k)) measureStep(k)
            requestAnimationFrame(() => earlyWarmTick(rest))
          }
          const onEarlyWarm = () => {
            if (earlyWarmDone) return
            window.removeEventListener('inkwave:editor-revealed', onEarlyWarm)
            // ⚠ WARM THE WHOLE LATTICE, nearest-first (Peter: "goes like three zooms then stops then
            // another three"). That symptom IS a five-step radius: the gesture walks off the warm
            // edge into cold steps that each cost a synchronous full-document reflow. The lattice is
            // only ~20 steps, so warming all of it removes the cliff rather than moving it. Cost
            // stays bounded and paced — one reflow per frame, each deferred by the busy check.
            const k0 = currentStep()
            const steps: number[] = []
            for (let d = 0; d <= ZOOM_STEP_MAX - ZOOM_STEP_MIN; d++) {
              for (const k of d === 0 ? [k0] : [k0 + d, k0 - d]) {
                if (k >= ZOOM_STEP_MIN && k <= ZOOM_STEP_MAX && !steps.includes(k)) steps.push(k)
              }
            }
            setTimeout(() => earlyWarmTick(steps), 400)
          }
          window.addEventListener('inkwave:editor-revealed', onEarlyWarm)

          // Latch + announce the FIRST successful measure — the editor's one-paint reveal gate
          // (TiptapEditor `settled`) waits for it so text and page marks appear together. Plus the
          // every-measure announcement (not latched): Scroll.tsx re-anchors the viewport around
          // the post-zoom re-measure, and PageGuides re-reads the marker positions, off this signal.
          const announceMeasured = () => {
            if (!(window as unknown as { __iwPaginationReady?: boolean }).__iwPaginationReady) {
              ;(window as unknown as { __iwPaginationReady?: boolean }).__iwPaginationReady = true
              window.dispatchEvent(new Event('inkwave:pagination-ready'))
            }
            window.dispatchEvent(new Event('inkwave:pagination-measured'))
            schedulePrecompute() // idle re-warm of the step lattice (no-op when already warm)
          }
          const recompute = () => {
            raf = 0
            ensureSheet()
            const paper = getPaperSize()
            const topM = getTopMarginPx()
            // Marker mode bails where pages don't apply: continuous 'scroll' paper, and
            // multi-column layouts (column flow can't be line-measured into pages — the guides
            // fall back to the uniform canonical model in Scroll.tsx). Gapped mode keeps its
            // historical behaviour: 'scroll' paper still paginates (at the rendered width;
            // columns are disabled by Scroll.tsx while gapped).
            if (!gapped && (paper === 'scroll' || getColumns() > 1)) {
              const cur = KEY.getState(view.state)
              if (cur && cur !== DecorationSet.empty) {
                view.dispatch(view.state.tr.setMeta(KEY, DecorationSet.empty).setMeta('addToHistory', false))
                lastLayoutSig = ''; lastSet = DecorationSet.empty
              }
              lastInputSig = ''
              announceMeasured()
              return
            }
            // CANONICAL page geometry (pageModel): physical mm through the 96dpi reference px —
            // NOT sheet.clientWidth, whose integer rounding flips with browser zoom / DPR (and
            // even at 100% baked a per-page error in vs the printed 297mm page). Only 'scroll'
            // paper (gapped mode — the ungapped case bailed above) has no mm identity → keep the
            // paper ratio on the rendered width; print parity is impossible there anyway. Phones
            // no longer take this path: they measure inside the forced canonical context below,
            // so phone breaks = desktop breaks = print breaks.
            const fluid = paper === 'scroll'
            const { pageWidthPx, pageHeightPx: pageH } = pageBoxPx({
              paperSize: paper === 'letter' ? 'letter' : 'a4',
              orientation: getOrientation(),
              topMarginPx: topM,
              bottomMarginPx: MARGIN_BOTTOM,
              fluidWidthPx: fluid && sheet ? sheet.clientWidth : undefined,
            })
            lastPageH = pageH // applyBands' full-final-page fallback (single-page docs)
            if (sheet && gapped) {
              sheet.classList.add('inkwave-gapped')
              // Keep paddingTop in sync with the user's top-margin setting so page 1 content
              // starts at the same Y as in non-gapped mode — this makes the gap land at
              // pageH - MARGIN_BOTTOM, matching the dashed rule position in PageGuides.
              sheet.style.paddingTop = `${phoneLike() ? PHONE_PAGE_MARGIN : topM}px`
              // Enforce a minimum one-page scroll height so the footer always lands at the page
              // bottom, never mid-content on short documents.
              // ⚠ The baseline must respect applyBands' full-final-page extension (`lastMinH`):
              // writing bare pageH shrank the sheet the paint pass had just grown and the RO
              // ping-ponged between the two writes forever. Stale-larger for one pass is fine.
              if (pageH > 0) sheet.style.minHeight = `${Math.max(pageH, lastMinH)}px`
            }
            // ⚠ ONLY RE-MEASURE WHEN THE CANONICAL LAYOUT CHANGED — doc size, pageH, top margin.
            // Our own setMeta dispatches don't change these, so they cannot loop, and a window or
            // sheet resize early-returns here and merely repositions the panels.
            // ⚠ EDITOR FONT-ZOOM IS DELIBERATELY NOT IN THIS SIGNATURE: canonical breaks don't
            // depend on it, and re-measuring DURING the gesture lurched the text. The settle
            // ('inkwave:zoom-settled') drives one clean re-measure instead.
            // → docs/archive/pagination-rounds.md#measure-scheduling
            const inputSig = `${view.state.doc.content.size}:${Math.round(pageH)}:${topM}`
            if (inputSig === lastInputSig) { if (gapped) schedulePaint(); return }
            lastInputSig = inputSig
            const measureT0 = performance.now() // perflog: the full canonical-measure cost (phone lag hunt)

            // ── ARITH FIRST ──
            // ⚠ The arithmetic path is the CHEAPEST acquisition, so it must be tried BEFORE the
            // scoped measure. Living in the FULL path only made it run on the FIRST measure and
            // never again — and citation boxes WARM UP, so the one measure it ever got was the one
            // before any box existed. Trying it first makes the warm-up self-healing: measure 1
            // defers and harvests, measure 2 is arithmetic.
            // ⚠ On success incState is CLEARED: the incremental base belongs to the DOM regime, and
            // a later arith failure must re-establish it with a full measure rather than build a
            // delta on a base the arith era never maintained (R7).
            // → docs/archive/pagination-rounds.md#scoped-measure
            let measured: { set: DecorationSet; sig: string; meta: IncMeta | null } = { set: DecorationSet.empty, sig: 'empty', meta: null }
            let arithMeasured = false

            // ── 1. SCOPED ARITH — the cheapest acquisition there is ──
            // Only the CHANGED blocks are laid out (~0.1ms each); everything else reuses its cached
            // entry at telescoped tops. No forced context, no reflow, no DOM read — which is the
            // whole point, since the DOM scoped path's cost IS its forced context (two full-document
            // reflows on phone, 400–1100ms).
            // ⚠ Unlike whole-doc arith it PRESERVES incState, so consecutive typing pauses keep
            // hitting it instead of collapsing back to a full measure.
            if (arithLayoutOn() && !fluid && incState && !forceFullOnce && !(renderFillOn() && phoneLike())) {
              const surfaceA = (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
              const lhA = getComputedStyle(view.dom as HTMLElement).getPropertyValue('--inkwave-lh').trim()
              const incA = computeScoped(
                view, incState, lineCache, pageH, topM, gapped,
                {
                  surfaceEl: surfaceA,
                  scroller: null,
                  clearGapsIn: () => { /* arith reads no DOM — nothing to clear */ },
                },
                (r) => { incStats.reasons[`arith:${r}`] = (incStats.reasons[`arith:${r}`] ?? 0) + 1 },
                {
                  contentW: Math.floor((pageWidthPx - 2 * getSideMarginPx()) * 64) / 64,
                  ratio: lhA ? parseFloat(lhA) : (phoneLike() ? 1.55 : 1.618),
                  paraSpacingEm: getParaSpacingEm(),
                  measure: arithMeasureFn,
                  fontLoaded: arithFaceLoaded,
                  citationStyle: getCitationStyle(),
                  bibEpoch: bibProvider.getVersion(),
                },
              )
              if (incA) {
                incStats.inc++
                incState = incA.meta
                if (incA.sig !== lastLayoutSig) { lastLayoutSig = incA.sig; lastSet = incA.set }
                ;(window as unknown as { __iwPagSig?: string; __iwPagArith?: boolean }).__iwPagSig = incA.sig
                ;(window as unknown as { __iwPagArith?: boolean }).__iwPagArith = true
                view.dispatch(view.state.tr.setMeta(KEY, lastSet).setMeta('addToHistory', false))
                if (gapped) schedulePaint()
                announceMeasured()
                notePerf('page-measure-scoped-arith', performance.now() - measureT0)
                return
              }
            }

            // ── 2. WHOLE-DOC ARITH ──
            // Compute lines+blocks reflow-free and SKIP forceCanonicalContext with both its
            // full-document reflows — the phone per-pause win. ⚠ Gated to `!canonicalIsLive`: at
            // desktop defaults the reflow is already skipped, so there is nothing to win and the
            // DOM path stays authoritative. Any ineligible block ⇒ null ⇒ the DOM path runs, and
            // `meta` stays null so the next scoped measure bails back to this same cheap path.
            if (arithLayoutOn() && !fluid && !forceFullOnce
                && !canonicalIsLive((view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null)) {
              const contentW = Math.floor((pageWidthPx - 2 * getSideMarginPx()) * 64) / 64
              const lhRaw = getComputedStyle(view.dom as HTMLElement).getPropertyValue('--inkwave-lh').trim()
              const ratio = lhRaw ? parseFloat(lhRaw) : (phoneLike() ? 1.55 : 1.618)
              const am = buildArithMeasure(view.state.doc, contentW, ratio, getParaSpacingEm(), arithMeasureFn, arithFaceLoaded, true, 18, getCitationStyle(), bibProvider.getVersion())
              if (am) {
                ;(window as unknown as { __iwArithDump?: unknown }).__iwArithDump = {
                  blockStarts: am.blocks.slice(0, 4).map((b) => b.start),
                  b0lines: am.lines.filter((l) => l.blockIdx === 0).slice(0, 4).map((l) => l.pos),
                  nBlocks: am.blocks.length, nLines: am.lines.length,
                }
                const { decos, sig } = computeBreaks(am.lines as unknown as MeasuredLine[], am.blocks, findRefListPos(view.state.doc), pageH, topM, gapped, (l) => (l as unknown as { pos: number }).pos)
                measured = { set: DecorationSet.create(view.state.doc, decos), sig, meta: null }
                arithMeasured = true
                notePerf('page-measure-arith', performance.now() - measureT0)
              }
            }
            // ── SCOPED FIRST (Peter's round-6 spec): exact local measurement, ~one-screenful layout
            // cost, cached geometry + one delta for the distance. A bail falls through to the full
            // measure below, which refreshes the base; a full measure is also idle-scheduled after
            // every scoped one and forced before print. 'inkwave:pagCheck=1' runs BOTH.
            // ⚠ Render-fill on phone always takes the FULL path, so breaks never flip between the
            // canonical scoped measure and the render-width full one — two regimes, one pane (R7).
            if (!arithMeasured && !fluid && incState && !forceFullOnce && !(renderFillOn() && phoneLike())) {
              const surfaceEl0 = (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
              const editorEl0 = view.dom as HTMLElement
              const scroller0 = surfaceEl0 && surfaceEl0.classList.contains('iw-fill') && !surfaceEl0.classList.contains('is-phone')
                ? surfaceEl0 : null
              const savedTop0 = scroller0 ? scroller0.scrollTop : window.scrollY
              const savedLeft0 = scroller0 ? scroller0.scrollLeft : window.scrollX
              // ⚠ NO CONTENT-VISIBILITY WINDOW IN A MEASURE: cv-rendered blocks measure ~9px off
              // even on plain paragraphs, worse around citation nodeviews. EXACTNESS RULES — the
              // scoped measure runs in the plain forced canonical context, and the reflow cost is
              // skipped only where the live context already IS canonical.
              liveIsCanonical = canonicalIsLive(surfaceEl0) // before the force — see computeBreaks
              const restore0 = canonicalIsLive(surfaceEl0)
                ? () => { /* live layout ≡ canonical — nothing to force */ }
                : forceCanonicalContext(
                    { paper: sheet?.parentElement ?? null, sheet, surface: surfaceEl0, editor: editorEl0 },
                    { pageWidthPx, sideMarginPx: getSideMarginPx() },
                  )
              let inc: ReturnType<typeof computeScoped> = null
              try {
                // Region-scoped gap clear (natural wrapping around the edit — the full measure
                // clears the WHOLE set for the same reason; the final dispatch replaces it anyway).
                const clearGapsIn = (from: number, to: number) => {
                  const cur = KEY.getState(view.state)
                  if (!cur || cur === DecorationSet.empty) return
                  const found = cur.find(Math.max(0, from), Math.min(view.state.doc.content.size, to))
                  if (found.length) view.dispatch(view.state.tr.setMeta(KEY, cur.remove(found)).setMeta('addToHistory', false))
                }
                inc = computeScoped(view, incState, lineCache, pageH, topM, gapped, {
                  surfaceEl: surfaceEl0, scroller: scroller0, clearGapsIn,
                }, (reason) => { incStats.reasons[reason] = (incStats.reasons[reason] ?? 0) + 1 })
              } finally {
                restore0()
                if (scroller0) { scroller0.scrollTop = savedTop0; scroller0.scrollLeft = savedLeft0 }
                else window.scrollTo(savedLeft0, savedTop0)
              }
              if (inc) {
                let pagCheck = false
                try { pagCheck = localStorage.getItem('inkwave:pagCheck') === '1' } catch { /* private */ }
                if (!pagCheck) {
                  incStats.inc++
                  // Publish the scoped sig too: this path RETURNS early, so without this a probe
                  // reading __iwPagSig sees the last FULL measure's (pre-edit) sig and compares two
                  // different doc states. Diagnostic only.
                  ;(window as unknown as { __iwPagSig?: string; __iwPagArith?: boolean }).__iwPagSig = inc.sig
                  ;(window as unknown as { __iwPagArith?: boolean }).__iwPagArith = false
                  incState = inc.meta
                  if (inc.sig !== lastLayoutSig) {
                    lastLayoutSig = inc.sig
                    lastSet = inc.set
                  }
                  view.dispatch(view.state.tr.setMeta(KEY, lastSet).setMeta('addToHistory', false))
                  if (gapped) schedulePaint()
                  announceMeasured()
                  notePerf('page-measure-scoped', performance.now() - measureT0)
                  // ⚠ THE LAZY EXACT REFRESH — a full measure MUST follow every scoped one. Where it
                  // is cheap (canonicalIsLive skips both reflows) re-verify FAST, so a deferred
                  // mid-paragraph split lands ~0.5s after the pause (Peter: "paras should split over
                  // pages even if they render 0.2s late; the cursor line moves instantly"). Phone
                  // keeps the long fuse — its full measure costs real time.
                  scheduleIdleFull(canonicalIsLive(surfaceEl0) ? 450 : 2500)
                  return
                }
                // pagCheck: remember the scoped result, fall through to the full measure, compare
                // after (the full result is authoritative either way).
                ;(window as unknown as { __iwPagIncSig?: string }).__iwPagIncSig = inc.sig
              } else {
                incStats.bail++
              }
            }
            const wasForceFull = forceFullOnce // capture before reset — a print/export/measure-now pass
            forceFullOnce = false

            // ⚠ THE CANONICAL MEASUREMENT CONTEXT — the breaks must be the SAME document positions
            // at every editor zoom and on every device (phone == desktop == print). ONE forced
            // layout: true mm paper width, desktop print side margins, `--iw-editor-zoom` 1 and the
            // 1.125rem base font inline (which defeats the phone's ×1.25 boost). Set → measure →
            // restore is synchronous inside one rAF, so the forced layout never paints; its two
            // extra reflows are affordable only because measures are DEBOUNCED, never per-keystroke.
            // ⚠ FLUID 'scroll' PAPER KEEPS ITS RENDERED WIDTH, BUT NOT ITS RENDERED FONT. Skipping
            // the force there measured the live zoomed font, so the words per page changed with the
            // editor zoom — pass no paper/sheet, and zoom/magnify/font stay pinned (R9).
            // → docs/archive/pagination-rounds.md#canonical-measure
            //
            // Decision 1: RENDER-FILL phone splits (flag inkwave:renderFill). Live phone editor
            // only, never print/export (forceFullOnce), measured at the LIVE RENDER width so
            // mid-paragraph splits fill the last line. Any ineligible block ⇒ null ⇒ falls through.
            if (renderFillOn() && phoneLike() && !fluid && !wasForceFull) {
              // ⚠ Measured through the SHARED `renderWrapCtx` — the floored fractional content box.
              // clientWidth's integer rounding fed the engine +0.42px too generous ~6/88 times at
              // 22.5px, fitting one word too many.
              const rc = renderWrapCtx()
              const am = rc
                // atomBoxes=true: an atom is eligible iff it SUPPLIES a box. Citations now do (the
                // opaque-box cache); inline math still supplies none, so it defers on !box.
                ? buildArithMeasure(view.state.doc, rc.w, rc.ratio, getParaSpacingEm(), arithMeasureFn, arithFaceLoaded, true, rc.base, getCitationStyle(), bibProvider.getVersion())
                : null
              if (am) {
                const { decos, sig } = computeBreaks(am.lines as unknown as MeasuredLine[], am.blocks, findRefListPos(view.state.doc), pageH, topM, gapped, (l) => (l as unknown as { pos: number }).pos)
                measured = { set: DecorationSet.create(view.state.doc, decos), sig, meta: null }
                arithMeasured = true
                notePerf('page-measure-renderfill', performance.now() - measureT0)
              }
            }
            let tClear = 0, tCompute = 0, tRestore = 0, tDispatch = 0 // perflog phase attribution (DOM path)
            // Held across the try/finally so the scroll can be re-asserted AFTER the decorations
            // land — see the note at the dispatch below. Null on the arith path (no DOM measure).
            let scrollerRef: HTMLElement | null = null
            let savedTopRef = 0
            let tPhase = performance.now()
            if (!arithMeasured) {
            const surfaceEl = (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
            const editorEl = view.dom as HTMLElement
            // Ask BEFORE the force: inside that window the DOM is canonical by construction.
            liveIsCanonical = canonicalIsLive(surfaceEl)
            const restore = !fluid && canonicalIsLive(surfaceEl)
              ? () => { /* live layout ≡ canonical (desktop at defaults) — skip both reflows */ }
              : forceCanonicalContext(
                  fluid
                    ? { surface: surfaceEl, editor: editorEl }
                    : { paper: sheet?.parentElement ?? null, sheet, surface: surfaceEl, editor: editorEl },
                  { pageWidthPx, sideMarginPx: getSideMarginPx() },
                )
            // The canonical layout is usually SHORTER than a zoomed/phone one, so the forced
            // layout can CLAMP the scroll offset — capture it and put it back after the restore.
            // Desktop live editor scrolls the surface (.iw-fill:not(.is-phone) in index.css);
            // the phone body-scrolls (it has iw-fill too, but the CSS excludes it).
            const scroller = surfaceEl && surfaceEl.classList.contains('iw-fill') && !surfaceEl.classList.contains('is-phone')
              ? surfaceEl : null
            const savedTop = scroller ? scroller.scrollTop : window.scrollY
            const savedLeft = scroller ? scroller.scrollLeft : window.scrollX
            scrollerRef = scroller; savedTopRef = savedTop
            tPhase = performance.now()
            try {
              // The gap widgets are display:block, so they FORCE line breaks — which means a word
              // can't wrap back across a page boundary, and measuring the line layout with them
              // present shows the forced break, not the natural wrap (so deletions never reflowed
              // back). Fix: clear the gaps first so the DOM reflows to its NATURAL wrapping,
              // measure THAT, then re-add the gaps — the cleared state never paints (same window).
              const cur = KEY.getState(view.state)
              if (cur && cur !== DecorationSet.empty) {
                view.dispatch(view.state.tr.setMeta(KEY, DecorationSet.empty).setMeta('addToHistory', false))
              }
              tClear = performance.now() - tPhase; tPhase = performance.now()
              // Canonical context forces --iw-magnify to 1 on BOTH paths (fluid included) — the
              // transform is scale(var(--iw-magnify)), so inside this window the DOM is genuinely
              // unscaled and rects come back in layout px. scale=1 here is therefore CORRECT (do
              // NOT wire the live magnify.getMagnify() in: it describes the DOM outside this
              // window). collectLines keeps its scale param for any future out-of-window measure.
              // Fluid 'scroll' paper measures at the LIVE width — its canonical layout changes with
              // the window, so the block-line cache (fixed-context only) is not passed there.
              measured = compute(view, pageH, topM, 1, gapped, fluid ? undefined : lineCache)
              tCompute = performance.now() - tPhase; tPhase = performance.now()
            } finally {
              restore()
              if (scroller) { scroller.scrollTop = savedTop; scroller.scrollLeft = savedLeft }
              else window.scrollTo(savedLeft, savedTop)
              tRestore = performance.now() - tPhase; tPhase = performance.now()
            }
            } // end DOM-measure path (skipped when arithMeasured)
            const { set, sig } = measured
            ;(window as unknown as { __iwPagSig?: string; __iwPagArith?: boolean }).__iwPagSig = sig
            ;(window as unknown as { __iwPagArith?: boolean }).__iwPagArith = arithMeasured
            incStats.full++
            if (!fluid) incState = measured.meta // base for the next incremental (null when poisoned)
            {
              const w = window as unknown as { __iwPagIncSig?: string }
              if (w.__iwPagIncSig !== undefined) {
                ;(window as unknown as { __iwPagChecked?: number }).__iwPagChecked =
                  ((window as unknown as { __iwPagChecked?: number }).__iwPagChecked ?? 0) + 1
                if (w.__iwPagIncSig !== sig) {
                  const a = w.__iwPagIncSig.split('|')
                  const b = sig.split('|')
                  let d = 0
                  while (d < a.length && d < b.length && a[d] === b[d]) d++
                  console.error(`[inkwave:pagCheck] INCREMENTAL/FULL BREAK MISMATCH at seg ${d}: inc=${a.slice(d, d + 3).join('|')} full=${b.slice(d, d + 3).join('|')} (${a.length}/${b.length} segs)`)
                  ;(window as unknown as { __iwPagMismatch?: number }).__iwPagMismatch =
                    ((window as unknown as { __iwPagMismatch?: number }).__iwPagMismatch ?? 0) + 1
                }
                delete w.__iwPagIncSig
              }
            }
            // Only update the set when gap positions actually changed (sig differs). When sig is the
            // same, restore the PREVIOUS set (not the freshly-computed one) to avoid propagating any
            // sub-pixel rounding differences in botMargin — the main cause of page-height flicker on
            // typing near a gap. Both sets are semantically equivalent; using the stable cached one
            // prevents the gap widget height from jittering by ±1px on every keystroke.
            if (sig !== lastLayoutSig) {
              lastLayoutSig = sig
              lastSet = set
            }
            view.dispatch(view.state.tr.setMeta(KEY, lastSet).setMeta('addToHistory', false))
            // ⚠ RE-ASSERT THE SCROLL AFTER THE GAPS ARE BACK. The measure clears the gap widgets
            // first, which makes a paginated document dramatically SHORTER, so the browser CLAMPS
            // scrollTop — and the `finally`'s restore was written while the gaps were still gone,
            // i.e. one layout too early. Assert it again now the document is its real height, and
            // once more next frame for the paint that follows (R7). This is Peter's "the doc keeps
            // jumping down… it's either on a timer or when something loads": the measure is
            // idle-gated, so it fires with nobody looking at the document it moves.
            // → docs/archive/pagination-rounds.md#scroll-reassert
            if (scrollerRef) {
              if (scrollerRef.scrollTop !== savedTopRef) scrollerRef.scrollTop = savedTopRef
              const el2 = scrollerRef, want = savedTopRef
              requestAnimationFrame(() => { if (Math.abs(el2.scrollTop - want) > 1) el2.scrollTop = want })
            }
            tDispatch = performance.now() - tPhase
            // Re-measure & reposition the sheet panels after the decorations land (DOM settled).
            if (gapped) schedulePaint()
            announceMeasured()
            notePerf('page-measure', performance.now() - measureT0)
            notePerf('pm-clear', tClear)
            notePerf('pm-compute', tCompute)
            notePerf('pm-restore', tRestore)
            notePerf('pm-dispatch', tDispatch)
          }
          const schedule = () => { if (!raf) raf = requestAnimationFrame(recompute) }
          const forceRecompute = () => { lastInputSig = ''; schedule() }
          // ⚠ INPUT PRIORITY: edit-driven re-measures are DEBOUNCED OFF THE KEYSTROKE. recompute
          // forces a full-document layout read and dispatches two meta transactions — per keystroke
          // that was the single biggest stutter source. The gap decorations are position-mapped
          // through each edit in apply(), so they ride along correctly while we wait.
          // ⚠ PHONE WAITS FOR A GENUINE PAUSE (Peter: "character input is priority #1 — reflow can
          // wait"): 850ms, stretched to 1200ms with the keyboard up, because each measure is THREE
          // forced reflows and at 150ms it landed in ordinary inter-word pauses and froze the next
          // keystroke. Desktop stays 150ms; the FIRST measure (the reveal latch) is untouched.
          // → docs/archive/pagination-rounds.md#measure-scheduling
          let editDebounce: ReturnType<typeof setTimeout> | undefined
          const editDelayMs = () => {
            if (!phoneLike()) return 150
            return (window as unknown as { __iwKeyboardUp?: boolean }).__iwKeyboardUp ? 1200 : 850
          }
          const scheduleAfterEdit = () => {
            if (editDebounce) clearTimeout(editDebounce)
            editDebounce = setTimeout(() => { editDebounce = undefined; schedule() }, editDelayMs())
          }
          schedule()
          // Web fonts (EB Garamond) load AFTER first paint and reflow the text, moving every line —
          // but a font swap changes neither the doc size nor the page width, so the inputSig guard
          // would skip re-measuring (the break sits wrong until an edit nudges it). Force a fresh
          // measure once fonts are ready (and on any later font load).
          let destroyed = false
          // Block-line cache (see collectLines): valid while the canonical CONTEXT is stable.
          // Replaced wholesale on the same triggers that invalidate the zoom step cache below —
          // fonts, page settings, bibliography label hydration. Doc edits self-invalidate by
          // node identity. WeakMap keys are PM nodes, so dropped blocks collect naturally.
          let lineCache: LineCache = new WeakMap()
          let incState: IncMeta | null = null // last successful measure's block layout (incremental base)
          let forceFullOnce = false // next recompute skips the scoped path (idle refresh / print floor)
          let idleFullTimer: ReturnType<typeof setTimeout> | undefined
          // LAZY EXACT REFRESH: after every scoped measure, a genuine-idle full measure re-verifies
          // the whole document quietly (sig-guard → no visible change when the scoped result was
          // exact) and refreshes the incremental base. Input-gated by the same recency signal the
          // step-cache precompute uses (preBusy), so it never lands in a typing pause.
          const scheduleIdleFull = (delay = 2500) => {
            if (idleFullTimer) clearTimeout(idleFullTimer)
            idleFullTimer = setTimeout(function idleFull() {
              idleFullTimer = undefined
              if (destroyed) return
              if (preBusy()) { idleFullTimer = setTimeout(idleFull, Math.min(1200, delay)); return }
              forceFullOnce = true
              forceRecompute()
            }, delay)
          }
          const incStats = { inc: 0, full: 0, bail: 0, reasons: {} as Record<string, number> } // probe counters
          ;(window as unknown as { __iwPagInc?: typeof incStats }).__iwPagInc = incStats
          // Citation boxes are keyed by citekeys+style+bib-epoch — which covers a hydration or a
          // style switch — but NOT a change to the canonical CONTEXT itself (fonts finish loading,
          // page settings/paper change): the same label then renders at a different width under the
          // same key. So the boxes die exactly where the line cache does.
          const clearLineCache = () => { lineCache = new WeakMap(); incState = null; clearCiteBoxes() }
          const fontCb = () => { if (!destroyed) { clearLineCache(); clearStepCache(); forceRecompute() } }
          if (typeof document !== 'undefined' && document.fonts) {
            document.fonts.ready.then(fontCb).catch(() => {})
            document.fonts.addEventListener?.('loadingdone', fontCb)
          }
          // Re-measure when page settings (top margin, paper size, orientation) change.
          const settingsCb = () => { if (!destroyed) { clearLineCache(); clearStepCache(); forceRecompute() } }
          window.addEventListener('inkwave:page-settings-changed', settingsCb)
          // Re-measure when the bibliography hydrates or changes. Citation labels render "?key"
          // until the library loads, then rebuild asynchronously to their real widths ("Author &
          // Author, 2004") — a whole-document reflow that changes NOTHING in inputSig (doc size,
          // pageH, topM), so on a citation-heavy doc the load-time breaks stayed measured against
          // the placeholder layout until some unrelated trigger (zoom-settle, an edit) re-measured
          // — which read as "the pages move when you zoom". Debounced past the nodeviews' own
          // queueMicrotask/setState rebuild; the sig guards make it a no-op when breaks didn't move.
          let bibDebounce: ReturnType<typeof setTimeout> | undefined
          const bibCb = () => {
            clearLineCache() // citation labels change block rendering without changing node identity
            clearStepCache() // citation labels re-measure → per-step geometry stale
            if (destroyed) return
            if (bibDebounce) clearTimeout(bibDebounce)
            bibDebounce = setTimeout(() => { bibDebounce = undefined; forceRecompute() }, 180)
          }
          const unsubBib = bibProvider.subscribe(bibCb)
          // The zoom settle. Canonical breaks cannot move with zoom by construction, and the ATOMIC
          // EXIT already applied full-regime band geometry in the exit task — so ⚠ BOTH PLATFORMS
          // DEFER EVERYTHING HEAVY OFF THE SETTLE (Peter: "text reflow should be no slower than
          // before; pages painted instantly from the math"): no immediate measure, no immediate
          // paint. The full verify runs at genuine idle and the zoom-scoped warm in the same quiet
          // gaps, both cancelled by any input.
          // → docs/archive/pagination-rounds.md#step-cache
          const zoomCb = () => {
            if (destroyed) return
            liveCache.clear() // gesture over — placeholder-regime geometry is stale for the next gesture
            if (phoneLike()) return // exit already applied exact bands; nothing settles-time on phone
            zoomWarmStart = performance.now()
            zoomWarmUntil = zoomWarmStart + 2000
            scheduleIdleFull(600)
            schedulePrecompute(250)
          }
          window.addEventListener('inkwave:zoom-settled', zoomCb)
          // PRINT FLOOR (round-6, Peter: "render it all properly at time of print"): canonical
          // consumers must NEVER see lazily-stale breaks. Before the print dialog (and on the
          // explicit measure-now request the export paths dispatch), run the FULL measure
          // SYNCHRONOUSLY — with a warm line cache it is cheap; correctness is absolute.
          const measureNowCb = () => {
            if (destroyed) return
            if (raf) { cancelAnimationFrame(raf); raf = 0 }
            forceFullOnce = true
            lastInputSig = ''
            recompute()
            if (paintRaf) { cancelAnimationFrame(paintRaf); paintRaf = 0 }
            paint() // panels/bands must match the fresh breaks before the dialog snapshots layout
          }
          window.addEventListener('beforeprint', measureNowCb)
          window.addEventListener('inkwave:measure-now', measureNowCb)
          return {
            // ⚠ THIS HOOK FIRES FOR EVERY `updateState`, INCLUDING UNRELATED REACT RE-RENDERS, so
            // both its jobs gate on DOC IDENTITY (persistent PM docs ⇒ unchanged doc, same
            // reference). Clearing the step cache per transaction wiped the warmed lattice at every
            // settle, so a zoom-in → zoom-out retrace missed every step it had just visited; and on
            // phone the word-count re-render alone stacked the queued measure to ~1.9s after the
            // last keystroke. A skipped reschedule loses nothing — a no-edit recompute early-returns
            // on inputSig. Desktop keeps the unconditional reset.
            // → docs/archive/pagination-rounds.md#measure-scheduling
            update: (view, prevState) => {
              const docChanged = !prevState || view.state.doc !== prevState.doc
              if (docChanged) clearStepCache()
              if (phoneLike() && !docChanged) return
              scheduleAfterEdit()
            },
            destroy() {
              destroyed = true
              ro?.disconnect()
              if (raf) cancelAnimationFrame(raf)
              if (paintRaf) cancelAnimationFrame(paintRaf)
              if (editDebounce) clearTimeout(editDebounce)
              if (bibDebounce) clearTimeout(bibDebounce)
              unsubBib()
              document.fonts?.removeEventListener?.('loadingdone', fontCb)
              window.removeEventListener('inkwave:page-settings-changed', settingsCb)
              window.removeEventListener('inkwave:zoom-settled', zoomCb)
              window.removeEventListener('beforeprint', measureNowCb)
              window.removeEventListener('inkwave:measure-now', measureNowCb)
              window.removeEventListener('inkwave:zoom-step', onZoomStep)
              window.removeEventListener('inkwave:arith-exit', onArithExit)
              window.removeEventListener('inkwave:editor-revealed', onEarlyWarm)
              PRE_ACT_EVS.forEach((ev) => window.removeEventListener(ev, onPreActivity, { capture: true } as EventListenerOptions))
              PRE_CHOREO_EVS.forEach((ev) => window.removeEventListener(ev, onPreChoreo))
              if (preTimer) clearTimeout(preTimer)
              if (preRaf) cancelAnimationFrame(preRaf)
              cancelLiveWarm()
              if (idleFullTimer) clearTimeout(idleFullTimer)
              layer?.remove()
              if (gapped) {
                sheet?.classList.remove('inkwave-gapped')
                // Marker mode never touched these — clearing them there would wipe the inline
                // paddingTop React (Scroll.tsx) owns.
                if (sheet) { sheet.style.paddingTop = ''; sheet.style.minHeight = '' }
              }
            },
          }
        },
      }),
    ]
  },
})
