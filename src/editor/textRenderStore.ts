// MULTI-VERSION RENDER-MODEL STORE (2026-07-17 — "sweep and load the whole document").
//
// THE STRUCTURAL POINT, and why this replaces a bitmap cache rather than joining it.
// A bitmap cache can only ever hold a WINDOW: a thumbnail is a picture of one pane, at one
// scrollTop, at one zoom, for one version — so covering a document means baking every page of every
// version, and covering it AFTER the reader scrolls somewhere new means baking it again. That is the
// defect Peter is describing ("I wanna make sure we sweep and load the whole document") and the
// mechanism behind doc's 116/116-baked-yet-12%-real: the bake covers a REGION, not a document.
//
// A render MODEL is whole-document by construction. It holds line geometry for EVERY page, so any
// page renders on demand at any DPR and any anchor — there is no window to fall outside of and no
// hit rate to miss. Measured (40k words / 154 pages): 1.44MB heap per version, cold build 129.5ms,
// warm 82.2ms, paint ~5ms/page raster-flushed.
//
// EVICTION IS EXPLICIT AND LOGGED. If a model is dropped, `dropped` records it and `coverageOf`
// reports it — silent truncation is how "we covered everything" becomes false without anyone
// noticing (the grow-only snapshot incident is the same lesson).

import type { Node as PMNode } from '@tiptap/pm/model'
import { makeCanvasMeasure, type Measure } from './arithmeticLayout'
import {
  buildRenderModel, pageContainingPos, type RenderGeom, type RenderModel, type BuildOpts,
} from './textRender'

export interface StoredModel {
  snapId: string
  model: RenderModel
  bytesEst: number
  builtAt: number
  lastUsed: number
  geomSig: string
}

// Budget. A model is ~1.4MB at thesis scale (40k words / 154 pages) and ~0.35MB at 10k. Peter's
// device currently carries 140 in-memory BITMAPS for 57.3MB across three panes — so the model store
// is a strict improvement per version covered, but N × 1.4MB is not free either: 100 versions of a
// 40k-word thesis ≈ 140MB, which is NOT acceptable on a phone. Hence a byte budget with LRU
// eviction, tuned lower on touch, and a DROP LOG so bounded coverage is visible rather than implied.
const BUDGET_DESKTOP = 48 * 1024 * 1024
const BUDGET_TOUCH = 16 * 1024 * 1024

export interface StoreStats {
  models: number
  bytes: number
  budget: number
  dropped: string[]        // snapIds evicted — what we are NOT covering, named
  builds: number
  buildMsTotal: number
  hits: number
  misses: number
}

export class TextRenderStore {
  private models = new Map<string, StoredModel>()
  private clock = 0
  private measure: Measure = makeCanvasMeasure()
  readonly stats: StoreStats

  constructor(touch = false) {
    this.stats = {
      models: 0, bytes: 0, budget: touch ? BUDGET_TOUCH : BUDGET_DESKTOP,
      dropped: [], builds: 0, buildMsTotal: 0, hits: 0, misses: 0,
    }
  }

  /** Context changed (fonts, page settings, zoom, theme) ⇒ every model's geometry is stale. */
  clear(): void {
    this.models.clear()
    this.stats.models = 0
    this.stats.bytes = 0
  }

  private static estBytes(m: RenderModel): number {
    let segs = 0, chars = 0
    for (const l of m.lines) { segs += l.segs.length; for (const s of l.segs) chars += s.text.length }
    // Cross-checked against a precise-heap reading at 40k words: structural 1.41MB vs heap 1.44MB.
    return chars * 2 + segs * 64 + m.lines.length * 96
  }

  /**
   * THE LEAN ALTERNATIVE, measured so the trade can be decided on numbers.
   * The fat part of a model is the SEGMENT TEXT — which duplicates content we already hold (the
   * snapshot's contentJson). A model needs only the BREAK GEOMETRY to be whole-document: per line,
   * {top, height, blockIdx, pos, startChar, endChar}. Segments can be re-sliced from the doc at
   * PAINT time (the same segsOfLine call, for one page's ~35 lines instead of the document's
   * thousands). This is what closes the whole-document × 116-versions × iPhone-8 triangle.
   */
  static leanBytes(m: RenderModel): number {
    // 6 numeric fields/line. V8 stores these in a packed double array when built as such; 8B each
    // is the honest upper bound, plus per-block bookkeeping.
    return m.lines.length * 6 * 8 + m.blocks.length * 48
  }

  /**
   * The model for a version, built on first ask and cached. `docOf` supplies the version's PM doc
   * (parsed from its contentJson) — the store never reaches for snapshots itself.
   *
   * Returns null only when the build itself couldn't run (no doc / unloaded fonts), never a guess.
   */
  get(
    snapId: string,
    docOf: () => PMNode | null,
    geom: RenderGeom,
    geomSig: string,
    fontLoaded: (stack: string, sizePx: number) => boolean,
    opts: BuildOpts,
  ): RenderModel | null {
    const hit = this.models.get(snapId)
    if (hit && hit.geomSig === geomSig) {
      hit.lastUsed = ++this.clock
      this.stats.hits++
      return hit.model
    }
    this.stats.misses++
    const doc = docOf()
    if (!doc) return null
    const t0 = performance.now()
    const model = buildRenderModel(doc, geom, this.measure, fontLoaded, opts)
    const ms = performance.now() - t0
    this.stats.builds++
    this.stats.buildMsTotal += ms
    const bytesEst = TextRenderStore.estBytes(model)
    if (hit) this.stats.bytes -= hit.bytesEst
    this.models.set(snapId, { snapId, model, bytesEst, builtAt: Date.now(), lastUsed: ++this.clock, geomSig })
    this.stats.bytes += bytesEst
    this.stats.models = this.models.size
    this.evict()
    return model
  }

  /** LRU to budget. Every drop is NAMED in stats.dropped — bounded coverage must be visible. */
  private evict(): void {
    if (this.stats.bytes <= this.stats.budget) return
    const byAge = [...this.models.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const m of byAge) {
      if (this.stats.bytes <= this.stats.budget) break
      this.models.delete(m.snapId)
      this.stats.bytes -= m.bytesEst
      this.stats.dropped.push(m.snapId)
      if (this.stats.dropped.length > 200) this.stats.dropped.splice(0, this.stats.dropped.length - 200)
    }
    this.stats.models = this.models.size
  }

  /** Whole-document coverage for a cached version: pages held, and whether EVERY page is renderable. */
  coverageOf(snapId: string): { cached: boolean; pages: number; pageTops: number; whole: boolean; reliable: boolean } | null {
    const m = this.models.get(snapId)
    if (!m) return { cached: false, pages: 0, pageTops: 0, whole: false, reliable: false }
    // `whole` is the real claim: a model covers the document iff it has an origin for EVERY page.
    // pageTop[i] is what paintPage needs to draw page i — a short pageTop array means pages that
    // silently render blank (the bug the first pixel diff caught).
    return {
      cached: true, pages: m.model.pages, pageTops: m.model.pageTop.length,
      whole: m.model.pageTop.length === m.model.pages,
      reliable: m.model.breaksReliable,
    }
  }

  /** The page carrying a doc position — the content-anchored seam (never "page N"). */
  pageFor(snapId: string, pos: number): number | null {
    const m = this.models.get(snapId)
    return m ? pageContainingPos(m.model, pos) : null
  }

  has(snapId: string): boolean { return this.models.has(snapId) }
}
