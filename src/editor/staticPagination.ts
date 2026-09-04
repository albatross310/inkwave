// CANONICAL GAPPED PAGES FOR STATIC CONTENT — the snapshot view's document pane. It re-implements
// the editor's PaginationExtension pipeline against plain DOM (FullDiffView / DocView have no
// ProseMirror): measure in the SAME forced canonical context, compute breaks with the SAME page box
// (pageModel) and the SAME overflow rules, insert the SAME gap elements (pageGap.ts). Ungapped mode
// inserts zero-height MARKERS at the same positions; the CSS classes are the editor's throughout.
//
// ⚠ IT MIRRORS THE EDITOR, so it must never carry a rule the editor retired — and a claim of
// sameness outlives the sameness (R2). MEASURED, not asserted: halvesbisect.prove.mjs reads the
// model, the LIVE editor's gap widgets and this pane from ONE document and requires all three agree.
// ⚠ Breaks are recorded as text-node CHARACTER OFFSETS — the static analog of a PM document
// position — so they ride any live reflow exactly as the editor's widgets ride theirs.
// → docs/archive/pagination-rounds.md#static-pane

import { probePerf } from './perflog'
import { getPaperSize, getOrientation, getTopMarginPx, getSideMarginPx, getColumns, MARGIN_BOTTOM } from './pageSettings'
import { pageBoxPx } from './pageModel'
import { isLineRect, sameLine } from './lineRects'
import { forceCanonicalContext } from './canonicalMeasure'
import { gappedPagesEnabled } from './pageView'
import { PHONE_PAGE_MARGIN, PHONE_PAGE_MARGIN_BOTTOM, phoneLike, gapEl } from './pageGap'

// One page's REGION in the scroll container's content coordinates (live layout px) — the real
// canonical page grid the minimap + diff-panel page rules consume (replacing the paper-width×√2
// approximation, whose drift vs the true breaks was phone-visible).
export interface StaticPageGeo { top: number; height: number }

export interface StaticPaginationHandle {
  /** Live page regions, scroller-content coords. Refreshed by repaint(). */
  pages: StaticPageGeo[]
  /** Re-read band positions + reposition panels + refresh pages after a zoom/width reflow
   *  (breaks are DOM positions — they never move; only the rendered geometry does). */
  repaint(): void
  /** Remove gaps/panels and restore the sheet's classes/inline styles. Idempotent. */
  destroy(): void
}

// ── Break-spec cache (per snapshot + settings + font state) ────────────────────────────────────
// charOffset is the offset into the BLOCK's concatenated text (-1 = insert before the block).
interface BreakSpec { blockIdx: number; charOffset: number; botMargin: number; topMargin: number }
const specCache = new Map<string, BreakSpec[]>()
const SPEC_CACHE_MAX = 50
const cacheGet = (k: string): BreakSpec[] | undefined => {
  const v = specCache.get(k)
  if (v) { specCache.delete(k); specCache.set(k, v) } // LRU touch
  return v
}
const cacheSet = (k: string, v: BreakSpec[]) => {
  specCache.set(k, v)
  while (specCache.size > SPEC_CACHE_MAX) specCache.delete(specCache.keys().next().value as string)
}

