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
import { makeCanvasMeasure, type Measure } from './arithmeticLayout'
import {
  buildRenderModel, paintPage, paintMapStrip, canonicalGeom,
  pageContainingPos, anchorPosOfPage,
  type RenderGeom, type RenderModel,
} from './textRender'
import { pageBoxPx } from './pageModel'
import { getPaperSize, getOrientation, getTopMarginPx, getSideMarginPx, getParaSpacingEm } from './pageSettings'
// The BASELINE we are measured against — imported READ-ONLY so the head-to-head runs the REAL
// production bake path (the SVG-foreignObject capture), not a reimplementation of it. Nothing here
// mutates the thumbnail system; the bake path is owned elsewhere.
import { captureRegion } from './scrubRaster'

// The REAL geometry the live document is paginated in — read from the same settings the live
// PaginationExtension reads, never a harness constant.
function liveGeom(): RenderGeom {
  const paper = getPaperSize()
  const { pageWidthPx, pageHeightPx } = pageBoxPx({
    paperSize: paper === 'scroll' ? 'a4' : paper,
    orientation: getOrientation(),
    topMarginPx: getTopMarginPx(),
    bottomMarginPx: 72,
  })
  const g = canonicalGeom(pageWidthPx, pageHeightPx, getSideMarginPx(), getTopMarginPx())
  g.paraSpacingEm = getParaSpacingEm()
  return g
}

// REAL font-loaded check. `document.fonts.check()` returns TRUE for a family with NO @font-face (the
// system fallback counts) — that trap silently measures a fallback against itself and "agrees" at
// 0.000. So compare the family's advance against the monospace fallback's: a family that measures
// IDENTICALLY to `monospace` for a proportional probe string is not really loaded.
function makeFontLoaded(measure: Measure): (stack: string, sizePx: number) => boolean {
  const cache = new Map<string, boolean>()
  const PROBE = 'iiiiiiiiiiWWWWWWWWWW'
  return (stack: string, sizePx: number): boolean => {
    const key = `${stack}|${sizePx}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let ok = false
    try {
      ok = document.fonts.check(`${sizePx}px ${stack}`)
      if (ok) {
        const w = measure(PROBE, `400 ${sizePx}px ${stack}`)
        const mono = measure(PROBE, `400 ${sizePx}px monospace`)
        // A proportional face cannot have the same advance as monospace for this probe. Equal ⇒ we
        // are measuring the fallback, i.e. the face never loaded.
        if (Math.abs(w - mono) < 0.01) ok = false
      }
    } catch { ok = false }
    cache.set(key, ok)
    return ok
  }
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
  /** BASELINE A — the REAL production bake: SVG-foreignObject capture of a live pane. */
  bake(selector: string, scale: number): Promise<Record<string, unknown>>
  /** BASELINE B — the REAL present path: WebP encode (0.5×/q0.7, as snapThumbs) → decode → blit. */
  thumbRoundTrip(canvas: HTMLCanvasElement, scale: number): Promise<Record<string, unknown>>
  /** Heap cost of N render models — the honest comparison against the 62.7MB bitmap pool. */
  modelMem(n: number): Record<string, unknown>
  /** The known-positive self-test: PROVE the probe can see a difference before trusting a null. */
  selfTest(): Record<string, unknown>
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
      const g = liveGeom()
      const t0 = performance.now()
      const model = buildRenderModel(editor.state.doc, g, measure, fontLoaded)
      return { model, ms: performance.now() - t0 }
    },

    // COLD = a fresh measure cache (no memoised advances). This is the honest first-open number;
    // `build()` after it is the warm number. Conflating them is how a "few ms" claim gets made.
    buildCold() {
      measure = makeCanvasMeasure()
      fontLoaded = makeFontLoaded(measure)
      const g = liveGeom()
      const t0 = performance.now()
      const model = buildRenderModel(editor.state.doc, g, measure, fontLoaded)
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
      const empty: RenderModel = { lines: [], blocks: [], pageOfLine: [], pageTop: [0], pages: 1, contentHeight: 0, coverage: {}, breaks: [], sig: '' }
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
      for (let i = 0; i < n; i++) models.push(buildRenderModel(editor.state.doc, g, makeCanvasMeasure(), fontLoaded))
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

    // ── THE KNOWN-POSITIVE GATE ──────────────────────────────────────────────────────────────
    // "Measure X, compare to Y, report" is exactly the shape that failed silently before. So before
    // any null result is believed, assert the instrument can SEE a known-positive:
    //   • fonts really loaded (not the system fallback measuring against itself),
    //   • the measure actually discriminates (two different strings ⇒ different widths),
    //   • an INJECTED wrap error really moves the output (a 5% advance inflation must change the
    //     line count — if it doesn't, the comparison is blind and nothing it reports means anything).
    selfTest() {
      const g = liveGeom()
      const base = buildRenderModel(editor.state.doc, g, measure, fontLoaded)
      // Inflate every advance 5% — the model MUST get more lines. If it doesn't, the probe is blind.
      const inflated: Measure = (t, f) => measure(t, f) * 1.05
      const mutated = buildRenderModel(editor.state.doc, g, inflated, fontLoaded)
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
  }

  ;(window as unknown as { __iwTextRenderProbe?: ProbeApi }).__iwTextRenderProbe = api
  window.dispatchEvent(new Event('inkwave:textrender-probe-ready'))
}
