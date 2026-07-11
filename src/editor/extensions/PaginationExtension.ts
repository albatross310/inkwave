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
import { getPaperSize, getOrientation, getTopMarginPx, getSideMarginPx, getColumns, MARGIN_BOTTOM } from '../pageSettings'
import { pageBoxPx } from '../pageModel'
import { forceCanonicalContext } from '../canonicalMeasure'
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

function collectLines(view: EditorView, editorTop: number, scale: number, cache?: LineCache): { lines: MeasuredLine[]; blocks: MeasuredBlock[] } {
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
  const doc = view.state.doc
  doc.forEach((child, offset) => {
    const el = view.nodeDOM(offset) as HTMLElement | null
    if (!el || el.nodeType !== 1 || el.classList?.contains('inkwave-page-gap')) return
    const br = el.getBoundingClientRect()
    const blockTop = (br.top - editorTop - accumAbove(br.top)) / s
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
  return { lines, blocks }
}

function compute(view: EditorView, pageH: number, topM: number, scale: number, gapped: boolean, cache?: LineCache): { set: DecorationSet; sig: string } {
  if (pageH <= 0) return { set: DecorationSet.empty, sig: 'empty' }
  const editorTop = (view.dom as HTMLElement).getBoundingClientRect().top
  const doc = view.state.doc

  const { lines, blocks } = collectLines(view, editorTop, scale, cache)
  if (!lines.length) return { set: DecorationSet.empty, sig: 'empty' }
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

  // TEXT area per page = pageH minus the top margin (from settings) and the bottom margin constant.
  // Using the live topM ensures the break lands at pageH - MARGIN_BOTTOM from the sheet top —
  // the same Y as the dashed rule in non-gapped mode — regardless of the top-margin setting.
  const textArea = Math.max(1, pageH - topM - MARGIN_BOTTOM)
  // The reference list always starts on a fresh page: find its top-level position, then force a break
  // before it (unless it already begins a page). It's an atom the paginator can't split internally, so
  // this at least guarantees a clean start (Peter's call).
  let refListPos = -1
  doc.descendants((n, pos) => { if (refListPos < 0 && n.type.name === 'referenceList') refListPos = pos; return refListPos < 0 })
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
      const snap = orphan <= textArea * 0.22 && blockStart > 0 // few orphan lines → keep them together
      const at = snap ? blockStart : lines[i].pos      // else break mid-block so the page fills
      const brokeUsed = snap ? blockStartUsed : used   // used-on-page at the actual break point
      const botMargin = phoneLike() ? PHONE_PAGE_MARGIN_BOTTOM : Math.max(MARGIN_BOTTOM, pageH - topM - brokeUsed)
      // Don't re-break at the reference-list boundary (already forced above; the atom can't split).
      if (at > 0 && !(refBroken && at === refListPos)) {
        // ignoreSelection: the gap is a TALL block widget; without this, ProseMirror folds its height
        // into cursor/selection mapping so a click at the page-above end jumps the caret past the gap.
        decos.push(Decoration.widget(at, () => gapEl(botMargin, phoneLike() ? PHONE_PAGE_MARGIN : topM, gapped), { side: -1, ignoreSelection: true, stopEvent: () => true, key: `gap-${pageNo}-${at}` }))
        sig.push(`${at}:${Math.round(botMargin)}`)
        pageNo++
        used = snap ? orphan : 0  // snapped: the orphan lines move to the next page; mid-block: line i starts it
        curBlock = -1             // recompute the block-on-page baseline at the next line
      }
    }
    used += lh
  }
  sig.push(`pages:${pageNo}`)
  return { set: DecorationSet.create(doc, decos), sig: sig.join('|') }
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
            const sheetTop = sheet.getBoundingClientRect().top
            const bands = Array.from(sheet.querySelectorAll('.inkwave-page-gap-band')) as HTMLElement[]
            const tops: number[] = []
            const heights: number[] = []
            for (const band of bands) {
              const r = band.getBoundingClientRect()
              tops.push((r.top - sheetTop) / s)
              heights.push(r.height / s)
            }
            // Measure the CONTENT height with the panel layer hidden: the absolutely-positioned
            // panels extend sheet.scrollHeight themselves, so after a zoom-out the previous
            // (taller) panels held the old height and every repaint re-measured its own stale
            // extent — a self-sustaining fixpoint ("space below the page never retracts", gapped
            // only, cleared by refresh/toggle because those rebuild the layer). Hiding the layer
            // for one read costs one reflow per (debounced) paint pass. The full-final-page
            // min-height (applyBands) is neutralized for the same reason — it would ratchet.
            layer.style.display = 'none'
            const prevMin = sheet.style.minHeight
            sheet.style.minHeight = ''
            const total = sheet.scrollHeight
            sheet.style.minHeight = prevMin
            layer.style.display = ''
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
            paintRaf = 0
            if (!sheet || !layer) return
            const geo = readBands()
            if (!geo) return
            applyBands(geo)
            // A settle/idle paint IS a fresh measurement of the current step — cache it for free.
            stepCache.set(currentStep(), geo)
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
          const cacheStats = { hits: 0, misses: 0, precomputed: 0 } // debug/smoke counters
          ;(window as unknown as { __iwStepCache?: typeof cacheStats }).__iwStepCache = cacheStats
          const clearStepCache = () => stepCache.clear()
          const surfaceOf = () => (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
          const currentStep = () => zoomToStep(parseFloat(surfaceOf()?.style.getPropertyValue('--iw-editor-zoom') || '') || 1)
          const onZoomStep = (e: Event) => {
            const d = (e as CustomEvent).detail as { step?: number; surface?: Element } | undefined
            if (!gapped || !sheet || !layer || !d || typeof d.step !== 'number') return
            if (d.surface !== surfaceOf()) return // another surface's zoom (SnapshotView) — not ours
            const hit = stepCache.get(d.step)
            if (hit) { cacheStats.hits++; applyBands(hit) }
            else {
              // MISS → measure the bands LIVE, synchronously, in this same task. The zoom var is
              // already at the new step, so readBands() forces the new layout once and the panel
              // writes batch into it — visually identical to a hit, one reflow dearer. (The old
              // pin-until-settle fallback left stale bands under reflowed text: the between-page
              // gap "joined up" and text flashed out over the water.) Cache it so a re-pass hits.
              cacheStats.misses++
              const geo = readBands()
              if (geo) { applyBands(geo); stepCache.set(d.step, geo) }
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
          const onPreActivity = () => bumpQuiet(1500)
          const onPreChoreo = () => bumpQuiet(3000)
          const PRE_ACT_EVS = ['pointerdown', 'wheel', 'keydown', 'touchmove', 'scroll'] as const
          const PRE_CHOREO_EVS = ['inkwave:open-begin', 'inkwave:reveal-imminent', 'inkwave:editor-revealed'] as const
          PRE_ACT_EVS.forEach((ev) => window.addEventListener(ev, onPreActivity, { passive: true, capture: true }))
          PRE_CHOREO_EVS.forEach((ev) => window.addEventListener(ev, onPreChoreo))
          bumpQuiet(3000) // the mount itself is a choreography
          const preBusy = () =>
            (window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold === true
            || editDebounce !== undefined
            || bibDebounce !== undefined
            || performance.now() < quietUntil
            || document.visibilityState === 'hidden'
          const nextUncached = (): number | null => {
            const k0 = currentStep()
            for (let d = 0; d <= ZOOM_STEP_MAX - ZOOM_STEP_MIN; d++) {
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
            const surfaceEl = (view.dom as HTMLElement).closest('.inkwave-editor-surface') as HTMLElement | null
            const editorEl = view.dom as HTMLElement
            const restore = forceCanonicalContext(
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
            let measured = { set: DecorationSet.empty, sig: 'empty' }
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
              // Canonical context forces --iw-magnify to 1 on BOTH paths (fluid included) — the
              // transform is scale(var(--iw-magnify)), so inside this window the DOM is genuinely
              // unscaled and rects come back in layout px. scale=1 here is therefore CORRECT (do
              // NOT wire the live magnify.getMagnify() in: it describes the DOM outside this
              // window). collectLines keeps its scale param for any future out-of-window measure.
              // Fluid 'scroll' paper measures at the LIVE width — its canonical layout changes with
              // the window, so the block-line cache (fixed-context only) is not passed there.
              measured = compute(view, pageH, topM, 1, gapped, fluid ? undefined : lineCache)
            } finally {
              restore()
              if (scroller) { scroller.scrollTop = savedTop; scroller.scrollLeft = savedLeft }
              else window.scrollTo(savedLeft, savedTop)
            }
            const { set, sig } = measured
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
            // Re-measure & reposition the sheet panels after the decorations land (DOM settled).
            if (gapped) schedulePaint()
            announceMeasured()
            notePerf('page-measure', performance.now() - measureT0)
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
          const clearLineCache = () => { lineCache = new WeakMap() }
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
          const zoomCb = () => { if (!destroyed) { forceRecompute(); schedulePrecompute() } }
          window.addEventListener('inkwave:zoom-settled', zoomCb)
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
              window.removeEventListener('inkwave:zoom-step', onZoomStep)
              PRE_ACT_EVS.forEach((ev) => window.removeEventListener(ev, onPreActivity, { capture: true } as EventListenerOptions))
              PRE_CHOREO_EVS.forEach((ev) => window.removeEventListener(ev, onPreChoreo))
              if (preTimer) clearTimeout(preTimer)
              if (preRaf) cancelAnimationFrame(preRaf)
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
