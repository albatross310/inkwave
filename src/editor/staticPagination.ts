// CANONICAL GAPPED PAGES FOR STATIC CONTENT — the snapshot view's document pane.
//
// The live editor's PaginationExtension measures line layout inside a forced canonical context
// and places gap widgets at page-break DOCUMENT POSITIONS. The snapshot doc pane renders STATIC
// HTML (FullDiffView / DocView — no ProseMirror), so this module re-implements the same pipeline
// against plain DOM:
//   1. measure line rects in the SAME forced canonical context (canonicalMeasure: mm paper width,
//      desktop side margins, zoom 1, base font — plus the pane's own CSS-`zoom` wrapper forced
//      to 1), inside one synchronous no-paint window;
//   2. compute breaks with the SAME page box (pageModel) and the SAME overflow rules as
//      PaginationExtension.compute() — INCLUDING its retirement of the widow/orphan snap. That
//      sentence used to say "orphan-snap rules" and this file still snapped after the editor
//      stopped, which is precisely how a claim of sameness outlives the sameness. It is now
//      MEASURED rather than asserted: halvesbisect.prove.mjs reads the model, the LIVE EDITOR's own
//      gap widgets and this pane from ONE document and requires all three to agree.
//   3. insert the SAME gap elements (pageGap.ts) at the break points — recorded as text-node
//      CHARACTER OFFSETS, the static analog of a ProseMirror document position, so breaks ride
//      any live reflow (diff zoom, phone width, editor-zoom var) exactly like the editor's
//      widgets ride theirs.
// The sheet panels + aqua bands reuse the editor's CSS classes (.inkwave-gapped /
// .inkwave-sheets / .inkwave-sheet / .inkwave-page-gap-band), so day/night theming and the phone
// band styling apply unchanged. Ungapped mode inserts the zero-height break MARKERS instead; the
// pane's PageGuides (Scroll.tsx) pick them up off 'inkwave:pagination-measured' and draw the
// dashed rules — full parity with the editor's two page modes.
//
// Break specs are cached per (snapshot, page settings, font state) as {block, charOffset} — so
// scrubbing back through visited snapshots re-inserts gaps with NO canonical re-measure (zero
// forced hypothetical reflows; just the insertion itself).

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

// ─── A CONTAINER'S ELEMENT CHILDREN ARE NOT LINES (2026-07-17 — the pane's copy of the fix) ─────
//
// `range.selectNodeContents(el).getClientRects()` returns, per CSSOM-View, the border box of every
// element the range SELECTS whose parent it does not — i.e. the range container's own element
// children — and not only text-line rects. For a `<p>` that is harmless: its element children are
// inline mark spans whose per-line fragment boxes coincide with the text rects and are eaten by the
// 3px dedup. For a `<ul>` or a `<blockquote>` it is not.
//
// MEASURED in the REAL /snapshot pane (scripts/textrender-probe/panerect.mjs, DocView's own DOM,
// 8-chapter fixture) against the DOM's own TEXT-NODE rects — a text node has no border box, so its
// rects are lines by construction and cannot contain a container's box:
//   529 shipped lines / 529 true lines — the COUNT TELESCOPES, which is why every count- and
//   height-based check in this file passed — and **24 of them sit exactly 3.000px too high**:
//   UL 8 · OL 8 · BLOCKQUOTE 8. The first `<ul>`'s raw rects, verbatim:
//     relTop 0     h 58.219   ← the `<li>`'s BORDER BOX (a 2-line item), admitted as a line
//     relTop 3     h 23       ← the item's OWN first text rect — DELETED by `top - lastTop <= 3`
//     relTop 32.109 h 23      ← the item's second line
//     relTop 62.718 h 87.328  ← a 3-line item's box: over the 80px cut, dropped — right by luck
// The 3.000px is the half-leading: (lineHeight 29.109 − text 23) / 2 = 3.05. It is not a list
// constant, which is why `<blockquote>`'s `<p>` box does the identical thing.
//
// THE 80px CUT WAS THE ONLY THING STANDING HERE, AND IT IS A COINCIDENCE, NOT A RULE. It admits a
// container box of ≤80px and drops one over it, so whether this pane paginates correctly depended
// on how many lines an item happened to wrap to: a 2-line `<li>` (58.219px) broke it, a 3-line one
// (87.328px) did not. The old comment on that line — "skip tall boxes (nested element border-boxes,
// not text lines)" — NAMED this exact class while the constant let the short half of it through.
//
// THE FIX, and why it is not a copy of the editor's. PaginationExtension asks ProseMirror
// (`child.isTextblock`) what a textblock is. This pane HAS NO PM TREE — DocView and FullDiffView
// render plain DOM — so it asks the other authority that is actually present: the LAYOUT ENGINE,
// via `getComputedStyle().display`. Never a tag name and never a CSS class: either would silently
// miss the next container the schema grows, which is the whole reason this bug reached three copies.
// An element with no block-level element child IS a textblock and takes the byte-identical single
// `selectNodeContents` call it always did — which is what keeps every prose document's breaks
// bit-for-bit unchanged (breaks.prove.mjs: [2403,4856,7205,9476,…], identical).