// ── Block model ────────────────────────────────────────────────────────────────────────────────
// The static analog of the editor's top-level blocks. Block-level children (DocView's p/h/ul/…)
// are one block each; a run of INLINE children (FullDiffView's flat diff spans under
// white-space:pre-wrap) is grouped into ONE block — its lines wrap freely across the spans, so
// per-span "blocks" would be meaningless for a block-level rule.
interface Block { els: HTMLElement[] }
const INLINE_TAGS = new Set(['SPAN', 'A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'CODE', 'SUB', 'SUP', 'BR', 'IMG'])

function collectBlocks(root: HTMLElement): Block[] {
  const blocks: Block[] = []
  let run: HTMLElement[] | null = null
  for (const child of Array.from(root.children) as HTMLElement[]) {
    if (child.classList.contains('inkwave-page-gap')) continue
    if (INLINE_TAGS.has(child.tagName)) {
      if (!run) { run = []; blocks.push({ els: run }) }
      run.push(child)
    } else {
      run = null
      blocks.push({ els: [child] })
    }
  }
  return blocks
}

// ── Line collection (canonical context) ────────────────────────────────────────────────────────
// Same technique as PaginationExtension.collectLines: range rects per block, height/width filters,
// dedupe by top. Deduping is GLOBAL (sorted first) because inline diff spans share lines across
// elements. absTop (viewport px, valid only inside this measure pass) drives break-point
// resolution; top (root-relative) drives the page math.
interface StaticLine { top: number; absTop: number; blockIdx: number }

// ─── A CONTAINER'S ELEMENT CHILDREN ARE NOT LINES (the pane's copy of the fix) ─────────────────
// ⚠ A RECT MAY ONLY BE ADMITTED IF IT *IS* A LINE. `selectNodeContents(el).getClientRects()` also
// returns the border box of every element the range selects — a `<li>`, a blockquote's `<p>` — and
// those are CONTAINERS of lines. So rects are collected per TEXTBLOCK.
// ⚠ THIS PANE HAS NO PM TREE, so it asks the authority that IS present — the LAYOUT ENGINE, via
// `getComputedStyle().display`. Never a tag name and never a CSS class, either of which silently
// misses the next container the schema grows (R9). The editor asks ProseMirror; one rule, two
// authorities. An element with no block-level element child takes the byte-identical old path.
// → docs/archive/pagination-rounds.md#container-rects

// Inline-level per the layout engine's own answer. `contents` and `none` generate no box of their
// own, so they are not containers whose box could be mistaken for a line either.
const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'contents', 'none', 'ruby', 'ruby-text', 'ruby-base'])
// ⚠ An EMPTY computed display (an unrendered subtree; jsdom sets none on `<em>`/`<span>`/`<code>`)
// counts as INLINE: something with no box cannot be a container mistaken for a line, and descending
// into it would fabricate structure the engine says is absent (R8). It is also what lets the jsdom
// gate exercise the REAL predicate rather than a production it never performs.
const isBlockLevel = (el: Element): boolean => {
  const d = getComputedStyle(el).display
  return !!d && !INLINE_DISPLAYS.has(d)
}

/** THE LIVE KNOWN-NEGATIVE (the `__iwOpenGuard` / `__iwTabDocRule` / `__iwReadGuard` contract).
 *  `window.__iwStaticLineRule = 'range'` restores the PRE-FIX rule verbatim.
 *
 *  ⚠ IT EXISTS BECAUSE THIS BUG IS INVISIBLE TO A RATE: with the bug fully restored, halvesbisect
 *  still prints "OFFSETS IDENTICAL" on a 25-break lists fixture, so `panerect.mjs` must measure the
 *  ARTIFACT (every line's top) rather than wait for a break to move. A negative that cannot fire is
 *  not a negative (R3, R6). → docs/archive/pagination-rounds.md#container-rects */
const preFixRangeRule = (): boolean =>
  typeof window !== 'undefined' &&
  (window as unknown as { __iwStaticLineRule?: string }).__iwStaticLineRule === 'range'

/** The rects that ARE lines for `el`: one range per textblock, recursing through containers.
 *  EXPORTED AS A TEST SEAM — see staticPagination.container.test.ts. */
export function staticLineRects(el: HTMLElement, out: DOMRect[] = []): DOMRect[] {
  if (preFixRangeRule()) { // the known-negative: the pre-fix rule, verbatim
    const r = document.createRange()
    r.selectNodeContents(el)
    out.push(...Array.from(r.getClientRects()))
    return out
  }
  // Fast path AND the correctness-critical one: no element children at all ⇒ nothing but text and
  // therefore nothing to descend into. Skips a getComputedStyle call for the overwhelming case.
  const kids = Array.from(el.childNodes)
  const hasBlockKid = el.children.length > 0 && Array.from(el.children).some(isBlockLevel)
  if (!hasBlockKid) {
    // THE TEXTBLOCK — byte-identical to the pre-fix code: ONE range over the whole element.
    const r = document.createRange()
    r.selectNodeContents(el)
    const rects = Array.from(r.getClientRects())
    if (rects.length) out.push(...rects)
    else {
      // ⚠ An EMPTY textblock has no text rect but still occupies a LINE — without this it vanishes
      // and every break below shifts. A missing block is not a smaller block (R1).
      const b = el.getBoundingClientRect()
      if (b.height >= 1) out.push(b)
    }
    return out
  }
  // A CONTAINER. Descend into its block-level children; take any run of inline/text children
  // between them as its own range. That run case cannot arise in DocView today — but "it cannot
  // arise today" is the reasoning that let this rule rot in three copies, and an anonymous block
  // box has no element to ask, so its lines would be LOST rather than mismeasured (R8).
  let run: Node[] = []
  const flushRun = () => {
    if (!run.length) return
    const r = document.createRange()
    r.setStartBefore(run[0])
    r.setEndAfter(run[run.length - 1])
    out.push(...Array.from(r.getClientRects()))
    run = []
  }
  for (const n of kids) {
    if (n.nodeType === 1 && isBlockLevel(n as Element)) {
      flushRun()
      staticLineRects(n as HTMLElement, out)
    } else run.push(n)
  }
  flushRun()
  return out
}

