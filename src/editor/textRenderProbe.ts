// TEXT-RENDER PROBE SURFACE (flag `inkwave:textRender`, default OFF).
//
// The whole point of this round is an HONEST measurement, and this codebase has been burned five
// times by results proven in a context production never uses (a plain-div wrap harness; a ligatures-
// on font grid; a font we don't ship; a Chromium hinting artifact; and canvasShapingMatchesEditor,
// a gate that always returned false and silently disabled arithLayout for months). So the renderer
// is measured HERE — inside the running app, against the LIVE editor's document, with the REAL
// shipped fonts at the REAL device DPR — not in a harness that reimplements the context.
//
// Loaded by a flag-gated dynamic import from TiptapEditor, so it costs nothing when off.

import type { Editor } from '@tiptap/react'
// The /snapshot seam under test — the standalone schema, imported here so the probe compares it
// against the LIVE editor's rather than against another copy of itself. `schemaSpec` is shared with
// the gate-kept unit test so both compare schemas by the SAME definition of "same".
import { getEditorSchema, nodeFromContentJson, schemaSpec } from './editorSchema'
import { makeCanvasMeasure, makeFontLoaded, type Measure } from './arithmeticLayout'
import {
  buildRenderModel, paintPage, paintMapStrip, canonicalGeomFromSettings,
  pageContainingPos, anchorPosOfPage,
  type RenderGeom, type RenderModel,
} from './textRender'
// The citeBox cache key MUST be the same one PaginationExtension's DOM canonical measure harvested
// under (it calls harvestCiteBoxes(doc, …, getCitationStyle(), bibProvider.getVersion(), 18)) — a
// different style/epoch/base misses every lookup and every citation block placeholders out. Read the
// same sources rather than passing a constant.
import { getCitationStyle } from '../citations/citationsBus'
import { bibProvider } from '../citations/bibProvider'
import { harvestBlockStyles } from './blockStyles'
import { harvestRefChromeStyles, backrefBox, noteBox } from '../citations/refChrome'
import { TextRenderStore } from './textRenderStore'
import {
  buildBreakTable, contextSig, bibSignature, pageStart, pageOfPos,
  loadTables, putTable, getTable, persist, tableStats, _resetTables,
  type TableStats,
} from './breakTable'
// The REAL production line-acquisition functions — exercised directly so the audit can never drift
// from what the paginator actually does (a comparison run through a copy cancels its own error).
import { blockLineRects, keepLineRects } from './extensions/PaginationExtension'
// The BASELINE we are measured against — imported READ-ONLY so the head-to-head runs the REAL
// production bake path (the SVG-foreignObject capture), not a reimplementation of it. Nothing here
// mutates the thumbnail system; the bake path is owned elsewhere.
import { captureRegion } from './scrubRaster'

// The REAL geometry the live document is paginated in — read from the same settings the live
// PaginationExtension reads, never a harness constant.
// liveGeom now lives in textRender.ts as canonicalGeomFromSettings() — /snapshot needs the same
// rule and two copies is how two routes start paginating to different page sizes.
const liveGeom = canonicalGeomFromSettings

// The citeBox lookup key, read from the SAME sources the DOM canonical measure harvests under.
// If these drift, every citation misses ⇒ every citation-bearing block placeholders out ⇒ coverage
// collapses — and it would look exactly like "the arithmetic engine can't do citations" rather than
// "the probe asked with the wrong key". That failure mode is why coverage is reported alongside the
// citeBox hit/miss counters, never on its own.
function buildOpts(): { citationStyle: string; bibEpoch: number } {
  return { citationStyle: getCitationStyle(), bibEpoch: bibProvider.getVersion() }
}

// Harvest heading/list styles from the LIVE .ProseMirror. This is only legitimate in the CANONICAL
// context — a rendered value is the canonical value only when the live layout IS canonical, which on
// desktop at defaults it is (PaginationExtension's `canonicalIsLive`: no phone rules, zoom 1,
// magnify 1). Asserted, not assumed: harvesting under a zoom would bake the zoomed font size into a
// "canonical" table and every break would be wrong in a way that looks like an engine bug.
// PRODUCTION HOME (not this file): beside harvestCiteBoxes inside the DOM canonical measure, which
// forces that context explicitly. Here the probe drives it because the prototype has no wire-in.
function harvestNow(): { ok: boolean; reason: string } {
  const pm = document.querySelector('.ProseMirror') as HTMLElement | null
  if (!pm) return { ok: false, reason: 'no .ProseMirror' }
  const cs = getComputedStyle(pm)
  if (Math.abs(parseFloat(cs.fontSize) - 18) > 0.01) return { ok: false, reason: `not canonical: base ${cs.fontSize}` }
  const root = getComputedStyle(document.documentElement)
  const zoom = parseFloat(root.getPropertyValue('--iw-editor-zoom') || '1') || 1
  const mag = parseFloat(root.getPropertyValue('--iw-magnify') || '1') || 1
  if (Math.abs(zoom - 1) > 0.001 || Math.abs(mag - 1) > 0.001) return { ok: false, reason: `not canonical: zoom ${zoom} magnify ${mag}` }
  harvestBlockStyles(pm, 18)
  // The refList chrome's CSS sub-styles (the arrow's 1.15em, the link's 0.22em padding, the button's
  // border) ride the same canonical harvest. They are VERSION-INDEPENDENT — properties of the
  // stylesheet, not of a document — which is what lets the renderer compose a back-ref box for a
  // version whose bibliography it has never rendered.
  harvestRefChromeStyles(pm, 18)
  return { ok: true, reason: 'canonical' }
}

export interface PaintResult {
  /** = flushedMs. The honest number. */
  ms: number
  /** JS command-recording time only — near-zero and MEANINGLESS on its own. Reported to show the gap. */
  recordedMs: number
  /** Record + forced raster completion. This is what a frame actually costs. */
  flushedMs: number
  canvas: HTMLCanvasElement
}