// Inline-level per the layout engine's own answer. `contents` and `none` generate no box of their
// own, so they are not containers whose box could be mistaken for a line either.
const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'contents', 'none', 'ruby', 'ruby-text', 'ruby-base'])
// An EMPTY computed display means the element has no resolved box at all (an unrendered subtree —
// and jsdom, whose UA stylesheet sets no `display` on `<em>`/`<span>`/`<code>`). Treat it as
// inline: something with no box cannot be a container whose box is mistaken for a line, and the
// only alternative — descending into it — would fabricate structure that the engine says is absent.
// This is also what lets the jsdom gate below exercise the REAL predicate: without it, a test that
// passed there would be asserting a recursion production never performs.
const isBlockLevel = (el: Element): boolean => {
  const d = getComputedStyle(el).display
  return !!d && !INLINE_DISPLAYS.has(d)
}

/** THE LIVE KNOWN-NEGATIVE (the `__iwOpenGuard` / `__iwTabDocRule` / `__iwReadGuard` contract).
 *  `window.__iwStaticLineRule = 'range'` restores the PRE-FIX rule verbatim — ONE
 *  `selectNodeContents` over the whole block, container boxes and all.
 *
 *  IT EXISTS BECAUSE THIS BUG IS INVISIBLE TO A RATE. The artifact is a 3.000px error on a ~29px
 *  line grid, so it moves a page break only when a boundary happens to land within 3px of the
 *  overflow cliff. MEASURED: with the bug fully restored, `halvesbisect` on a 6k-word / 25-break
 *  lists fixture still prints "OFFSETS IDENTICAL" — not one break moves. A probe that waited for a
 *  break to move would therefore certify this bug as fixed while it sat there, which is exactly
 *  what the pre-existing `+ lists` row did for as long as it existed.
 *  So `panerect.mjs` measures the ARTIFACT instead — every line's top, against the DOM's own
 *  text-node rects — and this seam is what lets it prove, against the REAL production path and in
 *  ONE build, that it can still SEE the bug. A negative that cannot fire is not a negative. */
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
      // An EMPTY textblock (a blank list item, a blank paragraph inside a blockquote) has no text
      // rect but still occupies a line. Without this it would vanish from the line list and every
      // break below it would shift — a missing block is not a smaller block.
      const b = el.getBoundingClientRect()
      if (b.height >= 1) out.push(b)
    }
    return out
  }
  // A CONTAINER. Descend into its block-level children; take any run of inline/text children
  // between them as its own range. The run case cannot arise in DocView (which wraps every block
  // node in an element) — but "it cannot arise today" is exactly the reasoning that let this rule
  // rot in three copies, and an anonymous block box has no element to ask, so its lines would
  // simply be LOST rather than mismeasured.
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
        // `isLineRect` — the EDITOR's own predicate (lineRects.ts), not a copy of it. The tall-box
        // cut stays and still means what it always did; it simply no longer has to stand in for a
        // container rule it was never able to express (it admitted a 58.219px `<li>` box and
        // dropped an 87.328px one — the same bug, decided by how many lines an item wrapped to).
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
  // PROBE SEAM (the `window.__iwPerf` contract in perflog.ts, one step up): a harness assigns
  // `window.__iwStaticLinesHook = (root, lines) => {…}` and this hands it the line list this pane
  // ACTUALLY measured. A single property check otherwise, zero cost.
  //
  // WHY THE LINE LIST AND NOT THE BREAKS. The breaks are already in the DOM as `.inkwave-page-gap`
  // widgets and any probe can walk them — that is what halvesbisect does. But a 3.000px error in
  // this list only reaches those widgets when a boundary lands within 3px of the overflow cliff, so
  // reading the gaps measures a coincidence rather than the rule. MEASURED: with the pre-fix rule
  // restored, halvesbisect moves NOT ONE of 25 breaks on a lists fixture.
  //
  // WHY A CALLBACK AND NOT AN ARRAY. It is invoked HERE, still inside the FORCED CANONICAL WINDOW
  // (paper width, side margins, zoom 1 — see the caller). These tops mean nothing in the pane's
  // live layout, which wraps at a different width and may carry a fit-capped CSS zoom: comparing
  // canonical tops against live rects is trap #8, "the verdict is unreadable off-canonical". A
  // buffer would hand the probe numbers it could only read after the context was restored. A hook
  // lets the probe's own comparison run in the coordinate system the numbers belong to — and keeps
  // the probe's logic in the probe.
  if (typeof window !== 'undefined') {
    const hook = (window as unknown as { __iwStaticLinesHook?: (r: HTMLElement, l: StaticLine[]) => void }).__iwStaticLinesHook
    // A probe must never be able to break the pane it measures.
    if (typeof hook === 'function') { try { hook(root, lines.map((l) => ({ ...l }))) } catch { /* ignore */ } }
  }
  return lines
}