function collectStaticLines(root: HTMLElement, blocks: Block[]): StaticLine[] {
  const rootTop = root.getBoundingClientRect().top
  const all: Array<{ absTop: number; blockIdx: number }> = []
  blocks.forEach((b, bi) => {
    for (const el of b.els) {
      let rects: DOMRect[] = []
      try { rects = staticLineRects(el) } catch { /* ignore */ }
      if (!rects.length) { // empty block (e.g. a blank paragraph) → one line at the block top
        const r = el.getBoundingClientRect()
        if (r.height >= 1) all.push({ absTop: r.top, blockIdx: bi })
        continue
      }
      for (const r of rects) {
        // ⚠ `isLineRect` is the EDITOR's own predicate (lineRects.ts), never a copy (R2). The
        // tall-box cut stays, but it no longer stands in for a container rule it could not express.
        if (!isLineRect(r)) continue
        all.push({ absTop: r.top, blockIdx: bi })
      }
    }
  })
  all.sort((a, b) => a.absTop - b.absTop)
  const lines: StaticLine[] = []
  let lastTop = -1e9
  for (const l of all) {
    if (sameLine(l.absTop, lastTop)) continue // dedupe fragments on the same line (the editor's rule)
    lastTop = l.absTop
    lines.push({ top: l.absTop - rootTop, absTop: l.absTop, blockIdx: l.blockIdx })
  }
  // PROBE SEAM (the `window.__iwPerf` contract in perflog.ts): a harness assigns
  // `window.__iwStaticLinesHook` and this hands it the line list the pane ACTUALLY measured. A
  // single property check otherwise, zero cost.
  // ⚠ IT HANDS OVER THE LINE LIST, NOT THE BREAKS — a 3px error reaches a gap widget only when a
  // boundary lands within 3px of the overflow cliff, so reading the gaps measures a coincidence (R6).
  // ⚠ AND IT IS A CALLBACK, invoked HERE, INSIDE the forced canonical window: these tops mean
  // nothing in the pane's live layout, so a buffer would hand the probe unreadable numbers (R5).
  // → docs/archive/pagination-rounds.md#static-pane
  if (typeof window !== 'undefined') {
    const hook = (window as unknown as { __iwStaticLinesHook?: (r: HTMLElement, l: StaticLine[]) => void }).__iwStaticLinesHook
    // A probe must never be able to break the pane it measures.
    if (typeof hook === 'function') { try { hook(root, lines.map((l) => ({ ...l }))) } catch { /* ignore */ } }
  }
  return lines
}

// ── Break computation (mirrors PaginationExtension.compute's overflow rules; NO orphan snap) ───
interface Pick { lineIdx: number; snap: boolean; brokeUsed: number }

// EXPORTED AS A TEST SEAM. This function is PURE — lines in, picks out, no DOM — so the rule it
// carries is pinned in the GATE in milliseconds rather than only by a hand-run browser probe. A
// proof that ran once is not a guard (R3). → docs/archive/pagination-rounds.md#three-copies
export function _computeBreakPicksForTest(lines: Array<{ top: number; absTop: number; blockIdx: number }>, textArea: number): Pick[] {
  return computeBreakPicks(lines as StaticLine[], textArea)
}