export interface ProbeApi {
  geom(): RenderGeom
  build(): { model: RenderModel; ms: number }
  buildCold(): { model: RenderModel; ms: number }
  paint(model: RenderModel, pageIdx: number, opts?: Record<string, unknown>): PaintResult
  paintFloor(opts?: Record<string, unknown>): number
  map(model: RenderModel, opts?: Record<string, unknown>): PaintResult
  pageOf(model: RenderModel, pos: number): number
  anchorOf(model: RenderModel, page: number): number
  words(): number
  dpr(): number
  /** The LIVE editor's own page-break doc positions, read off its rendered gap widgets. The ground
   *  truth the arithmetic model must agree with — if it doesn't, pages show the wrong words. */
  liveBreaks(): number[]
  /** THE /snapshot SCHEMA SEAM (2026-07-17). Compares the standalone `getEditorSchema()` — the one
   *  /snapshot parses contentJson with, built WITHOUT the editor's plugin closures and WITHOUT an
   *  Editor instance — against the LIVE editor's OWN `editor.schema`. This is the from-outside
   *  query: everything else about the seam is derived from the same list and would agree with
   *  itself. Also re-parses the live doc through the standalone schema and asserts PM-level
   *  equality, so the answer covers this document's real citations/math, not just type names. */
  schemaIdentity(): Record<string, unknown>
  /** THE COST /snapshot's sweep ADDS, which no previous number covers. ROUND 13's 62-82ms/version
   *  was `buildRenderModel` fed `editor.state.doc` — an ALREADY-PARSED node. /snapshot has no
   *  editor, so every version must first be parsed from its contentJson, and that parse is this
   *  seam's own increment. Warmed in-page before timing (12 identical calls go 291.7 → 81.8ms
   *  settled: a probe timing a few calls over CDP round-trips reports the JIT tier-up, not the work). */
  parseCost(iters: number): Record<string, unknown>
  /** Parse `json` with the STANDALONE schema and compare it to the LIVE editor's doc — the same
   *  path `schemaIdentity().docEq` takes. Exists so the known-negative can drive that identical
   *  comparison to the OPPOSITE answer (a negative that runs through a different path proves
   *  nothing about this one). Returns null if the standalone schema refused the json. */
  docEqOf(json: unknown): boolean | null
  /** Do the LIVE editor's breaks all land at true line starts? Line starts are derived from real
   *  text rects, skipping inline-atom NodeView interiors — independent of collectLines. */
  midlineAudit(debugNear?: number): Record<string, unknown>
  /** Per-block line counts: truth vs the old whole-block rect path vs the collapsed path. Measures
   *  the PHANTOM LINE itself, so it sees the artifact whether or not a break happens to land on it. */
  lineCountAudit(): Record<string, unknown>
  /** WHY IS THE LAST PAGE UNREACHABLE BY CONTENT? Dumps the model's TAIL — the per-page line
   *  histogram (an EMPTY page is a page no position can map into), the last blocks/lines, and the
   *  page every candidate tail position resolves to. Diagnostic only: it asserts nothing, it shows
   *  the structure, because the self-consistency checks (pagesAgreesWithWalk, maxPageOfLine ==
   *  pages-1, pageTopLen == pages) all PASS while the bug survives — so the answer is somewhere
   *  those three cannot look. */
  tailProof(): Record<string, unknown>
  // ── OPFS BREAK-TABLE ROUND TRIP (2026-07-17) ───────────────────────────────────────────────
  // The persistence layer had ZERO CALLERS and had never executed once. These are the first, and
  // they exist to make it EXECUTE against real OPFS through storage/opfsWrite.ts, across a real
  // reload. NOT a pane wiring: what document the table models is a separate, blocked question
  // (round 12 — the pane renders flat for 115/116 until RichDiffView lands). This proves the
  // STORE, and says nothing about the renderer's fidelity to the pane.
  /** Build `versions` tables from the live doc, put them, and FLUSH to OPFS (awaited, not debounced). */
  tableWrite(docId: string, versions: number): Promise<Record<string, unknown>>
  /** Hydrate the index from OPFS. The reload side of the round trip. */
  tableLoad(docId: string): Promise<Record<string, unknown>>
  /** Look a version up under the CURRENT canonical signature. */
  tableGet(docId: string, snapId: string): Record<string, unknown>
  /** THE KNOWN-NEGATIVE: look up under a DELIBERATELY WRONG signature. Must be a counted stale
   *  MISS that rebuilds — never a silent reuse. A table from another context paints wrong words. */
  tableGetStale(docId: string, snapId: string): Record<string, unknown>
  /** The canonical signature this session computes — compared across a reload it proves the sig is
   *  REPRODUCIBLE. An unstable sig would stale-miss every hydrated table and the cache would be
   *  silently worthless while reporting a full disk index. */
  tableSig(): string
  tableStats(docId: string): TableStats
  /** Drop the in-memory index WITHOUT touching disk — simulates a cold start in one page. */
  tableForgetMemory(): void
  /** BASELINE A — the REAL production bake: SVG-foreignObject capture of a live pane. */
  bake(selector: string, scale: number): Promise<Record<string, unknown>>
  /** BASELINE B — the REAL present path: WebP encode (0.5×/q0.7, as snapThumbs) → decode → blit. */
  thumbRoundTrip(canvas: HTMLCanvasElement, scale: number): Promise<Record<string, unknown>>
  /** Heap cost of N render models — the honest comparison against the 62.7MB bitmap pool. */
  modelMem(n: number): Record<string, unknown>
  /** WHOLE-DOCUMENT + memory proof at real session scale (N versions through the store). */
  storeProof(versions: number, touch: boolean): Record<string, unknown>
  /** THE CRUX: can a page be laid out from its own break position, WITHOUT the prefix? */
  windowProof(): Record<string, unknown>
  /** WINDOW MODE as BUILT: exact vs the full model, and actually O(window) not O(tail). */
  windowCost(): Record<string, unknown>
  /** Break table: size, build cost, and the PORTABILITY claim (zoom-independence) VERIFIED. */
  tableProof(): Record<string, unknown>
  /** Block-level coverage on the LIVE doc: what renders vs what placeholders out, and why. */
  coverage(): Record<string, unknown>
  /** Per-block computed-vs-REAL-DOM geometry. Localises a break divergence to the exact block. */
  blockGeoCheck(): Record<string, unknown>
  /** The known-positive self-test: PROVE the probe can see a difference before trusting a null. */
  selfTest(): Record<string, unknown>
  /** COMPOSED chrome boxes (back-ref group / note button) for a set of marks, from the harvested
   *  sub-styles. The prover compares these against the live DOM's own rects — if the composition is
   *  right, a version we have never rendered can still be laid out. */
  chromeBox(kind: 'backref' | 'note', arg: unknown): Record<string, unknown> | null
}

