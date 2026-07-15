// Page-break measurement for BOTH page modes. A ProseMirror plugin that measures the document's
// real line layout and places a widget at each page boundary (breaks land at line starts, so a
// line is never cut; small orphans snap to the block start):
//   gapped   → a full-bleed "page gap" widget — content reflows onto separate parchment sheets,
//              with the sheet panels + page numbers painted behind the text.
//   ungapped → an invisible zero-size break MARKER at the SAME measured positions — the Scroll
//              PageGuides draw the dashed rule + page number at it, and the print stylesheet
//              breaks the page there. One shared break model → toggling the gapped switch never
//              moves content across pages, and screen breaks = print/PDF breaks in both modes.
//
// Page height comes from pageModel (physical mm through the canonical 96dpi px), NOT from
// sheet.clientWidth — clientWidth's integer rounding flips with browser zoom / DPR, which made
// the pagination browser-zoom-dependent (see pageModel.ts).
//
// TRUE CANONICAL PAGINATION (2026-07): the geometry above fixed the page HEIGHT, but lines were
// still measured against the LIVE layout — editor font-zoom reflowed different words onto each
// page, and phones measured at their own narrow width. Now every measure runs inside a forced
// CANONICAL CONTEXT (canonicalMeasure.ts): mm paper width, desktop side margins, zoom 1, base
// font — so breaks are document positions identical at every zoom, on phone and desktop, and in
// print. The live layout only affects rendering.
//
// Measurement is loop-free: block positions are read as INTRINSIC (the gap-widget heights are
// subtracted back out), so adding gaps never changes the measured layout. A signature guard stops
// the recompute→dispatch→recompute cycle once nothing changes.

import { Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { getPaperSize, getOrientation, getTopMarginPx, getSideMarginPx, getColumns, getParaSpacingEm, MARGIN_BOTTOM } from '../pageSettings'
import { pageBoxPx } from '../pageModel'
import { forceCanonicalContext } from '../canonicalMeasure'
import { buildArithMeasure } from '../arithMeasure'
import { makeCanvasMeasure } from '../arithmeticLayout'
import { scaleFor } from '../magnify'
import { stepToZoom, zoomToStep, ZOOM_STEP_MIN, ZOOM_STEP_MAX } from '../zoomStep'
// gapEl + GAP/PHONE_PAGE_MARGIN/phoneLike live in pageGap.ts — shared with the snapshot view's
// static paginator (staticPagination.ts) so both build byte-identical gap DOM.
import { PHONE_PAGE_MARGIN, PHONE_PAGE_MARGIN_BOTTOM, phoneLike, gapEl } from '../pageGap'
import { bibProvider } from '../../citations/bibProvider'
import { notePerf } from '../perflog'

const KEY = new PluginKey<DecorationSet>('pagination')
export const MARGIN_TOP = 72 // px parchment margin at the top of every page (incl. page 1)
export { MARGIN_BOTTOM } // moved to pageSettings — see note there (shell-chunk weight)

// ── Decision 6: ARITHMETIC canonical measure (flag `inkwave:arithLayout`, default OFF) ──────────
// The third acquisition path — see arithMeasure.ts. Flag cached (a measure-time localStorage read
// is fine — measures are debounced — but cache it anyway; toggling needs a reload, as usual).
let _arithLayoutFlag: boolean | null = null
function arithLayoutOn(): boolean {
  if (_arithLayoutFlag !== null) return _arithLayoutFlag
  // DEFAULT OFF (2026-07-15): reverted from default-on. The arith greedy wrap DIVERGES from the DOM
  // canonical measure on REAL eligible prose — deterministic, ~1 break in 20 (arith fits ~2 more
  // words on a borderline line; measured on the real Honours prose fixture). Docs that are FULLY
  // eligible (plain prose, no citations/lists/rules) would get wrong breaks vs canonical/print.
  // Root-cause the wrap first (engine measureText-vs-browser edge, or wire-in param mismatch);
  // until it's byte-identical on real prose this stays opt-in via ?arithLayout.
  try { _arithLayoutFlag = typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:arithLayout') === '1' } catch { _arithLayoutFlag = false }
  return _arithLayoutFlag
}
// `inkwave:arithAssert` — debug: run the DOM collectLines + posAtCoords reference alongside the
// arith path in the SAME forced canonical context and assert the char-index → docPos convention.
function arithAssertOn(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:arithAssert') === '1' } catch { return false }
}
const arithMeasureFn = makeCanvasMeasure() // one cached canvas 2d measure, shared across measures
function arithFaceLoaded(stack: string, sizePx: number): boolean {
  try { const fam = stack.split(',')[0].replace(/['"]/g, '').trim(); return typeof document !== 'undefined' && document.fonts.check(`${sizePx}px "${fam}"`) } catch { return false }
}

// ── Decision 1: RENDER-FILL phone splits (flag `inkwave:renderFill`, default OFF) ────────────────
// Peter: "abandon perfect pagination for the better look." On the LIVE PHONE editor ONLY, compute
// mid-paragraph splits at the RENDER width (via the arithmetic engine) instead of canonical A4, so
// the last line before a split FILLS (kills the ~50%-empty last line). This DIVERGES from canonical
// — so it is gated to the live phone editor and NEVER touches print/export/verify/snapshot (those
// force the canonical measure via measure-now → forceFullOnce, which this path skips). Phone page
// numbers then differ from print — an accepted consequence.
let _renderFillFlag: boolean | null = null
function renderFillOn(): boolean {
  if (_renderFillFlag !== null) return _renderFillFlag
  // DEFAULT OFF (2026-07-15): reverted from default-on. The fill rides the SAME arith greedy wrap
  // that diverges from the browser's real wrap on eligible prose — a split 2 words off the render
  // would spill the "filled" last line, so the fill must wait on the wrap root-cause too. (It also
  // shares the whole-doc eligibility gate, so it never engaged on a citation-heavy doc anyway.)
  try { _renderFillFlag = typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:renderFill') === '1' } catch { _renderFillFlag = false }
  return _renderFillFlag
}

export interface PaginationOptions {
  enabled: boolean // measure page breaks at all (the live editor; off for headless/snapshot use)
  gapped: boolean  // true: tall gap widgets + sheet panels; false: zero-size break markers
}

// Collect every LINE as { intrinsic top, LAZY doc position } — so a page break can land
// mid-paragraph (a gap widget at a line-start splits the paragraph in two). "Intrinsic" = the layout
// AS IF no gap widgets existed: each line's top has the total height of all gap widgets ABOVE it (by
// screen Y) subtracted. Subtracting by Y — not by walking top-level children — is what makes this
// correct even when a gap renders NESTED inside a paragraph (a mid-paragraph break); otherwise that
// gap's height is missed and the measured page heights drift/oscillate. Intrinsic tops are invariant
// to the gaps, so the pagination is a stable fixpoint.
// `scale` = the current transform-magnify on the parchment (hybrid zoom). getBoundingClientRect returns
// VISUAL (scaled) coordinates, but pageH is derived from clientWidth which the transform DOESN'T scale —
// so divide all measured distances by `scale` to bring lines into the parchment's own (unscaled) coords.
// Height-only gap heights (set in unscaled px) also render scaled, so accumAbove is scaled too → the
// single division keeps everything consistent. scale=1 (no magnify / reflow zone) is a no-op.
//
// LAZY POSITIONS (2026-07-11, the typing-lag ablation): the old collector called view.posAtCoords
// for EVERY line — ~4,400 browser hit-tests on a 100-page doc, the bulk of the 2.4s (4× throttle)
// measure freeze. Only ~1 line per PAGE ever needs its position (the line a break lands on), so
// each line now carries the coords the old call used and resolves its pos on demand (identical
// posAtCoords formula ⇒ identical break positions). Block identity/boundaries — needed per line
// for orphan snapping — come from ONE view.posAtDOM per top-level block instead of per-line
// doc.resolve. Everything downstream (snap rule, refList forcing, sig strings) is unchanged.
//
// PER-BLOCK LINE CACHE (2026-07-11, the desktop "waves of lag" — merged with lazy positions):
// the per-line range.getClientRects walk over EVERY block was 1.5-4s of forced-layout reads on a
// 20k-word doc (4×-throttled probe) at every 150ms desktop typing pause. PM docs are persistent
// structures: an untouched block keeps its NODE IDENTITY across edits, and inside the forced
// canonical context (fixed width/margins/font/zoom) the same node renders the same line geometry
// — so each block's line geometry is cached RELATIVE to its own rect, keyed by the node object.
// An edit re-measures only the block(s) whose identity changed; every other block costs one
// getBoundingClientRect. Positions stay LAZY on both paths: a cache entry starts with relPos NaN
// and posOf writes each resolution back BLOCK-RELATIVE, so a break line pays its one hit-test at
// most once per node identity — future measures rebuild it by offset arithmetic alone. The caller
// owns the WeakMap and REPLACES it whenever the canonical context itself changes (fonts, page
// settings, bibliography label hydration) or the paper is fluid ('scroll' — its canonical width
// is the live width, so no cache is passed). Cache entries are only written/read on the gap-free
// measure (compute clears the widgets first), so gap subtraction can never bake into a cached top.
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
    // Atom blocks: the OLD per-line resolve gave every line inside an atom its own degenerate
    // block (posAtCoords at an atom returns its boundary → the {p, p+1} fallback), so the orphan
    // baseline reset per line. Replicate with one pseudo-block PER LINE — the snap/orphan
    // decisions (and hence the sig) stay byte-identical around tall atoms.
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
    try { const range = document.createRange(); range.selectNodeContents(el); rects = Array.from(range.getClientRects()) } catch { /* ignore */ }
    if (!rects.length) { // empty block (e.g. a blank paragraph) → one line at the block top
      push((br.top - editorTop - accumAbove(br.top)) / s, br.left + 1, br.top + Math.min(8, br.height / 2))
    } else {
      let lastTop = -1e9
      for (const r of rects) {
        // dedup inline rects on the same line; skip tall boxes (a nested gap widget, not a text line).
        // Height thresholds are in SCREEN px, so scale them by `s` to match the magnified rendering.
        if (r.width < 1 || r.height < 1 || r.height > 80 * s || r.top - lastTop <= 3) continue
        lastTop = r.top
        push((r.top - editorTop - accumAbove(r.top)) / s, r.left + 1, r.top + r.height / 2)
      }
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
function computeBreaks(
  lines: MeasuredLine[],
  blocks: MeasuredBlock[],
  refListPos: number,
  pageH: number,
  topM: number,
  gapped: boolean,
  posOf: (l: MeasuredLine) => number,
): { decos: Decoration[]; sig: string } {
  // Decision 1's dotted continuation bracket is INDEPENDENT of renderFill (2026-07-15): it marks a
  // MID-PARAGRAPH split — semantically true at canonical breaks too (Decision 5 splits every
  // straddler mid-block) — and carries zero measure risk, so it renders whatever the measure path.
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
  // Track the current top-level block so we know how much of it is already on this page: snapping the
  // break to a block boundary is nice for a couple of orphan lines, but pushing a TALL block whole
  // leaves the page half-empty (the short-page artifact). So snap only small orphans; otherwise break
  // mid-block to fill the page (stable because we measure the natural, gap-free wrapping).
  // Block identity comes from the collector (one posAtDOM per block); doc positions of individual
  // lines resolve LAZILY via posOf — only the line a break actually lands on pays the hit-test.
  // `curBlock = -1` after a break mirrors the old reset: orphan counting restarts per page.
  let curBlock = -1, blockStartUsed = 0
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
      pageNo++; used = 0; curBlock = -1; refBroken = true
    }
    // Break before the LINE that would overflow the text area.
    if (i > 0 && used + lh > textArea && posOf(lines[i]) > 0) {
      const orphan = used - blockStartUsed             // height of the current block already on this page
      // ALWAYS SPLIT mid-block so the page fills (Decision 5, Peter 2026-07-15: "probably split").
      // The widow/orphan snap is gone: a straddling paragraph is broken at the overflow line wherever
      // it falls, accepting the occasional lone 1-line orphan/widow (softened by the render-fill +
      // the dotted continuation bracket). `orphan` is still tracked for the sig/used accounting.
      // (History: flat ≤22% pushed every straddler whole → wasted page bottoms; fa11bf0 split only
      // when both sides kept ≥2 lines; Peter now wants the fuller look outright.)
      const snap = false
      const at = snap ? blockStart : lines[i].pos      // else break mid-block so the page fills
      const brokeUsed = snap ? blockStartUsed : used   // used-on-page at the actual break point
      const botMargin = phoneLike() ? PHONE_PAGE_MARGIN_BOTTOM : Math.max(MARGIN_BOTTOM, pageH - topM - brokeUsed)
      // MID-PARAGRAPH split? — the line before the break is in the SAME block, so this block spans
      // the boundary (a between-block break has the block starting AT line i). Decision 1's dotted
      // continuation bracket marks these (never a clean between-paragraph break).
      const midBlock = i > 0 && lines[i - 1].blockIdx === lines[i].blockIdx
      // Don't re-break at the reference-list boundary (already forced above; the atom can't split).
      if (at > 0 && !(refBroken && at === refListPos)) {
        // ignoreSelection: the gap is a TALL block widget; without this, ProseMirror folds its height
        // into cursor/selection mapping so a click at the page-above end jumps the caret past the gap.
        decos.push(Decoration.widget(at, () => gapEl(botMargin, phoneLike() ? PHONE_PAGE_MARGIN : topM, gapped, midBlock), { side: -1, ignoreSelection: true, stopEvent: () => true, key: `gap-${pageNo}-${at}${midBlock ? 'b' : ''}` }))
        sig.push(`${at}:${Math.round(botMargin)}`)
        pageNo++
        used = snap ? orphan : 0  // snapped: the orphan lines move to the next page; mid-block: line i starts it
        curBlock = -1             // recompute the block-on-page baseline at the next line
      }
    }
    used += lh
  }
  sig.push(`pages:${pageNo}`)
  return { decos, sig: sig.join('|') }
}

// ─── SCOPED CANONICAL MEASURE (2026-07-12, round-6 — Peter's redesign spec) ───────────────────
// Round-5's measurement-host clones could not replicate NodeView-rendered content exactly (a
// cloned <math-field> loses its shadow DOM; citation labels are React output; atom-interior DOM
// positions map wrongly), and one bad lazily-baked position poisons every later measure. Peter's
// verdict: EXACT behaviour near the writer is non-negotiable — approximate nothing locally, defer
// distance instead. So the scoped measure now runs in the REAL forced canonical context (the same
// context the full measure uses — real DOM, real NodeViews, real posAtCoords), but with the
// live-reflow window (.iw-zoom-live: content-visibility on off-screen blocks) so the forced
// layout renders ~only the region around the edit instead of the whole document:
//   • unchanged blocks reuse their cached block-relative lines at the previous measure's tops
//     (bit-identical above the edit; one telescoped delta below) — that data itself came from
//     earlier REAL canonical measures, never from clones;
//   • changed blocks are measured LIVE inside the window (scrolled into the canonical viewport so
//     content-visibility renders them fully);
//   • gap widgets inside/adjacent to the changed region are cleared by a REGION-SCOPED decoration
//     dispatch (natural wrapping, exactly like the full measure's whole-set clear);
//   • any break line whose doc position isn't baked yet resolves via the SAME view.posAtCoords
//     sample the full path uses (its block scrolled into the window first) — exact by identity.
// A full measure still runs LAZILY after every scoped one (idle-scheduled, input-gated): it
// re-verifies everything quietly (sig-guard = no visible change when the scoped result was right)
// and refreshes the incremental base. And it runs SYNCHRONOUSLY before print (the hard floor —
// see the beforeprint/measure-now wiring below). FALLBACK IS THE RULE: non-paragraph blocks in or
// beside the changed region, refLists there, pure end-appends, unrendered blocks, failed
// resolutions, >24 changed blocks — the full measure answers instead.
// The live layout IS the canonical layout whenever nothing canonical-relevant is overridden:
// desktop (no phone width/font rules), editor zoom 1, magnify 1 (mm paper width + desktop side
// margins are the live defaults — both read from the same settings the canonical force uses).
// Then forceCanonicalContext would be a byte-level no-op — skip it and save BOTH full-document
// reflows (the force's first read and the restore's live relayout).
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
  if (changedNew.length) {
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

  // ── measure the changed blocks LIVE in the canonical window ──
  const changedEntries: BlockLines[] = []
  const changedAdvances: number[] = []
  if (changedNew.length) {
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
          // INPUT PRIORITY (both platforms since 2026-07-11): a keystroke that adds/removes a LINE
          // resizes the sheet, so this observer fired one frame after the edit and — doc size
          // changed ⇒ fresh inputSig — ran the full multi-reflow measure IMMEDIATELY, bypassing
          // the edit debounce entirely (CLAUDE.md pagination rule (b); the desktop path had crept
          // back to immediate and every line-wrapping keystroke paid a full canonical measure the
          // very next frame — the ablation's biggest desktop longtask source). A resize arriving
          // while an edit's re-measure is pending folds into that debounce (pushes it back);
          // genuine resizes (rotate, keyboard, panel dock — no edit pending) still measure
          // straight away.
          const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
            // ZOOM-GESTURE HOLD (the page-boundary flicker fix): every font-zoom frame resizes the
            // sheet, so this observer re-ran per frame — recompute early-returns on the unchanged
            // inputSig but still schedulePaint()s, repositioning the gapped panels/bands 1–2 frames
            // BEHIND the reflowing text: the sheet edge visibly oscillated up/down at the zoom
            // target. Scroll.tsx raises __iwZoomHold for the whole gesture (cleared just before it
            // dispatches zoom-settled), so the panels stay pinned during the gesture and the settle
            // re-measure repaints them once, cleanly, against the settled layout.
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
            const sheetR = sheet.getBoundingClientRect()
            const bands = Array.from(sheet.querySelectorAll('.inkwave-page-gap-band')) as HTMLElement[]
            const tops: number[] = []
            const heights: number[] = []
            for (const band of bands) {
              const r = band.getBoundingClientRect()
              tops.push((r.top - sheetR.top) / s)
              heights.push(r.height / s)
            }
            // SINGLE-PASS content height (round-4, Peter: "zoom is slow now"): the old read hid
            // the panel layer + cleared minHeight to take sheet.scrollHeight — a SECOND forced
            // full layout on every paint pass, cache miss and atomic exit. Same rule
            // staticPagination already proved (2026-07-12 swipe round): derive the content extent
            // from the IN-FLOW children's rects in the SAME layout pass as the band reads.
            // Every ABSOLUTELY-positioned child must be skipped, not just the sheet layer: they are
            // inset:0 overlays (the panel layer AND `.iw-page-guides`) that STRETCH to the sheet's
            // minHeight, so reading their bottom folds our own full-final-page minHeight straight
            // back into `total` → a per-paint +padB RATCHET (last panel grows every zoom cycle;
            // bug 2026-07-15). Only the real in-flow content (the .ProseMirror wrapper) may set the
            // extent, so minHeight can never enter a rect read (the old ratchet fixpoints stay
            // impossible by construction).
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
            // paints as a whole sheet. Full height = the average of the previous ≤5 page regions
            // in this SAME geometry — derived from geo alone, so step-cache hits reproduce it
            // exactly, and it's correct under font zoom / phone reflow where the canonical pageH
            // wouldn't match the live layout. Single-page docs fall back to pageH (see recompute).
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

          // ── PREDICTIVE STEP CACHE (Peter, 2026-07-09: "the pages wait until the scrolling is
          // finished to change") ─────────────────────────────────────────────────────────────────
          // Zoom levels live on the shared zoomStep lattice, and the CANONICAL breaks don't move
          // with zoom — so per step only the band GEOMETRY differs, and ONE hypothetical-reflow
          // measure per step is the whole cost. While idle, the whole lattice is precomputed
          // nearest-first (one step per frame, aborting on any activity); when a gesture commits a
          // step (the 'inkwave:zoom-step' event Scroll dispatches synchronously with the zoom
          // var), the cached geometry is applied IMMEDIATELY as pure style writes that batch into
          // the same reflow as the font change — the pages track the zoom live. A cache MISS reads
          // the bands LIVE in the same task instead (one extra synchronous reflow that frame):
          // leaving the panels pinned at stale geometry while the text reflowed made the gap
          // visually collapse and let text paint out over the water (Peter, 2026-07-10) — bands
          // and text must land in the SAME frame, cached or not. The settle's verify paint still
          // snaps everything atomically at the end (a no-op when the cache was accurate).
          const stepCache = new Map<number, BandGeo>()
          // Per-GESTURE cache: band geometry read under the live-reflow window's placeholder
          // heights (.iw-zoom-live content-visibility) is a DIFFERENT geometry regime — it must
          // never leak into stepCache (placeholder-squashed panels replayed at rest) and
          // stepCache's full-layout geometry must never apply mid-gesture. Routing mid-gesture
          // steps here keeps a within-gesture step RETRACE pure style writes.
          const liveCache = new Map<number, BandGeo>()
          const cacheStats = { hits: 0, misses: 0, precomputed: 0 } // debug/smoke counters
          ;(window as unknown as { __iwStepCache?: typeof cacheStats }).__iwStepCache = cacheStats
          const clearStepCache = () => { stepCache.clear(); liveCache.clear() }
          const surfaceOf = () => (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
          const currentStep = () => zoomToStep(parseFloat(surfaceOf()?.style.getPropertyValue('--iw-editor-zoom') || '') || 1)
          // ── ATOMIC TEXT+BAND through reflow zoom (round-6, Peter: "Zooming should change text
          // and page atomically ... the gapped page arbitrarily joining up or the text flowing
          // over the water") ──────────────────────────────────────────────────────────────────
          // The round-5 FREEZE (bands held while text reflowed) regressed exactly this: a page's
          // rendered height changes NON-uniformly with zoom (font-reflow rewraps → discrete
          // lines-per-page jumps, which no smooth (z/z0)² factor can track), so a frozen band no
          // longer matched its page — the gap collapsed or text overran the sheet onto the water.
          // Peter's ruling: ATOMICITY BEATS FREEZE. So the bands are re-derived in the SAME task
          // as every reflow step — the original round-3/4 contract. Correctness guarantee: the
          // VISIBLE page bands are read from the live DOM, where content-visibility renders
          // on-screen blocks EXACTLY (only off-screen — invisible — pages sit at placeholder
          // heights), so what the eye sees is pixel-matched to the reflowed text every frame. A
          // cache hit is pure style writes (instant "paint from math"); a miss reads the bands
          // live in this same task, riding the layout Scroll.tsx's anchor read already forced.
          const onZoomStep = (e: Event) => {
            const d = (e as CustomEvent).detail as { step?: number; surface?: Element; z0?: number; resync?: boolean } | undefined
            if (!gapped || !sheet || !layer || !d || typeof d.step !== 'number') return
            if (d.surface !== surfaceOf()) return // another surface's zoom (SnapshotView) — not ours
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
            if (hit) { cacheStats.hits++; applyBands(hit) }
            else {
              // MISS → measure the bands LIVE, synchronously, in this same task. Scroll.tsx forces
              // the step's layout (its anchor read) before dispatching, so readBands' single-pass
              // rect reads ride it — visually identical to a hit, one layout flush dearer. Bands
              // and text land in the SAME frame — no join, no overflow.
              cacheStats.misses++
              const geo = readBands()
              if (geo) { applyBands(geo); cache.set(d.step, geo) }
            }
          }
          window.addEventListener('inkwave:zoom-step', onZoomStep)
          // Idle precompute: one step per frame, nearest-first from the current step until the
          // WHOLE lattice is warm (it's only ~18 steps — a fast gesture can cross any window, and
          // a miss now costs a synchronous mid-gesture reflow, so warm everything). Each measure
          // is the canonicalMeasure trick on the LIVE zoom var: force --iw-editor-zoom to the
          // step's lattice value, read the band rects + content height, restore — all inside one
          // task, so the hypothetical layout never paints. Strictly desktop + genuinely idle:
          // never during a gesture (__iwZoomHold), never in a typing pause (the edit debounce is
          // the typing signal), never on phone, never while hidden.
          let preTimer: ReturnType<typeof setTimeout> | undefined
          let preRaf = 0
          // GENUINELY idle only (2026-07-11, "Chrome still a bit slow opening a document"): each
          // precompute step is a full-document hypothetical reflow (~100ms+ of layout on a long
          // doc), and the warm-up used to start 350ms after the mount's first measure — ~18
          // consecutive long frames landing exactly while the reveal chain, the wave coast and
          // the writer's first scrolls run (profiled: the post-open longtask churn). Any input
          // or load-choreography activity now pushes the warm-up back; a zoom during the cold
          // window stays CORRECT — onZoomStep measures a miss live in the same task.
          let quietUntil = 0
          const bumpQuiet = (ms: number) => {
            quietUntil = Math.max(quietUntil, performance.now() + ms)
          }
          const onPreActivity = () => {
            bumpQuiet(1500)
            // CANCEL the zoom-scoped warm on any input (round-4, Peter: "scrolling is jittery"):
            // each warm step is a full-document hypothetical reflow — running them under a
            // scroll/keystroke is exactly the jank Peter felt. The 150ms grace exempts the
            // settle's OWN scroll events (the atomic exit's correction fires 'scroll' right
            // after zoomCb opens the window); anything later is a real user input.
            if (performance.now() > zoomWarmStart + 150) zoomWarmUntil = 0
          }
          const onPreChoreo = () => bumpQuiet(3000)
          const PRE_ACT_EVS = ['pointerdown', 'wheel', 'keydown', 'touchmove', 'scroll'] as const
          const PRE_CHOREO_EVS = ['inkwave:open-begin', 'inkwave:reveal-imminent', 'inkwave:editor-revealed'] as const
          PRE_ACT_EVS.forEach((ev) => window.addEventListener(ev, onPreActivity, { passive: true, capture: true }))
          PRE_CHOREO_EVS.forEach((ev) => window.addEventListener(ev, onPreChoreo))
          bumpQuiet(3000) // the mount itself is a choreography
          // ZOOM-SCOPED WARM WINDOW (round-3, Peter: "build/refresh the step cache only on
          // zoom-zone entry / first step / idle after settle — never on the typing path"): the
          // genuine-idle gate's activity events include 'wheel'/'scroll', so a zoom session kept
          // pushing its own warm-up out 1.5s forever — the cache was measured COLD through whole
          // gestures (0 precomputed). A zoom SETTLE opens this window: inside it the quietUntil
          // input gate is bypassed (typing/edit debounce + the gesture hold still block) and the
          // warm is RADIUS-LIMITED to the steps around the current one — the next notches' exit/
          // settle frames hit, without the full-lattice reflow burst on every settle. The full
          // lattice still warms at genuine idle, exactly as before.
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
              // Enforce minimum one-page scroll height so the footer (logo+number, position:
              // absolute; bottom:22px) always lands at the page bottom, never mid-content
              // on short documents. scrollHeight reflects this minHeight, so segs get the
              // full page height and the panel div fills it naturally — no per-panel hack needed.
              // Baseline respects applyBands' full-final-page extension (lastMinH): writing bare
              // pageH here shrank the sheet the paint pass had just grown, and the RO ping-ponged
              // between the two writes forever. Stale-larger for one pass after an edit is fine —
              // the paint recomputes the true extension from the fresh geometry.
              if (pageH > 0) sheet.style.minHeight = `${Math.max(pageH, lastMinH)}px`
            }
            // Only re-measure when something that affects the CANONICAL layout changed (text edit →
            // doc size; paper/orientation → pageH; top margin). Our own setMeta dispatches below
            // don't change these, so they can't loop. Window/sheet resizes no longer re-measure at
            // all (canonical breaks don't depend on the rendered width) — the RO-scheduled pass
            // lands here and early-returns, just repositioning the gapped panels.
            // NB: editor font-zoom is deliberately NOT in this signature (canonical breaks don't
            // depend on it either). Re-measuring DURING the zoom gesture lurched the text; instead
            // Scroll.tsx fires 'inkwave:zoom-settled' → one clean re-measure (zoomCb below), which
            // now confirms the same breaks and re-paints the panels against the reflowed text.
            const inputSig = `${view.state.doc.content.size}:${Math.round(pageH)}:${topM}`
            if (inputSig === lastInputSig) { if (gapped) schedulePaint(); return }
            lastInputSig = inputSig
            const measureT0 = performance.now() // perflog: the full canonical-measure cost (phone lag hunt)

            // ── SCOPED FIRST (round-6, Peter's spec): the REAL forced canonical context with the
            // live-reflow window (.iw-zoom-live content-visibility) — exact local measurement,
            // ~one-screenful layout cost, cached geometry + one delta for the distance. A bail
            // (null) falls through to the full measure below (which refreshes the base); a FULL
            // measure is also idle-scheduled after every scoped one and forced before print.
            // 'inkwave:pagCheck=1' runs BOTH and compares signatures.
            // Decision 1: render-fill on phone always takes the FULL path (the render-width arith
            // measure below) so breaks never flip between the canonical scoped measure and the
            // render-width full one — the scoped path is a canonical regime, incompatible here.
            if (!fluid && incState && !forceFullOnce && !(renderFillOn() && phoneLike())) {
              const surfaceEl0 = (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
              const editorEl0 = view.dom as HTMLElement
              const scroller0 = surfaceEl0 && surfaceEl0.classList.contains('iw-fill') && !surfaceEl0.classList.contains('is-phone')
                ? surfaceEl0 : null
              const savedTop0 = scroller0 ? scroller0.scrollTop : window.scrollY
              const savedLeft0 = scroller0 ? scroller0.scrollLeft : window.scrollX
              // NO content-visibility window here (round-6 storms: cv-rendered blocks measure
              // subtly differently — ~9px advance drift even on plain paragraphs, worse around
              // citation nodeviews). EXACTNESS RULES: the scoped measure runs in the plain forced
              // canonical context. The reflow cost is skipped entirely whenever the live context
              // already IS canonical (canonicalIsLive below — desktop at default zoom/magnify),
              // which is the common desktop case; elsewhere (phone) the reflows are the price of
              // correctness and the savings come from region-scoped reads + baked positions.
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
                  incState = inc.meta
                  if (inc.sig !== lastLayoutSig) {
                    lastLayoutSig = inc.sig
                    lastSet = inc.set
                  }
                  view.dispatch(view.state.tr.setMeta(KEY, lastSet).setMeta('addToHistory', false))
                  if (gapped) schedulePaint()
                  announceMeasured()
                  notePerf('page-measure-scoped', performance.now() - measureT0)
                  // The lazy exact refresh. Round-7 (Peter: "paras should split over pages even if
                  // they render 0.2s late; the cursor line moves instantly"): where the full
                  // measure is CHEAP (desktop at defaults — canonicalIsLive skips both reflows),
                  // re-verify FAST so any deferred mid-paragraph split lands ~0.5s after the
                  // pause, not 2.5s. Phone keeps the long fuse (its full measure costs real time).
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

            // CANONICAL MEASUREMENT CONTEXT — the breaks must be the SAME document positions at
            // every editor zoom and on every device (phone = desktop = print). So the measure runs
            // in ONE forced canonical layout: true mm paper width (overrides the phone's fluid
            // width), desktop print side margins (phone renders a slim 1.25rem), --iw-editor-zoom 1
            // (defeats Ctrl+wheel AND phone pinch) and the 1.125rem base font inline (defeats the
            // phone ×1.25 boost — see .ProseMirror in index.css). Live zoom / device width then
            // affect RENDERING only: the widgets ride their document positions through any reflow,
            // so pinch-zoom grows/shrinks pages without moving words across them. Set → measure →
            // restore is all synchronous inside this one rAF, extending the existing no-paint
            // window (getClientRects forces layout, not paint); cost: 2 extra full-document
            // reflows per measure, which is fine because measures are debounced (150ms after
            // edits / zoom-settle / settings) — never per-keystroke.
            //
            // Fluid 'scroll' paper keeps its RENDERED width (its pages are a ratio of that width
            // by design — no mm identity), but the FONT context must still be canonical: skipping
            // the force entirely here measured the live zoomed font, so on scroll paper the words
            // per page changed with the editor zoom at measure time — the "different amount of
            // text per page depending on how zoomed in you are" regression (2026-07-09). Passing
            // no paper/sheet keeps width + margins live; zoom/magnify/font are still pinned.
            // ── Decision 6: ARITHMETIC canonical acquisition (flag inkwave:arithLayout) ──
            // When the whole doc is arithmetic-eligible text, compute lines+blocks reflow-free and
            // SKIP forceCanonicalContext (+ both its full-document reflows) — the phone per-pause
            // reflow win. Gated to !canonicalIsLive (phone / zoomed): desktop-at-defaults already
            // skips the reflow, so there's nothing to win and the DOM path stays authoritative.
            // ANY ineligible block (heading/citation/inline-math/list/rule/refList) ⇒ buildArithMeasure
            // returns null ⇒ the DOM path below runs. The lazy full DOM re-verify + pagCheck are the
            // safety net; meta stays null (the next scoped measure bails to full, which is this cheap
            // arith path again).
            let measured: { set: DecorationSet; sig: string; meta: IncMeta | null } = { set: DecorationSet.empty, sig: 'empty', meta: null }
            let arithMeasured = false
            // ── Decision 1: RENDER-FILL phone splits (flag inkwave:renderFill) ──
            // Live phone editor only, never print/export (forceFullOnce). Measure at the LIVE RENDER
            // width (not canonical A4) so mid-paragraph splits fill the last line. Zoom-independent
            // (read at the live content width, font base 18 — like canonical, only the WIDTH differs).
            // Any ineligible block ⇒ null ⇒ falls through to the canonical paths below.
            if (renderFillOn() && phoneLike() && !fluid && !wasForceFull) {
              const edEl = view.dom as HTMLElement
              const cs = getComputedStyle(edEl)
              const renderW = edEl.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
              // Measure at the LIVE RENDER font — phone applies its ×1.25 root scale + its own
              // line-height, so the base is NOT the canonical 18px (that's the whole point: render,
              // not canonical). ratio = used line-height / font-size; base = the live font-size.
              const basePx = parseFloat(cs.fontSize) || 18
              const lhPx = parseFloat(cs.lineHeight)
              const ratio = lhPx && basePx ? lhPx / basePx : 1.618
              const am = renderW > 40
                ? buildArithMeasure(view.state.doc, renderW, ratio, getParaSpacingEm(), arithMeasureFn, arithFaceLoaded, false, basePx)
                : null
              if (am) {
                const { decos, sig } = computeBreaks(am.lines as unknown as MeasuredLine[], am.blocks, findRefListPos(view.state.doc), pageH, topM, gapped, (l) => (l as unknown as { pos: number }).pos)
                measured = { set: DecorationSet.create(view.state.doc, decos), sig, meta: null }
                arithMeasured = true
                notePerf('page-measure-renderfill', performance.now() - measureT0)
              }
            }
            if (!arithMeasured && arithLayoutOn() && !fluid && !canonicalIsLive((view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null)) {
              // LAYOUTUNIT SNAP (2026-07-15 — the real-prose divergence): the browser stores used
              // lengths on a 1/64px grid, so a fractional CSS width is FLOORED before any text is
              // wrapped in it. forceCanonicalContext writes pageWidthPx−2·side (e.g. 601.7008) and
              // the box that actually wraps is 601.6875 (= 38508/64). Feeding the engine the
              // unsnapped value makes every line 0.0133px too generous — one borderline word flips,
              // and the rest of that block re-wraps behind it (probed: Δ cascading 5→32 chars from
              // the first flip). Snap it exactly as the engine already snaps line heights.
              const contentW = Math.floor((pageWidthPx - 2 * getSideMarginPx()) * 64) / 64
              const lhRaw = getComputedStyle(view.dom as HTMLElement).getPropertyValue('--inkwave-lh').trim()
              const ratio = lhRaw ? parseFloat(lhRaw) : (phoneLike() ? 1.55 : 1.618)
              const am = buildArithMeasure(view.state.doc, contentW, ratio, getParaSpacingEm(), arithMeasureFn, arithFaceLoaded, false)
              if (am) {
                // ── SEAM ASSERTION (debug flag `inkwave:arithAssert`) ──
                // The convention this wire-in must satisfy: the engine's line-start CHAR INDEX maps
                // to docPos = paraOffset + 1 + charIndex, and that MUST equal what
                // posAtCoords(lineRect.left + 1, mid) returns for that line — the live rule
                // collectLines uses (and the arith prover's verified reference). Run both here, in
                // the SAME forced canonical context, and compare line-for-line.
                if (arithAssertOn()) {
                  const surfaceA = (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
                  const restoreA = forceCanonicalContext(
                    { paper: sheet?.parentElement ?? null, sheet, surface: surfaceA, editor: view.dom as HTMLElement },
                    { pageWidthPx, sideMarginPx: getSideMarginPx() },
                  )
                  const out: string[] = []
                  try {
                    const curA = KEY.getState(view.state)
                    if (curA && curA !== DecorationSet.empty) view.dispatch(view.state.tr.setMeta(KEY, DecorationSet.empty).setMeta('addToHistory', false))
                    const edTopA = (view.dom as HTMLElement).getBoundingClientRect().top
                    const dom = collectLines(view, edTopA, 1, undefined)
                    if (dom.lines.length !== am.lines.length) out.push(`LINE-COUNT dom=${dom.lines.length} arith=${am.lines.length}`)
                    const n = Math.min(dom.lines.length, am.lines.length)
                    let firstBadBlk = -1
                    for (let k = 0; k < n && out.length < 8; k++) {
                      const dPos = view.posAtCoords({ left: dom.lines[k].cx, top: dom.lines[k].cy })?.pos ?? 0
                      const aPos = am.lines[k].pos
                      if (dPos !== aPos) {
                        if (firstBadBlk < 0) firstBadBlk = dom.lines[k].blockIdx
                        out.push(`line${k} blk(dom=${dom.lines[k].blockIdx},ar=${am.lines[k].blockIdx}) posAtCoords=${dPos} arith=${aPos} Δ=${aPos - dPos} domTop=${Math.round(dom.lines[k].top)} arTop=${Math.round(am.lines[k].top)}`)
                      }
                    }
                    // What does the BROWSER actually compute for the diverging block's text, vs what
                    // our extractor computed arithmetically from the em mark? And is our content
                    // width the same box the DOM wraps in?
                    if (firstBadBlk >= 0) {
                      const bs = am.blocks[firstBadBlk]?.start
                      const el = bs != null ? (view.nodeDOM(bs) as HTMLElement | null) : null
                      const span = el?.querySelector('span') ?? el
                      if (span && span.nodeType === 1) {
                        const scs = getComputedStyle(span as HTMLElement)
                        const pcs = getComputedStyle(view.dom as HTMLElement)
                        // TRUE fractional content box (clientWidth is integer-rounded — useless here),
                        // plus the widest rendered line: the real wrap width the browser used.
                        const edRect = (view.dom as HTMLElement).getBoundingClientRect()
                        const trueContentW = edRect.width - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0)
                        let widest = 0
                        const rng = document.createRange(); rng.selectNodeContents(el as HTMLElement)
                        for (const rc of Array.from(rng.getClientRects())) if (rc.width > 1 && rc.height > 1 && rc.height < 80) widest = Math.max(widest, rc.width)
                        out.push(`BLK${firstBadBlk} font="${scs.fontSize}" fam=${scs.fontFamily.slice(0, 18)} | editorFont="${pcs.fontSize}" pad=${pcs.paddingLeft}/${pcs.paddingRight}`)
                        out.push(`  WIDTH: arith contentW=${contentW.toFixed(4)} | DOM true contentW=${trueContentW.toFixed(4)} | edRect.width=${edRect.width.toFixed(4)} | widest rendered line=${widest.toFixed(4)}`)
                        // Per-block line comparison: same COUNT? same line starts (doc positions)?
                        const dLines = dom.lines.filter((l) => l.blockIdx === firstBadBlk)
                        const aLines = am.lines.filter((l) => l.blockIdx === firstBadBlk)
                        const dStarts = dLines.map((l) => view.posAtCoords({ left: l.cx, top: l.cy })?.pos ?? -1)
                        const aStarts = aLines.map((l) => l.pos)
                        const bStart = am.blocks[firstBadBlk]?.start ?? 0
                        out.push(`  BLK${firstBadBlk} lines dom=${dLines.length} arith=${aLines.length} | blockStart=${bStart}`)
                        out.push(`   dom starts  : ${dStarts.map((v) => v - bStart - 1).join(',')}`)
                        out.push(`   arith starts: ${aStarts.map((v) => v - bStart - 1).join(',')}`)
                        out.push(`   text: ${JSON.stringify(((el as HTMLElement).textContent || '').slice(70, 130))}`)
                        // Canvas measureText knows ONLY the font shorthand. Anything else the real
                        // editor CSS applies to text advance is invisible to it → arith mis-measures.
                        const tgt = (span && span.nodeType === 1 ? span : el) as HTMLElement
                        const t = getComputedStyle(tgt)
                        out.push(`   TEXT-CSS: letterSpacing=${t.letterSpacing} wordSpacing=${t.wordSpacing} fontKerning=${t.fontKerning} fontFeature=${t.fontFeatureSettings} fontVariant=${t.fontVariantLigatures}/${t.fontVariant} textRendering=${(t as unknown as { textRendering?: string }).textRendering} fontStretch=${t.fontStretch} fontOpticalSizing=${(t as unknown as { fontOpticalSizing?: string }).fontOpticalSizing} weight=${t.fontWeight} style=${t.fontStyle}`)
                        // Ground truth: what does the canvas say vs the DOM for ONE identical string?
                        const probeStr = ((el as HTMLElement).textContent || '').slice(0, 60)
                        const cv = document.createElement('canvas').getContext('2d')
                        if (cv) {
                          cv.font = `${t.fontStyle === 'italic' ? 'italic ' : ''}${t.fontWeight} ${parseFloat(t.fontSize)}px ${t.fontFamily}`
                          const canvasW = cv.measureText(probeStr).width
                          const meas = document.createElement('span')
                          meas.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:pre'
                          meas.style.font = cv.font
                          meas.textContent = probeStr
                          ;(el as HTMLElement).appendChild(meas)
                          const domW = meas.getBoundingClientRect().width
                          meas.remove()
                          out.push(`   ADVANCE(60 chars): canvas=${canvasW.toFixed(3)} domSpan=${domW.toFixed(3)} Δ=${(domW - canvasW).toFixed(3)} font="${cv.font}"`)
                          // LIGATURE probe: the editor sets font-feature-settings:"liga" 0, canvas
                          // defaults to ligatures ON. Compare a ligature-bearing string, and the
                          // ACTUAL diverging line's text (block chars 77..163).
                          const full = (el as HTMLElement).textContent || ''
                          // GROUND TRUTH: the browser's ACTUAL rendered line boxes for this block —
                          // width of each, and the char offset each line's first VISIBLE glyph is
                          // at (found by walking the text and taking the first char whose own rect
                          // sits on that line). This is independent of posAtCoords.
                          {
                            const rects = Array.from((() => { const r = document.createRange(); r.selectNodeContents(el as HTMLElement); return r.getClientRects() })())
                              .filter((rc) => rc.width > 1 && rc.height > 1 && rc.height < 80)
                            out.push(`   RENDERED line rects: ${rects.map((rc) => rc.width.toFixed(0)).join(',')}`)
                            // first visible char offset per line, via per-char rects
                            const tn: Text[] = []
                            const walk = (n: Node) => { if (n.nodeType === 3) tn.push(n as Text); else n.childNodes.forEach(walk) }
                            walk(el as HTMLElement)
                            const tops: number[] = []; const firstAt: number[] = []
                            let idx = 0
                            for (const t of tn) {
                              for (let i = 0; i < t.length; i++, idx++) {
                                const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1)
                                const rc = r.getBoundingClientRect()
                                if (rc.width < 0.01) continue // collapsed trailing space — not a line start
                                const top = Math.round(rc.top)
                                if (!tops.includes(top)) { tops.push(top); firstAt.push(idx) }
                              }
                            }
                            out.push(`   TRUE line starts (first VISIBLE glyph): ${firstAt.join(',')}`)
                            // What is the real DOM made of? Decorations/NodeViews the PM doc model
                            // (and therefore the arith extractor) cannot see would widen the text.
                            out.push(`   HTML: ${JSON.stringify(((el as HTMLElement).innerHTML || '').slice(0, 120))}`)
                            // THE BOX THAT ACTUALLY WRAPS: the paragraph's own content box, not the
                            // editor's. Any padding/margin/border on the block (or a narrower
                            // container) makes the engine's contentWidthPx too generous.
                            {
                              const b = el as HTMLElement
                              const bs = getComputedStyle(b)
                              const br = b.getBoundingClientRect()
                              const inner = br.width - (parseFloat(bs.paddingLeft) || 0) - (parseFloat(bs.paddingRight) || 0)
                                - (parseFloat(bs.borderLeftWidth) || 0) - (parseFloat(bs.borderRightWidth) || 0)
                              out.push(`   BLOCK BOX: rect.width=${br.width.toFixed(4)} computedWidth=${bs.width} pad=${bs.paddingLeft}/${bs.paddingRight} margin=${bs.marginLeft}/${bs.marginRight} border=${bs.borderLeftWidth}/${bs.borderRightWidth} textIndent=${bs.textIndent} => content=${inner.toFixed(4)} | arith used ${contentW.toFixed(4)}`)
                              out.push(`   BLOCK CSS: textAlign=${bs.textAlign} textWrap=${(bs as unknown as { textWrap?: string }).textWrap} whiteSpace=${bs.whiteSpace} hyphens=${(bs as unknown as { hyphens?: string }).hyphens} wordBreak=${bs.wordBreak} overflowWrap=${(bs as unknown as { overflowWrap?: string }).overflowWrap} display=${bs.display} boxSizing=${bs.boxSizing}`)
                              // ⚠️ flagged: a FOCUSED word-cycle turns .scas-red into inline-block+min-width
                              // → genuinely wider words → narrower effective wrap. Scan for ANY
                              // descendant that is not flow-neutral.
                              const bad: string[] = []
                              b.querySelectorAll('*').forEach((d) => {
                                const ds = getComputedStyle(d as HTMLElement)
                                if (ds.display !== 'inline' || (ds.minWidth && ds.minWidth !== '0px' && ds.minWidth !== 'auto') || ds.letterSpacing !== 'normal' || (ds.position !== 'static'))
                                  bad.push(`<${d.tagName.toLowerCase()} class="${(d.className || '').toString().slice(0, 30)}" display=${ds.display} minW=${ds.minWidth} ls=${ds.letterSpacing} pos=${ds.position}>`)
                              })
                              out.push(`   NON-FLOW-NEUTRAL descendants: ${bad.length ? bad.slice(0, 4).join(' | ') : 'NONE'}`)
                              out.push(`   FULL HTML: ${JSON.stringify((b.innerHTML || '').slice(0, 700))}`)
                            }
                            // Measure the REAL rendered advance of the block's chars 77..163 by
                            // range rects (in situ, with every decoration/mark applied) vs the
                            // plain-string measure the engine uses.
                            let a = 0, bnode: Text | null = null, boff = 0, enode: Text | null = null, eoff = 0
                            for (const t of tn) { if (!bnode && a + t.length > 77) { bnode = t; boff = 77 - a } if (!enode && a + t.length >= 163) { enode = t; eoff = 163 - a } a += t.length }
                            if (bnode && enode) {
                              const rr = document.createRange(); rr.setStart(bnode, boff); rr.setEnd(enode, eoff)
                              const rcs = Array.from(rr.getClientRects()).filter((x) => x.width > 0.5)
                              out.push(`   IN-SITU 77..163 rect widths: ${rcs.map((x) => x.width.toFixed(1)).join(' + ')} = ${rcs.reduce((s, x) => s + x.width, 0).toFixed(2)} (plain-string measure said 602.000)`)
                            }
                          }
                          const probes: Array<[string, string]> = [
                            ['dom-line1  77..158', full.slice(77, 158)],
                            ['dom-line1 bare', full.slice(77, 158).replace(/\s+$/, '')],
                            ['ar-line1  77..163', full.slice(77, 163)],
                            ['ar-line1 BARE', full.slice(77, 163).replace(/\s+$/, '')],
                            ['tail 155..168', full.slice(155, 168)],
                          ]
                          for (const [label, s] of probes) {
                            const cw = cv.measureText(s).width
                            const m2 = document.createElement('span')
                            m2.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:pre'
                            m2.style.font = cv.font
                            m2.textContent = s
                            ;(el as HTMLElement).appendChild(m2)
                            const dw = m2.getBoundingClientRect().width
                            m2.remove()
                            out.push(`   ${label}: canvas=${cw.toFixed(3)} dom=${dw.toFixed(3)} Δ=${(dw - cw).toFixed(3)} ${JSON.stringify(s.slice(0, 34))}`)
                          }
                        }
                      }
                    }
                  } finally { restoreA() }
                  ;(window as unknown as { __iwArithAssert?: unknown }).__iwArithAssert =
                    { domLines: 0, arithLines: am.lines.length, mismatches: out }
                  if (out.length) console.error('[inkwave:arithAssert] MAPPING MISMATCH\n  ' + out.join('\n  '))
                  else console.info('[inkwave:arithAssert] mapping OK — every arith line pos === posAtCoords')
                }
                const { decos, sig } = computeBreaks(am.lines as unknown as MeasuredLine[], am.blocks, findRefListPos(view.state.doc), pageH, topM, gapped, (l) => (l as unknown as { pos: number }).pos)
                measured = { set: DecorationSet.create(view.state.doc, decos), sig, meta: null }
                arithMeasured = true
                notePerf('page-measure-arith', performance.now() - measureT0)
              }
            }
            let tClear = 0, tCompute = 0, tRestore = 0, tDispatch = 0 // perflog phase attribution (DOM path)
            let tPhase = performance.now()
            if (!arithMeasured) {
            const surfaceEl = (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
            const editorEl = view.dom as HTMLElement
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
          // INPUT PRIORITY: edit-driven re-measures are debounced OFF the keystroke. recompute forces
          // a full-document layout read (clientWidth + getClientRects per block) and dispatches two
          // meta transactions — per keystroke that was the single biggest stutter source (and worst on
          // backspace, where line heights shrink). The existing gap decorations are position-mapped
          // through each edit in apply(), so the gaps ride along correctly while we wait; the breaks
          // re-settle 150ms after typing pauses. Resize/fonts/settings still re-measure immediately.
          //
          // PHONE (2026-07-09, "character input is priority #1 — reflow can wait"): each measure is
          // THREE forced full-document reflows (gap-clear → canonical-context force → measure →
          // restore) — cheap on desktop, ~100-300ms of layout on a phone CPU with a long doc. At
          // 150ms it landed in ordinary inter-word typing pauses, freezing the next keystroke. So
          // edit-driven re-measures on phone wait for a GENUINE pause: 850ms after the last
          // transaction, stretched to 1200ms while the on-screen keyboard is up (TiptapEditor mirrors
          // it to window.__iwKeyboardUp — reflowing mid-composition is worthless). Trailing debounce:
          // every further keystroke pushes a queued measure back. Desktop stays 150ms, and the FIRST
          // measure (the pagination-ready reveal latch) is schedule()d directly below — untouched.
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
          const clearLineCache = () => { lineCache = new WeakMap(); incState = null }
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
          // Re-measure ONCE when the editor font-zoom settles (see Scroll.tsx). Breaks are now
          // measured in the canonical context, so this recomputes IDENTICAL document positions
          // (the stable-set guard makes the dispatch a no-op) — but it still drives the paint()
          // pass that repositions the sheet panels/bands against the REFLOWED live text, which IS
          // zoom-dependent. Scroll.tsx re-anchors the viewport around it (pagination-measured).
          //
          // BOTH PLATFORMS defer everything heavy off the settle (round-4, Peter: "text reflow
          // should be no slower than before; pages painted instantly from the math"):
          // canonical breaks cannot move with zoom by construction, and the ATOMIC EXIT already
          // applied full-regime band geometry in the exit task — so the settle needs NO immediate
          // measure and NO immediate paint. The full verify re-measure runs at genuine idle
          // (scheduleIdleFull — input-gated, cancelled by any activity), and the zoom-scoped
          // step-cache warm runs in the same quiet gaps (cancelled on input via onPreActivity;
          // desktop only — precompute never runs on phone).
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
            // Phone: only a DOC change pushes the queued measure back. This update hook also fires
            // for decoration repaints (the SCAS tick) and every React re-render of the editor
            // component (word count, panels — Tiptap's updateState), and each of those reset the
            // debounce: measured on-device, the word-count re-render alone stacked the phone measure
            // to ~1.9s after the last keystroke. Doc object identity is the cheap test (ProseMirror
            // docs are persistent structures — unchanged doc ⇒ same reference); a skipped reschedule
            // loses nothing, since a no-edit recompute early-returns on inputSig anyway. Desktop
            // keeps the original unconditional reset.
            update: (view, prevState) => {
              // STEP-CACHE INVALIDATION rides DOC IDENTITY, not transactions (Peter, 2026-07-10:
              // "we might as well cache the steps we've gone through so going back is instant").
              // This hook fires for EVERY transaction — including our own settle-time setMeta
              // dispatches, SCAS decoration repaints, and each React re-render's updateState —
              // and clearing per transaction wiped the whole warmed lattice at every settle, so a
              // zoom-in → zoom-out retrace missed on every step it had just visited. Only a real
              // doc change makes per-step band geometry stale.
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
              PRE_ACT_EVS.forEach((ev) => window.removeEventListener(ev, onPreActivity, { capture: true } as EventListenerOptions))
              PRE_CHOREO_EVS.forEach((ev) => window.removeEventListener(ev, onPreChoreo))
              if (preTimer) clearTimeout(preTimer)
              if (preRaf) cancelAnimationFrame(preRaf)
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