function computeBreakPicks(lines: StaticLine[], textArea: number): Pick[] {
  const picks: Pick[] = []
  let used = 0
  // `blockIdx` is all the block tracking this rule needs now — the rest existed only to feed the
  // retired orphan snap.
  let blockIdx = -2 // -2 forces the first line to (re)resolve its block (mirrors blockStart=-1)
  for (let i = 0; i < lines.length; i++) {
    const lh = i < lines.length - 1 ? Math.max(1, lines[i + 1].top - lines[i].top) : 24
    if (lines[i].blockIdx !== blockIdx || blockIdx === -2) blockIdx = lines[i].blockIdx
    if (i > 0 && used + lh > textArea) {
      // ⚠ THE ORPHAN SNAP IS GONE, BECAUSE IT IS GONE IN THE EDITOR. This is the THIRD copy of the
      // break rule (PaginationExtension.computeBreaks · arithmeticLayout.paginate · here);
      // production retired the snap and THIS COPY WAS MISSED, under a comment claiming the rules
      // were identical — which is exactly why nobody looked (R2). Change one, check all three, and
      // compare break POSITIONS: equal page counts hide divergent offsets.
      // → docs/archive/pagination-rounds.md#three-copies
      const snap = false
      picks.push({ lineIdx: i, snap, brokeUsed: used })
      used = 0
      blockIdx = -2 // re-resolve the block on the new page (mirrors the extension)
    }
    used += lh
  }
  return picks
}

// ── Break-point resolution: line top → (text node, offset) → block char offset ────────────────
// Text nodes are walked in document order (LTR wrapping ⇒ nondecreasing fragment tops), so the
// FIRST node with any character on the target line contains the line's first character. A binary
// search inside that node finds it — O(pages · log n) rect probes on top of one linear pass.
function textNodesOf(block: Block): Text[] {
  const out: Text[] = []
  for (const el of block.els) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let n = walker.nextNode() as Text | null
    while (n) { out.push(n); n = walker.nextNode() as Text | null }
  }
  return out
}

function charTop(n: Text, o: number): number {
  const r = document.createRange()
  r.setStart(n, Math.min(o, n.data.length))
  r.setEnd(n, Math.min(o + 1, n.data.length))
  const rects = r.getClientRects()
  return rects.length ? rects[rects.length - 1].top : NaN
}

function lineStartOffsetIn(n: Text, target: number): number {
  let lo = 0, hi = Math.max(0, n.data.length - 1)
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    let t = charTop(n, mid)
    let m2 = mid
    while (Number.isNaN(t) && m2 < hi) { m2++; t = charTop(n, m2) } // rare zero-rect chars — probe right
    if (Number.isNaN(t) || t >= target - 2) hi = mid
    else lo = m2 + 1
  }
  return lo
}

/** Resolve each pick's line start to a char offset within its block (canonical layout still forced). */
function resolvePicks(blocks: Block[], lines: StaticLine[], picks: Pick[], pageH: number, topM: number, phone: boolean): BreakSpec[] {
  const specs: BreakSpec[] = picks.map((p) => ({
    blockIdx: lines[p.lineIdx].blockIdx,
    charOffset: -1,
    botMargin: phone ? PHONE_PAGE_MARGIN_BOTTOM : Math.max(MARGIN_BOTTOM, pageH - topM - p.brokeUsed),
    topMargin: phone ? PHONE_PAGE_MARGIN : topM,
  }))
  // Group the mid-block picks by block, resolve each block in one forward pass over its text nodes.
  const byBlock = new Map<number, Array<{ absTop: number; spec: BreakSpec }>>()
  picks.forEach((p, i) => {
    if (p.snap) return // before-block insertion — charOffset stays -1
    const spec = specs[i]
    const list = byBlock.get(spec.blockIdx) ?? []
    list.push({ absTop: lines[p.lineIdx].absTop, spec })
    byBlock.set(spec.blockIdx, list)
  })
  for (const [bi, list] of byBlock) {
    const block = blocks[bi]
    if (!block) continue
    list.sort((a, b) => a.absTop - b.absTop)
    let k = 0
    let acc = 0
    for (const n of textNodesOf(block)) {
      if (k >= list.length) break
      const len = n.data.length
      if (len) {
        const r = document.createRange()
        r.selectNodeContents(n)
        const rects = r.getClientRects()
        const last = rects.length ? rects[rects.length - 1] : null
        while (k < list.length && last && last.top >= list[k].absTop - 2) {
          list[k].spec.charOffset = acc + lineStartOffsetIn(n, list[k].absTop)
          k++
        }
      }
      acc += len
    }
    // Unresolved leftovers degrade to before-block (still a valid page break, just block-snapped).
  }
  return specs
}