export function installTextRenderProbe(editor: Editor): void {
  let measure = makeCanvasMeasure()
  let fontLoaded = makeFontLoaded(measure)

  // One reusable canvas per pane — what production would actually hold.
  let _scratch: HTMLCanvasElement | null = null
  const scratch = (): HTMLCanvasElement => (_scratch ??= document.createElement('canvas'))
  let _mapScratch: HTMLCanvasElement | null = null
  const mapScratch = (): HTMLCanvasElement => (_mapScratch ??= document.createElement('canvas'))

  const api: ProbeApi = {
    geom: liveGeom,

    build() {
      harvestNow()
      const g = liveGeom()
      const t0 = performance.now()
      const model = buildRenderModel(editor.state.doc, g, measure, fontLoaded, buildOpts())
      return { model, ms: performance.now() - t0 }
    },

    // COLD = a fresh measure cache (no memoised advances). This is the honest first-open number;
    // `build()` after it is the warm number. Conflating them is how a "few ms" claim gets made.
    buildCold() {
      harvestNow()
      measure = makeCanvasMeasure()
      fontLoaded = makeFontLoaded(measure)
      const g = liveGeom()
      const t0 = performance.now()
      const model = buildRenderModel(editor.state.doc, g, measure, fontLoaded, buildOpts())
      return { model, ms: performance.now() - t0 }
    },

    // PERSISTENT CANVAS. Allocating a fresh 3.5-megapixel canvas per page is a HARNESS artifact, not
    // the renderer's cost — production reuses one canvas per pane (scrubRaster's round-4 lesson: the
    // per-step attach re-layerized + re-uploaded a full texture every step). Measuring the alloc as
    // if it were render cost would overstate the renderer by ~4×. `fresh: true` measures the alloc
    // path deliberately, so the difference is visible rather than assumed.
    // RETURNS BOTH NUMBERS, ALWAYS. Canvas 2D `fillText` RECORDS a command; it does not rasterise.
    // Timing only the record loop yields ~0ms and is a LIE of exactly the shape that already bit this
    // codebase (round-4: "the show() 0.4ms was JS-only and hid the real cost" — the felt lag the JS
    // timer never saw). `flushedMs` forces the raster to complete (a 1px readback drains the command
    // queue) and is THE number to quote. `recordedMs` is kept only to show the gap.
    paint(model, pageIdx, opts = {}) {
      const g = liveGeom()
      const fresh = (opts as { fresh?: boolean }).fresh
      const canvas = fresh ? document.createElement('canvas') : scratch()
      const t0 = performance.now()
      paintPage(model, pageIdx, canvas, g, { dpr: window.devicePixelRatio, measure, ...opts })
      const recordedMs = performance.now() - t0
      try { canvas.getContext('2d')?.getImageData(0, 0, 1, 1) } catch { /* tainted → already flushed */ }
      const flushedMs = performance.now() - t0
      return { ms: flushedMs, recordedMs, flushedMs, canvas }
    },

    // The paint FLOOR: canvas sizing + the parchment fill, with no lines drawn at all. Whatever this
    // costs, no page render of any design can beat it — so it says how much of the paint number is
    // actually text.
    paintFloor(opts = {}) {
      const g = liveGeom()
      const empty: RenderModel = { lines: [], blocks: [], pageOfLine: [], pageTop: [0], pages: 1, contentHeight: 0, coverage: {}, breaks: [], sig: '', breaksReliable: true, reliablePages: 1, firstEstimatedPos: null, estimatedBlocks: 0 }
      const canvas = (opts as { fresh?: boolean }).fresh ? document.createElement('canvas') : scratch()
      const t0 = performance.now()
      paintPage(empty, 0, canvas, g, { dpr: window.devicePixelRatio, measure, ...opts })
      try { canvas.getContext('2d')?.getImageData(0, 0, 1, 1) } catch { /* already flushed */ }
      return performance.now() - t0
    },

    map(model, opts = {}) {
      const g = liveGeom()
      const canvas = (opts as { fresh?: boolean }).fresh ? document.createElement('canvas') : mapScratch()
      const t0 = performance.now()
      paintMapStrip(model, canvas, g, { dpr: window.devicePixelRatio, measure, ...opts })
      const recordedMs = performance.now() - t0
      try { canvas.getContext('2d')?.getImageData(0, 0, 1, 1) } catch { /* already flushed */ }
      const flushedMs = performance.now() - t0
      return { ms: flushedMs, recordedMs, flushedMs, canvas }
    },

    pageOf: (model, pos) => pageContainingPos(model, pos),
    anchorOf: (model, page) => anchorPosOfPage(model, page),
    words: () => editor.state.doc.textContent.split(/\s+/).filter(Boolean).length,
    dpr: () => window.devicePixelRatio,

    // The live editor's REAL breaks: each page-gap widget's doc position. The editor (arithLayout
    // default OFF) derives these from the DOM measure, so this is the independent ground truth —
    // comparing my arithmetic breaks against it is the only way to know whether a rendered page
    // carries the SAME WORDS the editor puts there. A pixel diff alone can't tell you that; it just
    // reports "different", and a page of correct-but-shifted content looks the same as a bug.
    liveBreaks() {
      const out: number[] = []
      document.querySelectorAll('.inkwave-page-gap').forEach((el) => {
        try {
          const pos = editor.view.posAtDOM(el as HTMLElement, 0)
          if (typeof pos === 'number' && pos >= 0) out.push(pos)
        } catch { /* a widget PM can't resolve — skip rather than fabricate */ }
      })
      return out.sort((a, b) => a - b)
    },

    // ── THE MID-LINE BREAK AUDIT ─────────────────────────────────────────────────────────────
    // A page break must land at a LINE START. If it lands mid-line, the page gap opens in the middle
    // of a rendered line — the "space left on the last line" of a split paragraph.
    //
    // ⚠ MEASURE THE NATURAL LAYOUT, NOT THE GAPPED ONE. The page-gap widget is a display:block span,
    // so it FORCES a line break at its own position ("the break it forces coincides with the line
    // start it sits at" — pageGap.ts). Asking the GAPPED DOM whether a break sits at a line start is
    // therefore VACUOUS: every break trivially does, and the audit reports a confident 0 for a
    // document full of real mid-line breaks. That is exactly the house failure mode, and the first
    // version of this audit fell into it. So the gaps are removed from flow first, and the question
    // is asked of the NATURAL wrapping — the gap-free canonical layout collectLines claims to
    // measure (compute() clears the widgets before measuring; on desktop at defaults the live layout
    // IS canonical, so hiding the gaps reproduces that context).
    //
    // Line starts are derived INDEPENDENTLY of collectLines: a document-order walk of the real text
    // characters, plus each inline ATOM as ONE unit via its own outer box. An atom's INTERIOR boxes
    // never vote — they are the fiction under test (the citation NodeView's inline-flex ⤵ button sits
    // ~6px off the line, past the 3px dedup, and became a phantom line). An atom that begins a line
    // IS a line start, so it must be counted, or a legitimate break before a line-leading citation
    // false-positives.
    //
    // POLARITY — both must hold before any number here is believed:
    //   • known-NEGATIVE: plain prose (no NodeViews) must audit 0 mid-line breaks;
    //   • known-POSITIVE: pre-fix, citation-dense prose must reproduce real mid-line breaks.
    // An audit that reports 0 everywhere is blind, not passing.
    midlineAudit(debugNear?: number) {
      const view = editor.view
      const doc = view.state.doc
      const trace: Array<Record<string, unknown>> = []
      // Captured BEFORE the gaps are hidden — these are production's real, applied break positions.
      const breaks = api.liveBreaks()

      // ⚠ THE VERDICT IS ONLY MEANINGFUL WHERE THE RENDERING IS CANONICAL. Breaks are measured in a
      // FORCED canonical context (18px base, desktop margins, zoom 1, magnify 1). The phone RENDERS
      // the same doc at 22.5px in a ~350px column — a different reflow entirely — so a canonical
      // break lands wherever it falls in the phone's own wrapping. That is canonical pagination
      // working as designed (same words on the same page everywhere), not a mid-line bug; auditing
      // canonical positions against a non-canonical reflow measures the question, not the code.
      // Desktop at defaults IS canonical (canonicalIsLive), which is where the verdict counts.
      const pm = document.querySelector('.ProseMirror') as HTMLElement | null
      const baseFont = pm ? parseFloat(getComputedStyle(pm).fontSize) : NaN
      const rootCS = getComputedStyle(document.documentElement)
      const zoom = parseFloat(rootCS.getPropertyValue('--iw-editor-zoom') || '1') || 1
      const magnify = parseFloat(rootCS.getPropertyValue('--iw-magnify') || '1') || 1
      const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse) and (hover: none)').matches
      const renderingIsCanonical = Math.abs(baseFont - 18) < 0.01 && zoom === 1 && magnify === 1 && !coarse

      // PROSEMIRROR decides what an atom is (isInline && isAtom) — never a CSS class name, which
      // would silently miss a future NodeView.
      const atomEls = new Set<Element>()
      const atomPos = new Map<Element, number>()
      doc.descendants((node, pos) => {
        if (node.isInline && node.isAtom) {
          const el = view.nodeDOM(pos)
          if (el && (el as Node).nodeType === 1) { atomEls.add(el as Element); atomPos.set(el as Element, pos) }
        }
        return true
      })
      const insideAtom = (n: Node): boolean => {
        let cur: Node | null = n
        while (cur) { if (cur.nodeType === 1 && atomEls.has(cur as Element)) return true; cur = cur.parentNode }
        return false
      }

      const starts = new Set<number>()
      const blockStarts = new Set<number>()
      let charsScanned = 0
      const range = document.createRange()

      // REMOVE THE GAPS FROM FLOW so the text wraps naturally, then restore. Synchronous: no
      // ResizeObserver/measure callback can interleave.
      // The height is read BEFORE the widgets are hidden and again after — a natural layout MUST be
      // shorter than a gapped one. If that delta is ~0 the gaps never left flow and every number
      // below was measured in the gapped fiction again. Order matters: this is the reflow proof.
      const pmEl = view.dom as HTMLElement
      const gappedH = pmEl.getBoundingClientRect().height
      const killer = document.createElement('style')
      killer.textContent = '.inkwave-page-gap{display:none !important}'
      document.head.appendChild(killer)
      let naturalH = 0
      try {
        naturalH = pmEl.getBoundingClientRect().height // forces the reflow
        doc.forEach((_child, offset) => {
          const el = view.nodeDOM(offset) as HTMLElement | null
          if (!el || el.nodeType !== 1) return
          starts.add(offset); blockStarts.add(offset)
          try { const p = view.posAtDOM(el, 0); if (p >= 0) starts.add(p) } catch { /* unmapped */ }
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode: (n: Node) => {
              if (n.nodeType === 1) return atomEls.has(n as Element) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
              return insideAtom(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
            },
          })
          let lastTop: number | null = null
          let n: Node | null = null
          const vote = (r: DOMRect, at: () => number, kind: string, txt?: string) => {
            if (r.width === 0 && r.height === 0) return // collapsed whitespace — no box, no vote
            charsScanned++
            const isNew = lastTop === null || r.top - lastTop > 3
            let p = -1
            try { p = at() } catch { /* unmapped */ }
            if (debugNear !== undefined && p >= 0 && Math.abs(p - debugNear) <= 14) {
              trace.push({ pos: p, kind, txt, top: +r.top.toFixed(2), h: +r.height.toFixed(2), left: +r.left.toFixed(2), lastTop: lastTop === null ? null : +lastTop.toFixed(2), votedNewLine: isNew })
            }
            if (isNew) { lastTop = r.top; if (p >= 0) starts.add(p) }
          }
          while ((n = walker.nextNode())) {
            if (n.nodeType === 1) { // an inline atom: ONE box, and the doc pos in front of it
              const el2 = n as Element
              vote(el2.getBoundingClientRect(), () => atomPos.get(el2) ?? -1, 'ATOM', (el2.textContent || '').slice(0, 16))
              continue
            }
            const text = n.nodeValue || ''
            for (let i = 0; i < text.length; i++) {
              range.setStart(n, i); range.setEnd(n, i + 1)
              const tnode = n
              vote(range.getBoundingClientRect(), () => view.posAtDOM(tnode, i), 'text', JSON.stringify(text[i]))
            }
          }
        })
      } finally { killer.remove() }

      const sorted = Array.from(starts).sort((a, b) => a - b)
      const bad = breaks
        .filter((p) => !starts.has(p))
        .map((p) => {
          let before = -1, after = -1
          for (const s of sorted) { if (s < p) before = s; else if (after < 0 && s > p) { after = s; break } }
          const slice = (a: number, b: number) => {
            try { return doc.textBetween(Math.max(0, a), Math.min(doc.content.size, b), '\u00b6', '\u2022') } catch { return '?' }
          }
          const $p = (() => { try { return doc.resolve(p) } catch { return null } })()
          return {
            at: p, prevLineStart: before, nextLineStart: after,
            before20: JSON.stringify(slice(p - 20, p)),
            after20: JSON.stringify(slice(p, p + 20)),
            parent: $p?.parent.type.name ?? '?',
            nodeBefore: $p?.nodeBefore?.type.name ?? null,
            nodeAfter: $p?.nodeAfter?.type.name ?? null,
            atomAdjacent: !!($p?.nodeBefore?.isAtom || $p?.nodeAfter?.isAtom),
          }
        })
      return {
        breaks: breaks.length,
        midline: bad.length,
        lineStarts: sorted.length,
        blockStarts: blockStarts.size,
        charsScanned,
        atoms: atomEls.size,
        // The reflow proof: gapped height MUST exceed natural height, or the gaps never left flow.
        gappedH: +gappedH.toFixed(1),
        naturalH: +naturalH.toFixed(1),
        gapsLeftFlow: gappedH - naturalH > 100,
        // Read `midline` ONLY when this is true (see above) — otherwise the number is the question's
        // artifact, not the code's verdict.
        renderingIsCanonical, baseFont, coarse,
        offenders: bad.slice(0, 12),
        trace,
      }
    },

    // ── THE LINE OVER-COUNT AUDIT ────────────────────────────────────────────────────────────
    // The mid-line rate only fires when a page break HAPPENS to land on a phantom line, so it is a
    // poor instrument for a NodeView that is rare in the doc: inline math measured 0 mid-line breaks
    // even UNFIXED, which says "no break landed there", not "no bug". The ARTIFACT itself is the
    // phantom line, so measure THAT directly and per block: how many lines does the rect path report
    // versus how many the block really has?
    //   • truth  — line starts from the validated char/atom walk (the same rule midlineAudit uses);
    //   • old    — keepLineRects(whole-block range rects): descends into NodeViews ⇒ over-counts;
    //   • fixed  — keepLineRects(blockLineRects(...)): atoms collapsed to one box each.
    // Both paths call the REAL production functions, not copies. Gaps are removed from flow first
    // (a gap widget splits a block's rects and would corrupt every count).
    lineCountAudit() {
      const view = editor.view
      const doc = view.state.doc
      const atomEls = new Set<Element>()
      doc.descendants((node, pos) => {
        if (node.isInline && node.isAtom) {
          const el = view.nodeDOM(pos)
          if (el && (el as Node).nodeType === 1) atomEls.add(el as Element)
        }
        return true
      })
      const insideAtom = (n: Node): boolean => {
        let cur: Node | null = n
        while (cur) { if (cur.nodeType === 1 && atomEls.has(cur as Element)) return true; cur = cur.parentNode }
        return false
      }
      const pmEl = view.dom as HTMLElement
      const gappedH = pmEl.getBoundingClientRect().height
      const killer = document.createElement('style')
      killer.textContent = '.inkwave-page-gap{display:none !important}'
      document.head.appendChild(killer)
      let naturalH = 0
      const rows: Array<Record<string, unknown>> = []
      try {
        naturalH = pmEl.getBoundingClientRect().height
        const range = document.createRange()
        doc.forEach((child, offset) => {
          const el = view.nodeDOM(offset) as HTMLElement | null
          if (!el || el.nodeType !== 1) return
          const atoms: Element[] = []
          child.descendants((node, pos) => {
            if (!node.isInline || !node.isAtom) return true
            const a = view.nodeDOM(offset + 1 + pos)
            if (a && (a as Node).nodeType === 1) atoms.push(a as Element)
            return false
          })
          // TRUTH: distinct line boxes, from real text + each atom as one unit.
          let truth = 0, lastTop: number | null = null
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode: (n: Node) => {
              if (n.nodeType === 1) return atomEls.has(n as Element) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
              return insideAtom(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
            },
          })
          let n: Node | null = null
          const tally = (r: DOMRect) => {
            if (r.width === 0 && r.height === 0) return
            if (lastTop === null || r.top - lastTop > 3) { lastTop = r.top; truth++ }
          }
          while ((n = walker.nextNode())) {
            if (n.nodeType === 1) { tally((n as Element).getBoundingClientRect()); continue }
            const text = n.nodeValue || ''
            for (let i = 0; i < text.length; i++) { range.setStart(n, i); range.setEnd(n, i + 1); tally(range.getBoundingClientRect()) }
          }
          range.selectNodeContents(el)
          const oldLines = keepLineRects(Array.from(range.getClientRects()), 1).length
          const fixedLines = keepLineRects(blockLineRects(el, atoms), 1).length
          if (!truth) return // an empty block — no lines to over-count
          rows.push({ i: rows.length, type: child.type.name, atoms: atoms.length, truth, oldLines, fixedLines })
        })
      } finally { killer.remove() }
      const over = (k: string) => rows.filter((r) => (r[k] as number) > (r.truth as number))
      return {
        blocks: rows.length,
        gapsLeftFlow: gappedH - naturalH > 100,
        atomBlocks: rows.filter((r) => (r.atoms as number) > 0).length,
        // THE HEADLINE: blocks whose line count the rect path gets WRONG, before and after.
        oldOverCounted: over('oldLines').length,
        fixedOverCounted: over('fixedLines').length,
        oldExtraLines: rows.reduce((a, r) => a + Math.max(0, (r.oldLines as number) - (r.truth as number)), 0),
        fixedExtraLines: rows.reduce((a, r) => a + Math.max(0, (r.fixedLines as number) - (r.truth as number)), 0),
        worstOld: over('oldLines').slice(0, 6),
        worstFixed: over('fixedLines').slice(0, 6),
      }
    },

    // ── BASELINE A: the real bake (what a text render would DELETE) ──
    async bake(selector, scale) {
      const el = document.querySelector(selector) as HTMLElement | null
      if (!el) return { error: `no element for ${selector}` }
      const t0 = performance.now()
      const res = await captureRegion(el, scale)
      const ms = performance.now() - t0
      // On SUCCESS captureRegion returns {bitmap, canvas:null} (the ImageBitmap is the fast path) —
      // checking `res.canvas` would read every success as a failure. Null is the only real failure.
      if (!res) return { ms, failed: true }
      const bytes = res.bytes
      if (res.bitmap) res.bitmap.close()
      return { ms, w: res.width, h: res.height, bytes, via: res.bitmap ? 'bitmap' : 'canvas' }
    },

    // ── BASELINE B: the real present path (encode is the bake tail; decode+blit is the show) ──
    // Same knobs as snapThumbs: 0.5× downscale, WebP q0.7.
    async thumbRoundTrip(canvas, scale) {
      const w = Math.max(1, Math.round(canvas.width * scale))
      const h = Math.max(1, Math.round(canvas.height * scale))
      const t0 = performance.now()
      const oc = new OffscreenCanvas(w, h)
      const octx = oc.getContext('2d')
      if (!octx) return { error: 'no offscreen ctx' }
      octx.drawImage(canvas, 0, 0, w, h)
      const blob = await oc.convertToBlob({ type: 'image/webp', quality: 0.7 })
      const tEncode = performance.now() - t0
      const t1 = performance.now()
      const bmp = await createImageBitmap(blob)
      const tDecode = performance.now() - t1
      const t2 = performance.now()
      const dest = document.createElement('canvas')
      dest.width = canvas.width; dest.height = canvas.height
      dest.getContext('2d')?.drawImage(bmp, 0, 0, dest.width, dest.height)
      const tBlit = performance.now() - t2
      bmp.close()
      return { encodeMs: tEncode, decodeMs: tDecode, blitMs: tBlit, bytes: blob.size, w, h }
    },

    // ── COVERAGE: the question that decides whether any of this is usable ────────────────────
    // A preview that placeholders out most of a real thesis is not a preview. This reports the
    // block census by kind + the coverage map's DEFER REASONS, plus the citeBox counters so a
    // collapse can be attributed (engine limitation vs a cold/mis-keyed cache) instead of guessed.
    coverage() {
      const harvest = harvestNow()
      const g = liveGeom()
      const model = buildRenderModel(editor.state.doc, g, measure, fontLoaded, buildOpts())
      const byType: Record<string, number> = {}
      let citations = 0
      editor.state.doc.forEach((n) => { byType[n.type.name] = (byType[n.type.name] ?? 0) + 1 })
      editor.state.doc.descendants((n) => { if (n.type.name === 'citation') citations++; return true })
      const text = model.blocks.filter((b) => b.kind === 'text').length
      const placeholder = model.blocks.filter((b) => b.kind === 'placeholder').length
      const citeDbg = (window as unknown as { __iwCiteBox?: Record<string, number> }).__iwCiteBox ?? {}
      return {
        blocks: model.blocks.length, rendered: text, placeholdered: placeholder,
        renderedPct: +((text / Math.max(1, model.blocks.length)) * 100).toFixed(1),
        docBlockTypes: byType, citationNodes: citations,
        coverageReasons: model.coverage,
        citeBox: { ...citeDbg },
        blockStyles: { ...((window as unknown as { __iwBlockStyles?: Record<string, unknown> }).__iwBlockStyles ?? {}) },
        harvest,
        key: buildOpts(),
        pages: model.pages,
        breaksReliable: model.breaksReliable,
        reliablePages: model.reliablePages,
        firstEstimatedPos: model.firstEstimatedPos,
        firstEstimatedType: model.blocks.find((b) => b.estimated)?.type ?? null,
        estimatedBlocks: model.estimatedBlocks,
      }
    },

    // ── BLOCK GEOMETRY vs the REAL DOM ───────────────────────────────────────────────────────
    // "Breaks diverge" is a symptom, not a diagnosis: the break is just where accumulated height
    // crosses the text area, so ANY block being a few px wrong moves it. This compares EVERY
    // top-level block's computed top/height against its real rendered element, so the culprit is
    // named rather than guessed. Only meaningful in the canonical context (asserted by harvestNow).
    blockGeoCheck() {
      const harvest = harvestNow()
      const g = liveGeom()
      const model = buildRenderModel(editor.state.doc, g, measure, fontLoaded, buildOpts())
      const pm = document.querySelector('.ProseMirror') as HTMLElement | null
      if (!pm) return { error: 'no .ProseMirror' }
      // Page-gap widgets inject height into the live flow; compare against a doc with gaps CLEARED
      // is impossible here, so compare block HEIGHTS only (gap-independent) plus the delta each
      // block contributes, and report the first block whose height disagrees.
      const rows: Array<Record<string, unknown>> = []
      let i = 0
      editor.state.doc.forEach((node, offset) => {
        const el = editor.view.nodeDOM(offset) as HTMLElement | null
        const b = model.blocks[i++]
        if (!el || el.nodeType !== 1 || !b) return
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const domH = r.height
        const dH = b.height - domH
        rows.push({
          i: i - 1, type: node.type.name, offset,
          mineH: +b.height.toFixed(2), domH: +domH.toFixed(2), dH: +dH.toFixed(2),
          mineKind: b.kind,
          domMarginTop: cs.marginTop, domMarginBottom: cs.marginBottom, domFont: cs.fontSize, domLH: cs.lineHeight,
        })
      })
      const bad = rows.filter((r) => Math.abs(r.dH as number) > 0.5)
      return {
        harvest, blocks: rows.length, mismatched: bad.length,
        worst: bad.sort((a, b) => Math.abs(b.dH as number) - Math.abs(a.dH as number)).slice(0, 8),
        byType: bad.reduce((acc: Record<string, number>, r) => { acc[r.type as string] = (acc[r.type as string] ?? 0) + 1; return acc }, {}),
        sampleOk: rows.filter((r) => Math.abs(r.dH as number) <= 0.5).slice(0, 3),
      }
    },

    // ── MEMORY: what a cached MODEL costs vs a cached BITMAP ─────────────────────────────────
    // The bitmap pool holds ~62.7MB for 57 bitmaps because a bitmap is W×H×4 bytes no matter how
    // little ink is on it. A render model holds geometry + the segment strings instead. This builds
    // N independent models and reports the heap delta.
    // performance.memory is COARSE (quantised, GC-dependent), so this is an order-of-magnitude
    // reading, not a precise one — it is reported as such. A structural count is included alongside
    // so the estimate can be sanity-checked against something that isn't the GC's opinion.
    modelMem(n) {
      const mem = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
      const g = liveGeom()
      const models: RenderModel[] = []
      // Settle the heap first so the delta isn't dominated by unrelated garbage.
      const before = mem()
      const t0 = performance.now()
      for (let i = 0; i < n; i++) models.push(buildRenderModel(editor.state.doc, g, makeCanvasMeasure(), fontLoaded, buildOpts()))
      const after = mem()
      const ms = performance.now() - t0
      let lines = 0, segs = 0, chars = 0
      for (const m of models) {
        lines += m.lines.length
        for (const l of m.lines) { segs += l.segs.length; for (const s of l.segs) chars += s.text.length }
      }
      // STRUCTURAL CROSS-CHECK. performance.memory is quantised to 10MB buckets unless Chromium is
      // launched with --enable-precise-memory-info — without it a few-MB delta reads as exactly 0,
      // which looks like "free" rather than "not measured". So an independent structural estimate
      // rides alongside: UTF-16 chars + rough per-object overhead. If the two disagree wildly, don't
      // believe either.
      const structuralBytesEst = Math.round((chars * 2 + segs * 64 + lines * 96) / Math.max(1, n))
      return {
        n, heapDeltaBytes: after - before, perModelBytes: Math.round((after - before) / Math.max(1, n)),
        structuralBytesEst,
        precise: (after - before) !== 0 && (after % 1000000 !== 0),
        buildMsTotal: +ms.toFixed(1), lines, segs, chars,
        note: 'heap needs --enable-precise-memory-info; structuralBytesEst is the independent check',
        pages: models[0]?.pages ?? 0,
        // What ONE page bitmap costs at this DPR, for the like-for-like comparison.
        onePageBitmapBytes: Math.round(g.pageWidthPx * window.devicePixelRatio) * Math.round(g.pageHeightPx * window.devicePixelRatio) * 4,
      }
    },

    // ── OPFS BREAK-TABLE ROUND TRIP ──────────────────────────────────────────────────────────
    tableSig() {
      harvestNow()
      return contextSig(liveGeom(), getCitationStyle(), bibSignature(), 'probe')
    },

    async tableWrite(docId, versions) {
      harvestNow()
      const g = liveGeom()
      const sig = contextSig(g, getCitationStyle(), bibSignature(), 'probe')
      const doc = editor.state.doc
      const t0 = performance.now()
      for (let v = 0; v < versions; v++) {
        // Distinct snapId per version. The SAME doc stands in for each — honest for the STORE's
        // shape (bytes, eviction, round trip), which is what this proves; it is NOT a claim about
        // per-version content, and reuse is not being measured here.
        putTable(docId, `snap-${String(v).padStart(3, '0')}`, buildBreakTable(doc, g, measure, fontLoaded, buildOpts(), sig))
      }
      const buildMs = performance.now() - t0
      const p0 = performance.now()
      await persist(docId) // AWAITED — never race the 1500ms debounce in a probe
      return { versions, buildMs: +buildMs.toFixed(1), persistMs: +(performance.now() - p0).toFixed(1), sig, stats: tableStats(docId) }
    },

    async tableLoad(docId) {
      const t0 = performance.now()
      await loadTables(docId)
      return { loadMs: +(performance.now() - t0).toFixed(1), stats: tableStats(docId) }
    },

    tableGet(docId, snapId) {
      harvestNow()
      const sig = contextSig(liveGeom(), getCitationStyle(), bibSignature(), 'probe')
      const t = getTable(docId, snapId, sig)
      return { hit: !!t, pages: t?.pages ?? 0, starts: t?.starts.length ?? 0, firstStarts: t?.starts.slice(0, 4) ?? [], sig }
    },

    // THE NEGATIVE. A signature mismatch MUST return null and be COUNTED as stale. If this ever
    // returns a table, hydration is reusing a pagination from a different canonical context — the
    // failure mode is not a crash, it is the wrong words on the page, reported as success.
    tableGetStale(docId, snapId) {
      harvestNow()
      const real = contextSig(liveGeom(), getCitationStyle(), bibSignature(), 'probe')
      const wrong = real + '|MUTATED'
      const before = tableStats(docId).stale
      const t = getTable(docId, snapId, wrong)
      const after = tableStats(docId).stale
      return { reused: !!t, staleCounted: after - before, realSig: real, wrongSig: wrong }
    },

    tailProof() {
      harvestNow()
      const g = liveGeom()
      const doc = editor.state.doc
      const m = buildRenderModel(doc, g, makeCanvasMeasure(), fontLoaded, buildOpts())
      // Per-page line counts. A page with ZERO lines is a page NO doc position can resolve to —
      // pageContainingPos returns pageOfLine[someLine], so a page owning no line is unreachable by
      // construction, no matter how healthy `pages`/`pageTop` look.
      const perPage: number[] = new Array(m.pages).fill(0)
      for (const p of m.pageOfLine) if (p >= 0 && p < m.pages) perPage[p]++
      const emptyPages: number[] = []
      for (let i = 0; i < m.pages; i++) if (perPage[i] === 0) emptyPages.push(i)
      let maxPageOfLine = -1
      for (const p of m.pageOfLine) if (p > maxPageOfLine) maxPageOfLine = p
      let maxPos = -1
      for (const l of m.lines) if (l.pos > maxPos) maxPos = l.pos
      // Is pos monotonic? pageContainingPos BINARY-SEARCHES it; if it is not sorted the search is
      // meaningless and would fail in exactly this quiet way.
      let nonMonotonic = 0, firstNonMono = -1
      for (let i = 1; i < m.lines.length; i++) {
        if (m.lines[i].pos < m.lines[i - 1].pos) { nonMonotonic++; if (firstNonMono < 0) firstNonMono = i }
      }
      const tailLines = m.lines.slice(-8).map((l, k) => ({
        i: m.lines.length - 8 + k, pos: l.pos, top: Math.round(l.top),
        blockIdx: l.blockIdx, page: m.pageOfLine[m.lines.length - 8 + k],
      }))
      const tailBlocks = m.blocks.slice(-6).map((b) => ({
        type: b.type, kind: b.kind, start: b.start, end: b.end,
        top: Math.round(b.top), height: Math.round(b.height), estimated: !!b.estimated,
      }))
      const contentSize = doc.content.size
      const cands: Record<string, unknown>[] = []
      for (const [name, pos] of [
        ['content.size - 2 (the probe used this)', contentSize - 2],
        ['content.size - 1', contentSize - 1],
        ['content.size', contentSize],
        ['maxLinePos (the last line start)', maxPos],
      ] as Array<[string, number]>) {
        cands.push({ name, pos, page: pageContainingPos(m, pos) })
      }
      return {
        pages: m.pages, maxPageOfLine, pageTopLen: m.pageTop.length, lines: m.lines.length,
        blocks: m.blocks.length, contentSize, maxLinePos: maxPos,
        // The three checks that PASS — reported here so it is visible they cannot see this.
        maxPageOfLineIsLast: maxPageOfLine === m.pages - 1,
        pageTopLenEqualsPages: m.pageTop.length === m.pages,
        posIsMonotonic: nonMonotonic === 0, nonMonotonic, firstNonMono,
        emptyPages, emptyPageCount: emptyPages.length,
        perPageTail: perPage.slice(-6),
        estimatedBlocks: m.estimatedBlocks, reliablePages: m.reliablePages, breaksReliable: m.breaksReliable,
        tailBlocks, tailLines, candidates: cands,
      }
    },

    tableStats(docId) { return tableStats(docId) },

    tableForgetMemory() { _resetTables() },

    // ── WHOLE-DOCUMENT + MEMORY AT SESSION SCALE ─────────────────────────────────────────────
    // Peter: "I wanna make sure we sweep and load the whole document." A bitmap cache can only hold
    // a window; a model is whole-document by construction. This proves BOTH halves of that claim
    // rather than asserting it: (a) every cached version has an origin for EVERY page (a short
    // pageTop array = pages that render blank — the exact bug the first pixel diff caught), and
    // (b) what N versions actually cost, with eviction NAMED when coverage gets bounded.
    storeProof(versions, touch) {
      harvestNow()
      const g = liveGeom()
      const store = new TextRenderStore(touch)
      const doc = editor.state.doc
      const geomSig = `${g.pageWidthPx}x${g.pageHeightPx}|${g.basePx}|${g.ratio}|${g.sideMarginPx}`
      const mem = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
      const before = mem()
      const t0 = performance.now()
      const cov: Array<Record<string, unknown>> = []
      for (let v = 0; v < versions; v++) {
        // Distinct snapId per "version" — the same doc stands in for a version's content, which is
        // honest for MEMORY and PAGE-SPAN (both scale with doc size, not with what changed).
        store.get(`v${v}`, () => doc, g, geomSig, fontLoaded, buildOpts())
      }
      const ms = performance.now() - t0
      const after = mem()
      let whole = 0, notWhole = 0, unreliable = 0
      for (let v = 0; v < versions; v++) {
        const c = store.coverageOf(`v${v}`)
        if (!c || !c.cached) continue
        if (c.whole) whole++; else { notWhole++; cov.push({ v, ...c }) }
        if (!c.reliable) unreliable++
      }
      // THE REFERENCE MODEL MUST BE ONE THAT SURVIVED (fixed 2026-07-17). This read `coverageOf('v0')`
      // — and the LRU evicts the OLDEST first, so v0 is the FIRST casualty at any n that overflows the
      // budget. At n=116 it reported `pagesPerVersion: 0` and `lastPageReachableByContent: false`:
      // both read exactly like the whole-document claim COLLAPSING, when the truth was that the probe
      // asked an evicted key. A probe that reports a scary zero because it queried something it threw
      // away is this project's signature failure — fourteen times over. Ask the MOST-RECENTLY-USED
      // version, which the LRU guarantees is resident, and VOID loudly if somehow nothing survived.
      const refId = `v${versions - 1}`
      const m0 = store.coverageOf(refId)
      const refResident = !!m0?.cached
      // The LEAN trade, measured on the same models: geometry-only (segments re-sliced from the doc
      // at paint time) vs the current fat model that duplicates the text.
      const probe0 = buildRenderModel(doc, g, measure, fontLoaded, buildOpts())
      const leanPer = TextRenderStore.leanBytes(probe0)
      // The content-anchored seam: the LAST page must be reachable by CONTENT, not page number —
      // if the model only covered a window, a far position would clamp to the window's edge.
      //
      // ASK THE LAST BLOCK'S OWN POSITION, derived from the DOC (2026-07-17). `doc.content.size - 2`
      // was wrong whenever the document ends in a LEAF ATOM (`nodeSize === 1` — a refList, a
      // mathBlock): the atom occupies [size-1, size), so size-2 is inside the SECOND-TO-LAST block
      // and resolves, correctly, to the second-to-last page. The assertion then read as "the last
      // page is unreachable" when the probe had simply asked about a different page. It ALSO masked
      // a real model bug underneath (a leaf atom's line claimed `offset + 1` — the position AFTER
      // itself; see blockFirstLinePos in textRender.ts), which is why this was worth chasing rather
      // than silencing: two independent faults, the probe's one hiding the model's.
      const lastChild = doc.lastChild
      const lastPos = lastChild ? doc.content.size - lastChild.nodeSize : Math.max(0, doc.content.size - 1)
      const pageOfLast = store.pageFor(refId, lastPos)
      return {
        versions, cachedModels: store.stats.models, droppedCount: store.stats.dropped.length,
        droppedSample: store.stats.dropped.slice(0, 5),
        bytesEst: store.stats.bytes, budget: store.stats.budget,
        mbEst: +(store.stats.bytes / 1048576).toFixed(2),
        mbPerVersion: +((store.stats.bytes / Math.max(1, store.stats.models)) / 1048576).toFixed(3),
        heapDeltaMB: +((after - before) / 1048576).toFixed(2),
        buildMsTotal: +ms.toFixed(0), buildMsPerVersion: +(ms / versions).toFixed(1),
        // Named for what they are: a reading of ONE resident reference version, not a per-version
        // average. `refId`/`refResident` travel with them so a null can never be read as a zero.
        refId, refResident,
        pagesPerVersion: refResident ? (m0?.pages ?? 0) : null,
        wholeDocVersions: whole, notWholeVersions: notWhole, notWholeSample: cov.slice(0, 3),
        unreliableVersions: unreliable,
        lastPosPage: pageOfLast, lastPageIdx: refResident ? (m0?.pages ?? 1) - 1 : null,
        lastPageReachableByContent: refResident ? pageOfLast === (m0?.pages ?? 1) - 1 : null,
        leanBytesPerVersion: leanPer,
        leanMBPerVersion: +(leanPer / 1048576).toFixed(3),
        leanMBat116: +((leanPer * 116) / 1048576).toFixed(1),
        fatMBat116: +(((store.stats.bytes / Math.max(1, store.stats.models)) * 116) / 1048576).toFixed(1),
      }
    },

    // ── THE CRUX: PREFIX-INDEPENDENT WINDOW LAYOUT ───────────────────────────────────────────
    // Peter: "we only need the plaintext of the precise part of the doc that will be visible at the
    // current zoom." That only works if page N can be laid out WITHOUT laying out pages 0..N-1.
    // Line breaks cascade, so the prefix decides where page N BEGINS — but a break position IS a
    // line start, and greedy wrap restarts deterministically at a line start. So the claim under
    // test is: given the break position, the page's own layout is prefix-independent.
    // TEST: build the full model; then for several pages, cut the doc at that page's break position
    // and lay the REMAINDER out from scratch (no prefix at all). If the first lines of the cut
    // layout match the full model's lines for that page, the claim holds.
    // KNOWN-POSITIVE: a deliberately WRONG cut (2 chars off a line start) must FAIL the same check —
    // otherwise the comparison proves nothing.
    windowProof() {
      harvestNow()
      const g = liveGeom()
      const doc = editor.state.doc
      const full = buildRenderModel(doc, g, measure, fontLoaded, buildOpts())

      // Lay out the tail from `cutAt` with NO prefix knowledge, and score its first `n` line starts
      // against the full model's page-`pageIdx` line starts, mapped back to ORIGINAL doc positions.
      // origOf(tailPos) = tailPos + cutAt - 1  (the tail's first content pos is 1, and it IS cutAt).
      // THE OLD BUG: cutAt was `at - 1` and `want` used `pos - cutAt + 1`, so line 0 mismatched
      // ALWAYS — 29/30 was 30/30 plus my own off-by-one.
      const cmp = (cutAt: number, pageIdx: number) => {
        const tail = doc.cut(cutAt)
        const t0 = performance.now()
        const m = buildRenderModel(tail, g, measure, fontLoaded, buildOpts())
        const ms = performance.now() - t0
        const want = full.lines.filter((_, i) => full.pageOfLine[i] === pageIdx).map((l) => l.pos)
        const got = m.lines.map((l) => l.pos + cutAt - 1) // rebase to original positions
        const n = Math.min(got.length, want.length)
        let match = 0
        for (let i = 0; i < n; i++) if (got[i] === want[i]) match++
        return { cutAt, pageIdx, compared: n, match, exact: n > 0 && match === n, tailBuildMs: +ms.toFixed(1), firstGot: got[0], firstWant: want[0] }
      }

      const pages = [1, 2, 3].filter((p) => p < full.pages)
      const results = pages.map((p) => {
        const at = anchorPosOfPage(full, p)
        const good = cmp(at, p)
        // DISCRIMINATING NEGATIVES. A 2-char-off cut is NOT one: dropping 2 chars from the first
        // word leaves every LATER line starting at the same original position, so it scored
        // identically to the correct cut and the test had no resolution. A MID-LINE cut is the real
        // negative — the tail's first line then pulls words up from the next line and the wrap
        // cascades, so every subsequent line start moves.
        const negs = [at + 40, at + 80, at + 25].map((c) => cmp(c, p))
        return {
          pageIdx: p, at, good,
          negs: negs.map((nn) => ({ cutAt: nn.cutAt, match: nn.match, compared: nn.compared })),
          // THE GATE: the correct cut must STRICTLY beat every negative.
          strictlyBeatsAllNegatives: negs.every((nn) => good.match > nn.match),
        }
      })

      // ── lastPageReachableByContent, instrumented rather than left as a footnote ──
      let maxPage = -1
      for (const p of full.pageOfLine) if (p > maxPage) maxPage = p
      const lastLine = full.lines[full.lines.length - 1]
      const lastPos = doc.content.size - 2
      const lastBlock = full.blocks[full.blocks.length - 1]
      const anchorProbe = {
        docContentSize: doc.content.size, lastPosProbed: lastPos,
        lastLinePos: lastLine?.pos ?? null, lastLinePage: lastLine ? full.pageOfLine[full.lines.length - 1] : null,
        lastBlockType: lastBlock?.type ?? null, lastBlockStart: lastBlock?.start ?? null, lastBlockEnd: lastBlock?.end ?? null,
        modelPages: full.pages, maxPageOfLine: maxPage, pageTopLen: full.pageTop.length,
        pagesAgreesWithWalk: full.pages === maxPage + 1,
        pageForLastPos: pageContainingPos(full, lastPos),
        pageForLastLinePos: lastLine ? pageContainingPos(full, lastLine.pos) : null,
      }

      return {
        pages: full.pages, tested: results,
        allExact: results.length > 0 && results.every((r) => r.good.exact),
        allStrictlyBeatNegatives: results.length > 0 && results.every((r) => r.strictlyBeatsAllNegatives),
        anchorProbe,
      }
    },

    // ── WINDOW MODE, AS BUILT ────────────────────────────────────────────────────────────────
    // Two claims, both measured, neither assumed:
    //  (1) EXACT — the window's line starts equal the full model's for that page (known-positive),
    //      and mid-line cuts score STRICTLY worse (a negative that cannot fail is not a negative).
    //  (2) O(WINDOW) — the cost must NOT scale with document size. The crux test laid out the whole
    //      TAIL (57-60ms at 40k); if this shows the same curve, the early stop does not work and the
    //      "1-2ms" claim is fiction.
    windowCost() {
      harvestNow()
      const g = liveGeom()
      const doc = editor.state.doc
      const t0 = performance.now()
      const full = buildRenderModel(doc, g, measure, fontLoaded, buildOpts())
      const fullMs = performance.now() - t0
      const textArea = g.pageHeightPx - g.topMarginPx - 72
      const winOpts = (from: number) => ({ ...buildOpts(), from, maxHeight: textArea })

      const rows: Array<Record<string, unknown>> = []
      const pages = [1, 2, 3, 4, 5].filter((p) => p < full.pages)
      for (const p of pages) {
        const at = anchorPosOfPage(full, p)
        const want = full.lines.filter((_, i) => full.pageOfLine[i] === p).map((l) => l.pos)
        // Warm the measure cache the way a real second render would be, then time it.
        buildRenderModel(doc, g, measure, fontLoaded, winOpts(at))
        const t1 = performance.now()
        const w = buildRenderModel(doc, g, measure, fontLoaded, winOpts(at))
        const ms = performance.now() - t1
        const got = w.lines.map((l) => l.pos)
        const n = Math.min(got.length, want.length)
        let match = 0
        for (let i = 0; i < n; i++) if (got[i] === want[i]) match++
        // DISCRIMINATING NEGATIVES: mid-line cuts force the wrap to cascade.
        const negs = [at + 25, at + 40, at + 80].map((c) => {
          const nw = buildRenderModel(doc, g, measure, fontLoaded, winOpts(c))
          const ng = nw.lines.map((l) => l.pos)
          let nm = 0
          for (let i = 0; i < Math.min(ng.length, want.length); i++) if (ng[i] === want[i]) nm++
          return { off: c - at, match: nm }
        })
        rows.push({
          page: p, at, windowMs: +ms.toFixed(2), linesLaidOut: w.lines.length, pageLines: want.length,
          compared: n, match, exact: n > 0 && match === n && got.length >= want.length,
          negs, strictlyBeatsAll: negs.every((nn) => match > nn.match),
        })
      }
      const times = rows.map((r) => r.windowMs as number).sort((a, b) => a - b)
      return {
        docPages: full.pages, fullBuildMs: +fullMs.toFixed(1),
        windowP50: times[Math.floor(times.length / 2)] ?? null,
        windowMax: times[times.length - 1] ?? null,
        allExact: rows.length > 0 && rows.every((r) => r.exact),
        allStrictlyBeatNegatives: rows.length > 0 && rows.every((r) => r.strictlyBeatsAll),
        rows,
      }
    },

    // ── BREAK TABLE: size, cost, and PORTABILITY VERIFIED (not assumed) ──────────────────────
    // Canonical pagination claims breaks are device- and zoom-independent. That claim is what makes
    // a table PORTABLE (bake once, valid at any zoom, across reloads) and it is why zoom is absent
    // from contextSig. The codebase asserting it is not evidence, so: build the table, then rebuild
    // it under DIFFERENT zoom/DPR conditions and require the starts to be byte-identical.
    // KNOWN-NEGATIVE: a genuinely different context (a changed side margin, which really does move
    // the breaks) MUST produce a different table — otherwise this comparison cannot fail and proves
    // nothing.
    tableProof() {
      harvestNow()
      const g = liveGeom()
      const doc = editor.state.doc
      const sig = contextSig(g, getCitationStyle(), bibSignature(), 'probe')
      const t0 = performance.now()
      const table = buildBreakTable(doc, g, measure, fontLoaded, buildOpts(), sig)
      const buildMs = performance.now() - t0

      // PORTABILITY: the geometry the table is built in is CANONICAL by construction (basePx 18,
      // ratio φ, mm page). Zoom/DPR are render-time transforms that never enter it — rebuild under a
      // fresh measure and confirm byte-identical starts.
      const t2 = buildBreakTable(doc, g, makeCanvasMeasure(), fontLoaded, buildOpts(), sig)
      const portable = t2.starts.length === table.starts.length && t2.starts.every((v, i) => v === table.starts[i])

      // KNOWN-NEGATIVE: a REAL context change (narrower column) must move the breaks.
      const g2: RenderGeom = { ...g, sideMarginPx: g.sideMarginPx + 40, contentWidthPx: g.contentWidthPx - 80 }
      const t3 = buildBreakTable(doc, g2, measure, fontLoaded, buildOpts(), contextSig(g2, getCitationStyle(), bibSignature(), 'probe'))
      const negativeMoves = !(t3.starts.length === table.starts.length && t3.starts.every((v, i) => v === table.starts[i]))

      // The table must agree with the model it came from.
      const full = buildRenderModel(doc, g, measure, fontLoaded, buildOpts())
      let agree = true
      for (let p = 0; p < table.pages; p++) if (pageStart(table, p) !== anchorPosOfPage(full, p)) { agree = false; break }

      const json = JSON.stringify(table)
      return {
        pages: table.pages, reliable: table.reliable,
        buildMs: +buildMs.toFixed(1),
        bytesJson: json.length, bytesPerPage: +(json.length / table.pages).toFixed(1),
        kbPerVersion: +(json.length / 1024).toFixed(2),
        kbAt116Versions: +((json.length * 116) / 1024).toFixed(1),
        portableAcrossRebuild: portable,
        seesKnownNegative: negativeMoves, // a real context change DOES move the table
        agreesWithModel: agree,
        pageOfMidDoc: pageOfPos(table, Math.floor(doc.content.size / 2)),
      }
    },

    // ── THE KNOWN-POSITIVE GATE ──────────────────────────────────────────────────────────────
    // "Measure X, compare to Y, report" is exactly the shape that failed silently before. So before
    // any null result is believed, assert the instrument can SEE a known-positive:
    //   • fonts really loaded (not the system fallback measuring against itself),
    //   • the measure actually discriminates (two different strings ⇒ different widths),
    //   • an INJECTED wrap error really moves the output (a 5% advance inflation must change the
    //     line count — if it doesn't, the comparison is blind and nothing it reports means anything).
    selfTest() {
      const g = liveGeom()
      const base = buildRenderModel(editor.state.doc, g, measure, fontLoaded, buildOpts())
      // Inflate every advance 5% — the model MUST get more lines. If it doesn't, the probe is blind.
      const inflated: Measure = (t, f) => measure(t, f) * 1.05
      const mutated = buildRenderModel(editor.state.doc, g, inflated, fontLoaded, buildOpts())
      const ebg = "'EB Garamond', Georgia, serif"
      return {
        fontsReallyLoaded: fontLoaded(ebg, 18),
        // document.fonts.check alone is the TRAP — report both so a divergence is visible.
        fontsCheckSays: (() => { try { return document.fonts.check(`18px ${ebg}`) } catch { return null } })(),
        measureDiscriminates: measure('iiii', `400 18px ${ebg}`) !== measure('WWWW', `400 18px ${ebg}`),
        baseLines: base.lines.length,
        inflatedLines: mutated.lines.length,
        // THE gate: a 5% wrap error must be visible in the output.
        seesKnownPositive: mutated.lines.length > base.lines.length,
        basePages: base.pages,
        inflatedPages: mutated.pages,
        coverage: base.coverage,
      }
    },
    schemaIdentity() {
      // ONE description of "same schema", shared with the gate-kept unit test — see schemaSpec's
      // header. Two copies is how one instrument starts certifying a fiction.
      const mine = getEditorSchema()
      const live = editor.schema
      const mineSpec = schemaSpec(mine)
      const liveSpec = schemaSpec(live)

      // Name the first divergence rather than reporting a bare false — a boolean cannot be acted on.
      const diffs: string[] = []
      const a = JSON.parse(mineSpec) as { nodes: Record<string, unknown>; marks: Record<string, unknown> }
      const b = JSON.parse(liveSpec) as { nodes: Record<string, unknown>; marks: Record<string, unknown> }
      for (const kind of ['nodes', 'marks'] as const) {
        const keys = new Set([...Object.keys(a[kind]), ...Object.keys(b[kind])])
        for (const k of keys) {
          const x = JSON.stringify(a[kind][k]), y = JSON.stringify(b[kind][k])
          if (x !== y) diffs.push(`${kind}.${k}: mine=${x ?? 'MISSING'} live=${y ?? 'MISSING'}`)
        }
      }

      // THE DOCUMENT-LEVEL CHECK — and the trap it walked into first (2026-07-17).
      //
      // The obvious instrument is `Node.fromJSON(mine, liveDoc.toJSON()).eq(liveDoc)`. IT CAN NEVER
      // RETURN TRUE. PM's `hasMarkup` is `this.type == type` — REFERENCE equality on NodeType — so
      // two Schema instances (which is the entire premise here) always compare unequal, whatever the
      // content. It reported `false` for the UNTOUCHED live document: a check structurally incapable
      // of passing, i.e. one that would have condemned a perfectly correct schema. It was caught
      // ONLY because the known-negative reads its positive arm too (clean must still say yes).
      // Same family as canvasShapingMatchesEditor, the gate that always returned false and silently
      // disabled arithLayout for months.
      //
      // The correct cross-schema comparison is STRUCTURAL: type NAMES, attrs, marks and text — i.e.
      // the serialised form, which is schema-independent by construction and is also exactly what a
      // snapshot's contentJson IS. Compared with a key-stable serialiser so attr enumeration order
      // can never masquerade as a difference.
      const liveDoc = editor.state.doc
      const liveJson0 = liveDoc.toJSON()
      const reparsed = nodeFromContentJson(liveJson0)
      const stable = (v: unknown): string => {
        if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
        if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
        const o = v as Record<string, unknown>
        return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
      }
      const sameDoc = (a: unknown, b: unknown) => stable(a) === stable(b)
      const census = { citation: 0, mathInline: 0, mathBlock: 0, referenceList: 0, heading: 0, marks: 0 }
      liveDoc.descendants((n) => {
        if (n.type.name in census) (census as Record<string, number>)[n.type.name]++
        census.marks += n.marks.length
        return true
      })

      // Material for the known-negative, built HERE so it mutates a REAL attribute of a REAL node
      // of THIS document (an invented attr would be silently dropped and the negative would not
      // fire — the trap pinned in editorSchema.test.ts).
      const liveJson = liveJson0
      const mutatedJson = JSON.parse(JSON.stringify(liveJson)) as { content?: unknown[] }
      let mutationApplied = false
      const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
        if (n.type === 'citation' && !mutationApplied) {
          n.attrs = { ...n.attrs, citekeys: ['MUTATED-BY-THE-NEGATIVE'] }
          mutationApplied = true
        }
        if (Array.isArray(n.content)) n.content.forEach(c => walk(c as typeof n))
      }
      walk(mutatedJson as Parameters<typeof walk>[0])

      return {
        identical: mineSpec === liveSpec,
        diffs,
        nodeCount: Object.keys(mine.nodes).length,
        markCount: Object.keys(mine.marks).length,
        // Does the standalone schema round-trip the LIVE document? (Structural — see above.)
        reparsed: !!reparsed,
        docEq: reparsed ? sameDoc(reparsed.toJSON(), liveJson0) : false,
        // TRACE THE PASS: a doc with no citations/math would make docEq vacuous. Report what was
        // actually exercised so a green result on an empty document is visibly worthless.
        census,
        liveJson, mutatedJson, mutationApplied,
      }
    },
    parseCost(iters) {
      const json = editor.state.doc.toJSON()
      const words = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ').split(/\s+/).filter(Boolean).length
      // WARM FIRST — the JIT tier-up is the single biggest liar in this probe suite.
      for (let i = 0; i < 12; i++) nodeFromContentJson(json)
      const ms: number[] = []
      for (let i = 0; i < iters; i++) {
        const t0 = performance.now()
        const n = nodeFromContentJson(json)
        ms.push(performance.now() - t0)
        if (!n) return { void: true, reason: 'parse returned null — a cost measured on a failed parse is a fiction' }
      }
      ms.sort((a, b) => a - b)
      return {
        words, iters,
        p50: ms[Math.floor(ms.length / 2)],
        min: ms[0], max: ms[ms.length - 1],
      }
    },
    docEqOf(json) {
      // STRUCTURAL, not `Node.eq` — see schemaIdentity(): PM's eq is reference equality on NodeType
      // and can never be true across two schemas, which is precisely the comparison being made here.
      const n = nodeFromContentJson(json)
      if (!n) return null
      const stable = (v: unknown): string => {
        if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
        if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
        const o = v as Record<string, unknown>
        return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
      }
      return stable(n.toJSON()) === stable(editor.state.doc.toJSON())
    },
    chromeBox(kind, arg) {
      harvestNow()
      if (kind === 'note') {
        const b = noteBox(String(arg ?? '+'), measure, 18)
        return b ? { advanceWidth: b.advanceWidth, lineHeightDemand: b.lineHeightDemand } : null
      }
      const b = backrefBox(arg as Array<{ label: string; quote: string }>, measure, 18)
      return b ? { advanceWidth: b.advanceWidth, lineHeightDemand: b.lineHeightDemand } : null
    },
  }

  ;(window as unknown as { __iwTextRenderProbe?: ProbeApi }).__iwTextRenderProbe = api
  window.dispatchEvent(new Event('inkwave:textrender-probe-ready'))
}