// ── Break computation (mirrors PaginationExtension.compute's overflow rules; NO orphan snap) ───
interface Pick { lineIdx: number; snap: boolean; brokeUsed: number }

// EXPORTED AS A TEST SEAM (2026-07-17). This function is PURE — lines in, picks out, no DOM — so
// the rule it carries can be pinned in the GATE in milliseconds instead of only by a hand-run
// browser probe. That distinction is not academic: the orphan snap below survived here for a week
// after the editor retired it, with every suite green, because its only possible witness was a
// browser comparison nobody ran. A proof that ran once is not a guard.
export function _computeBreakPicksForTest(lines: Array<{ top: number; absTop: number; blockIdx: number }>, textArea: number): Pick[] {
  return computeBreakPicks(lines as StaticLine[], textArea)
}

function computeBreakPicks(lines: StaticLine[], textArea: number): Pick[] {
  const picks: Pick[] = []
  let used = 0
  // `blockIdx` is all the block tracking this rule needs now: `blockStartUsed`/`blockFirstLine`
  // existed ONLY to feed the orphan snap, and typecheck flagged them the moment it went — which is
  // its own small confirmation that the snap was the only thing reading them.
  let blockIdx = -2 // -2 forces the first line to (re)resolve its block (mirrors blockStart=-1)
  for (let i = 0; i < lines.length; i++) {
    const lh = i < lines.length - 1 ? Math.max(1, lines[i + 1].top - lines[i].top) : 24
    if (lines[i].blockIdx !== blockIdx || blockIdx === -2) blockIdx = lines[i].blockIdx
    if (i > 0 && used + lh > textArea) {
      // THE ORPHAN SNAP IS GONE — because it is gone in the editor (2026-07-17).
      //
      // This is the THIRD copy of the break rule (PaginationExtension.computeBreaks,
      // arithmeticLayout.paginate, and here). When production retired the widow/orphan snap
      // (`const snap = false`, PaginationExtension ~457: "a straddling paragraph is broken at the
      // overflow line wherever it falls"), `paginate()`'s default was corrected and THIS COPY WAS
      // MISSED — while the comment above it claimed "identical policy (and 0.22 constant) to the
      // editor" and this file's header claimed "the SAME overflow / orphan-snap rules as
      // PaginationExtension.compute()". Both were false, and the claim is exactly why nobody looked.
      //
      // MEASURED (halvesbisect.prove.mjs, three corners from ONE document — the canvas model, the
      // LIVE EDITOR's own gap widgets, and this pane): the pane was +2 pages on a 25-page document,
      // on PLAIN PROSE — no lists, no citations, no refList. canvas === EDITOR on every shape, so
      // the pane was the outlier. Snapping pushes a small orphan onto the next page, which the
      // editor stopped doing, so /snapshot has shown page numbers the editor disagrees with since
      // staticPagination was written (2026-07-10) — the minimap's and the diff panel's included.
      //
      // Canonical pagination's whole claim is "the same text on page N at every zoom, on phone, and
      // in print". A pane that mirrors the editor may not carry a rule the editor retired.
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
  /** Application surfaces are continuous authored objects, not stacks of document-paper sheets. */
  presentation?: 'document' | 'application'
  /** Called with fresh page regions whenever repaint() re-reads geometry (zoom/width reflow). */
  onRepaint?: (pages: StaticPageGeo[]) => void
}): StaticPaginationHandle | null {
  const { scroller } = opts
  const surface = scroller.querySelector('.inkwave-editor-surface') as HTMLElement | null
  const sheet = scroller.querySelector('.scroll-paper') as HTMLElement | null
  const root = scroller.querySelector('.tiptap-editor') as HTMLElement | null
  if (!surface || !sheet || !root) return null

  // Keep the canonical break model and geometry handle for snapshot navigation, but application
  // surfaces use its zero-size markers: no visual page gaps may be inserted inside the tool frame.
  const gapped = opts.presentation === 'application' ? false : gappedPagesEnabled()
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
    // CONTENT height (panels + full-final-page minHeight excluded) from the SAME clean layout as
    // the band rects: content bottom = the editor root's rect bottom + the sheet's own bottom
    // padding. The old display:none + minHeight-clear scrollHeight read forced a SECOND full
    // re-layout of the pane per paint (and a third when restored + re-read by computePages) —
    // roughly half of every band repaint's cost on a thesis-sized doc (probed 2026-07-11). The
    // panels are absolutely positioned and minHeight never moves the ROOT, so this equals the
    // old hidden-layer scrollHeight by construction — the "never retracts" fixpoint and the
    // minHeight ratchet both only ever inflated scrollHeight, never the root's bottom.
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