// ── Gap insertion at cached/resolved specs (live DOM, any layout) ──────────────────────────────
function insertGaps(blocks: Block[], specs: BreakSpec[], gapped: boolean): HTMLElement[] {
  const inserted: HTMLElement[] = []
  // Locate all points FIRST (offsets are gap-free-DOM values; gaps carry no text so a single
  // forward walk stays valid), then insert in REVERSE document order so earlier text-node
  // references never go stale under later splits.
  const points: Array<{ spec: BreakSpec; node: Text | null; offset: number }> = specs.map((s) => ({ spec: s, node: null, offset: 0 }))
  const byBlock = new Map<number, Array<{ spec: BreakSpec; node: Text | null; offset: number }>>()
  for (const p of points) {
    if (p.spec.charOffset < 0) continue
    const list = byBlock.get(p.spec.blockIdx) ?? []
    list.push(p)
    byBlock.set(p.spec.blockIdx, list)
  }
  for (const [bi, list] of byBlock) {
    const block = blocks[bi]
    if (!block) continue
    list.sort((a, b) => a.spec.charOffset - b.spec.charOffset)
    let k = 0
    let acc = 0
    for (const n of textNodesOf(block)) {
      if (k >= list.length) break
      const len = n.data.length
      while (k < list.length && list[k].spec.charOffset < acc + len) {
        list[k].node = n
        list[k].offset = list[k].spec.charOffset - acc
        k++
      }
      acc += len
    }
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const { spec, node, offset } = points[i]
    const block = blocks[spec.blockIdx]
    if (!block || !block.els.length) continue
    const gap = gapEl(spec.botMargin, spec.topMargin, gapped)
    if (node) {
      const r = document.createRange()
      r.setStart(node, Math.min(offset, node.data.length))
      r.collapse(true)
      r.insertNode(gap) // splits the text node — the browser's own, caret-safe split
    } else {
      const anchor = block.els[0]
      anchor.parentNode?.insertBefore(gap, anchor)
    }
    inserted.push(gap)
  }
  return inserted
}

// ── The paginator ──────────────────────────────────────────────────────────────────────────────
export function paginateStaticDoc(opts: {
  /** The pane's scroll container (the snapshot view's leftScrollRef div). */
  scroller: HTMLElement
  /** Stable identity of the rendered content (snapshot id + view kind) — keys the spec cache. */
  cacheKey: string
  /** Called with fresh page regions whenever repaint() re-reads geometry (zoom/width reflow). */
  onRepaint?: (pages: StaticPageGeo[]) => void
}): StaticPaginationHandle | null {
  const { scroller } = opts
  const surface = scroller.querySelector('.inkwave-editor-surface') as HTMLElement | null
  const sheet = scroller.querySelector('.scroll-paper') as HTMLElement | null
  const root = scroller.querySelector('.tiptap-editor') as HTMLElement | null
  if (!surface || !sheet || !root) return null

  const gapped = gappedPagesEnabled()
  const paper = getPaperSize()
  // Mirror the extension's marker-mode bails: continuous 'scroll' paper and multi-column layouts
  // have no page identity ungapped (PageGuides falls back to its uniform canonical model).
  if (!gapped && (paper === 'scroll' || getColumns() > 1)) return null
  const phone = phoneLike()
  const topM = getTopMarginPx()
  const fluid = paper === 'scroll'
  const { pageWidthPx, pageHeightPx: pageH } = pageBoxPx({
    paperSize: paper === 'letter' ? 'letter' : 'a4',
    orientation: getOrientation(),
    topMarginPx: topM,
    bottomMarginPx: MARGIN_BOTTOM,
    fluidWidthPx: fluid ? sheet.clientWidth : undefined,
  })
  if (pageH <= 0) return null

  // Idempotent: clear any previous gaps so the measure (and the insertion below) sees a clean flow.
  root.querySelectorAll('.inkwave-page-gap').forEach((g) => g.remove())
  const blocks = collectBlocks(root)

  const key = [
    opts.cacheKey, gapped ? 'g' : 'm', paper, getOrientation(), topM, getSideMarginPx(),
    phone ? 'p' : 'd', typeof document !== 'undefined' && document.fonts ? document.fonts.status : '?',
    fluid ? `w${sheet.clientWidth}` : '',
  ].join('|')

  const t0 = performance.now()
  let specs = cacheGet(key)
  const specHit = !!specs
  if (!specs) {
    // CANONICAL MEASUREMENT — the same forced context as the editor (see canonicalMeasure.ts),
    // plus the snapshot pane's own fit-capped zoom, which is a CSS `zoom` on the PAPER (or any
    // wrapper between the content and the surface): force every inline zoom on that path to 1,
    // or the measured line grid would scale with the pane zoom.
    // Set → measure → restore is fully synchronous — the forced layout never paints.
    const restore = forceCanonicalContext(
      fluid
        ? { surface, editor: root }
        : { paper: sheet.parentElement, sheet, surface, editor: root },
      { pageWidthPx, sideMarginPx: getSideMarginPx() },
    )
    const zoomHosts: Array<{ el: HTMLElement; prev: string }> = []
    for (let p = root.parentElement; p && p !== surface; p = p.parentElement) {
      const z = p.style.getPropertyValue('zoom')
      if (z && z !== '1') { zoomHosts.push({ el: p, prev: z }); p.style.setProperty('zoom', '1') }
    }
    // The canonical layout can be SHORTER than the live one → the browser may clamp the pane's
    // scroll; capture and put it back (same pattern as the extension).
    const savedTop = scroller.scrollTop
    const savedLeft = scroller.scrollLeft
    try {
      const lines = collectStaticLines(root, blocks)
      const textArea = Math.max(1, pageH - topM - MARGIN_BOTTOM)
      const picks = lines.length ? computeBreakPicks(lines, textArea) : []
      specs = resolvePicks(blocks, lines, picks, pageH, topM, phone)
    } finally {
      for (let i = zoomHosts.length - 1; i >= 0; i--) zoomHosts[i].el.style.setProperty('zoom', zoomHosts[i].prev)
      restore()
      scroller.scrollTop = savedTop
      scroller.scrollLeft = savedLeft
    }
    cacheSet(key, specs)
  }
  probePerf(specHit ? 'sp.specs.hit' : 'sp.specs.measure', performance.now() - t0)

  const tIns = performance.now()
  const inserted = insertGaps(blocks, specs, gapped)
  probePerf('sp.insert', performance.now() - tIns)

  // Sheet prep + the panel layer — the same classes/contract as the extension's ensureSheet.
  const prevPadTop = sheet.style.paddingTop
  const prevMinH = sheet.style.minHeight
  let layer: HTMLElement | null = null
  if (gapped) {
    sheet.classList.add('inkwave-gapped')
    sheet.style.paddingTop = `${phone ? PHONE_PAGE_MARGIN : topM}px`
    sheet.style.minHeight = `${pageH}px`
    layer = sheet.querySelector(':scope > .inkwave-sheets') as HTMLElement | null
    if (!layer) {
      layer = document.createElement('div')
      layer.className = 'inkwave-sheets'
      layer.setAttribute('aria-hidden', 'true')
      sheet.insertBefore(layer, sheet.firstChild)
    }
  }

  // Band geometry read + panel apply — the extension's readBands/applyBands contract. With the
  // fit-capped pane zoom on the PAPER, the sheet (and its band rects) render VISUALLY scaled while
  // the panel styles are sheet-LOCAL px — convert rect-derived distances by the effective zoom
  // (rect width / clientWidth, exactly 1 when unzoomed), the CSS-`zoom` analog of scaleFor().
  const readBands = (): { tops: number[]; heights: number[]; total: number } | null => {
    if (!layer) return null
    const sr = sheet.getBoundingClientRect()
    const zr = sheet.clientWidth > 0 ? sr.width / sheet.clientWidth : 1
    const z = Math.abs(zr - 1) < 0.01 ? 1 : zr // sub-pixel rect noise at zoom 1 → exactly 1
    const tops: number[] = []
    const heights: number[] = []
    sheet.querySelectorAll('.inkwave-page-gap-band').forEach((band) => {
      const r = (band as HTMLElement).getBoundingClientRect()
      tops.push((r.top - sr.top) / z)
      heights.push(r.height / z)
    })
    // ⚠ DERIVE THE CONTENT EXTENT FROM THE IN-FLOW CHILDREN'S RECTS, IN THE SAME LAYOUT PASS as the
    // band reads (content bottom = the editor root's rect bottom + the sheet's bottom padding). The
    // old `display:none` + minHeight-clear `scrollHeight` read forced a SECOND full re-layout per
    // paint — roughly half of every band repaint on a thesis-sized doc.
    // → docs/archive/pagination-rounds.md#band-geometry
    const rr = root.getBoundingClientRect()
    const pb = parseFloat(getComputedStyle(sheet).paddingBottom) || 0
    const total = (rr.bottom - sr.top) / z + pb
    return { tops, heights, total }
  }
  const applyBands = (geo: { tops: number[]; heights: number[]; total: number }) => {
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
    // FULL FINAL PAGE (MS-Word style, Peter 2026-07-10): a barely-filled last page still paints as
    // a whole sheet. Full height = the average of the previous ≤5 page regions in this SAME
    // geometry (exact under any zoom / phone reflow, where raw canonical pageH would mismatch the
    // live layout); a single-page doc falls back to canonical pageH (its live height at zoom 1).
    const prior = segs.map((s) => s.height)
    const fullH = prior.length
      ? prior.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, prior.length)
      : pageH
    segs.push({ top: cursor, height: Math.max(Math.max(0, geo.total - cursor), Math.round(fullH)) })
    // Give the extended panel somewhere to paint + keep the scroll range consistent with the
    // visual: the sheet's min-height covers the last panel's bottom (readBands neutralizes this
    // during its total read, so it can retract when content shrinks).
    const last = segs[segs.length - 1]
    sheet.style.minHeight = `${Math.max(Math.round(pageH), Math.ceil(last.top + last.height))}px`
    while (layer.children.length > segs.length) layer.lastElementChild!.remove()
    while (layer.children.length < segs.length) {
      const d = document.createElement('div')
      d.className = 'inkwave-sheet'
      const f = document.createElement('div')
      f.className = 'inkwave-sheet-num'
      f.style.cssText = 'position:absolute;bottom:22px;left:0;right:0;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:8px;pointer-events:none'
      const logo = document.createElement('img')
      logo.src = '/inkwave-logo-v7.png'
      logo.alt = ''
      logo.style.cssText = 'width:22px;height:22px;opacity:0.75;flex-shrink:0;display:block'
      f.appendChild(logo)
      const num = document.createElement('span')
      num.style.cssText = 'font-family:"EB Garamond",Georgia,serif;color:#9b5ccc;font-size:0.9rem;line-height:1;display:block'
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
    if (!gapped || !layer) return
    const geo = readBands()
    if (geo) applyBands(geo)
  }

  // Page regions in scroller-content coords — panels in gapped mode, marker bounds otherwise.
  const computePages = (): StaticPageGeo[] => {
    const sRect = scroller.getBoundingClientRect()
    const toContent = (top: number) => top - sRect.top + scroller.scrollTop
    if (gapped && layer) {
      return (Array.from(layer.children) as HTMLElement[]).map((c) => {
        const r = c.getBoundingClientRect()
        return { top: toContent(r.top), height: Math.max(1, r.height) }
      })
    }
    const ys = (Array.from(root.querySelectorAll('.inkwave-page-gap')) as HTMLElement[])
      .map((m) => toContent(m.getBoundingClientRect().top))
      .sort((a, b) => a - b)
    const bounds = [0, ...ys, Math.max(1, scroller.scrollHeight)]
    const pages: StaticPageGeo[] = []
    for (let i = 0; i < bounds.length - 1; i++) pages.push({ top: bounds[i], height: Math.max(1, bounds[i + 1] - bounds[i]) })
    return pages
  }

  const tPaint = performance.now()
  paint()
  probePerf('sp.paint', performance.now() - tPaint)
  const tPages = performance.now()
  const handle: StaticPaginationHandle = {
    pages: computePages(),
    repaint: () => {
      paint()
      handle.pages = computePages()
      opts.onRepaint?.(handle.pages)
    },
    destroy: () => {
      destroyed = true
      ro?.disconnect()
      if (roRaf) cancelAnimationFrame(roRaf)
      inserted.forEach((g) => g.remove())
      layer?.remove()
      if (gapped) {
        sheet.classList.remove('inkwave-gapped')
        sheet.style.paddingTop = prevPadTop
        sheet.style.minHeight = prevMinH
      }
    },
  }

  probePerf('sp.pages', performance.now() - tPages)

  // Phone/narrow layouts reflow the sheet with the pane width — breaks are DOM positions and
  // never move, but the rendered bands do: repaint (rAF-coalesced) whenever the sheet resizes.
  let destroyed = false
  let roRaf = 0
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    if (destroyed) return
    cancelAnimationFrame(roRaf)
    roRaf = requestAnimationFrame(() => { if (!destroyed) handle.repaint() })
  }) : null
  ro?.observe(sheet)

  // PageGuides (ungapped mode) re-reads the fresh markers off this; gapped mode ignores it.
  window.dispatchEvent(new Event('inkwave:pagination-measured'))
  return handle
}
