// BREAK TABLES ON /snapshot — the store's first PRODUCTION caller (2026-07-17).
//
// THE BLOCKER THIS CLOSES. `buildBreakTable` needs a real PM `Node`. /snapshot has no editor
// (`useEditor` is absent from SnapshotView), so a version's `contentJson` — plain JSON in the
// .studio file — had nothing to parse against, and the whole OPFS layer (`loadTables`/`putTable`/
// `getTable`/`persist`/`tableStats`) had ZERO callers in src. `editorSchema.ts` supplies the missing
// half; this file is the wire.
//
// ── WHY THIS CANNOT COST PETER A KEYSTROKE, BY CONSTRUCTION ──────────────────────────────────────
// This module is imported by SnapshotView and by nothing else. /snapshot has no editor at all — no
// useEditor, no ProseMirror view, no typing path to be on. So "typing is unaffected" here is not a
// measurement that came out favourable and might come out differently on Peter's device under load:
// there is no mechanism by which this code can run while he types. That is the snapThumbs round-7
// pattern, taken deliberately — "zero added code on the editor path, so save latency is unchanged BY
// CONSTRUCTION, not merely measured-equal". The one thing that WOULD break it is an editor-path
// module importing this one; nothing does, and nothing should.
//
// ── WHAT IS HONEST ABOUT THE TABLES THIS BUILDS ─────────────────────────────────────────────────
// A table's breaks are only as good as the block geometry it was laid out from, and `blockStyle()`
// returns null for any kind that has not been HARVESTED from a real canonical `.ProseMirror`. There
// is no such element on /snapshot. The renderer's design already handles this correctly and LOUDLY:
// an unharvested heading/list does not get a guessed height, it DEFERS to an `estimated` placeholder
// and `reliablePages` stops at the first one ("Never guess a heading's height: it moves every break
// below it"). So on a route with no harvest, a document of plain paragraphs tables exactly, and a
// document with headings tables reliably only down to its first heading — and `tableStats` reports
// it rather than implying coverage. This wiring does NOT harvest from the /snapshot pane's own DOM:
// CLAUDE.md ROUND 12 recorded that harvesting a DocView-rendered pane feeds the EDITOR's model a
// number measured off a DIFFERENT element ("A fiction."). The honest reliability is reported; it is
// not manufactured. Closing that gap is the paint lane's business, not this seam's.
//
// FLAG: `inkwave:snapBreaks`, DEFAULT OFF. `?snapBreaks=1` on · `?snapBreaks=off` clears.

import type { Snapshot } from '../types/document'
import { makeCanvasMeasure, makeFontLoaded } from './arithmeticLayout'
import { canonicalGeomFromSettings } from './textRender'
import { nodeFromContentJson } from './editorSchema'
import { buildBreakTable, contextSig, bibSignature, loadTables, putTable, getTable, persist, tableStats } from './breakTable'
import { getCitationStyle } from '../citations/citationsBus'
import { bibProvider } from '../citations/bibProvider'

const FLAG = 'inkwave:snapBreaks'
let _flag: boolean | null = null

/** Sticky, resolved once per load (the `?auth` / snapThumbs pattern). Default OFF. */
export function snapBreaksEnabled(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwSnapBreaks?: boolean }) : null
  if (w && typeof w.__iwSnapBreaks === 'boolean') return w.__iwSnapBreaks
  if (_flag !== null) return _flag
  try { _flag = typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1' } catch { _flag = false }
  return _flag
}

/** Test seam. */
export function _resetSnapBreaksFlag(): void { _flag = null }

export interface SweepResult {
  /** Versions we were asked to cover. */
  asked: number
  /** Tables present after the sweep (hydrated + built). */
  tables: number
  /** Built this session (a hydrated hit costs nothing). */
  built: number
  /** Hydrated from OPFS — the whole point of persisting. */
  fromDisk: number
  /** Versions whose contentJson would not parse. COUNTED, never swallowed. */
  unparseable: number
  /** Wall time for the whole sweep. */
  ms: number
  /** Honest per-version build cost (built only — hydrated versions are not builds). */
  msPerBuild: number
  /** Of the tables we hold, how many report every page reliable. The honest coverage number. */
  fullyReliable: number
  /** Total pages indexed, and how many are trustworthy. */
  pages: number
  reliablePages: number
}

/**
 * Build (or hydrate) a break table for every version, once, when /snapshot opens.
 *
 * `signal` lets a nav away abandon the sweep — a background walk that outlives its route is how a
 * "cheap" idle task becomes a phone's battery bug. Cancellation is checked between versions; one
 * version's build is not interruptible (that is the incremental lane's problem, not this seam's).
 */
export async function sweepBreakTables(
  docId: string,
  snaps: readonly Snapshot[],
  signal?: { aborted: boolean },
): Promise<SweepResult> {
  const t0 = performance.now()
  // Hydrate first: a table on disk is ~656B and costs ~1.3ms/version to load vs ~62-82ms to build.
  await loadTables(docId)

  const geom = canonicalGeomFromSettings()
  const measure = makeCanvasMeasure()   // ONE per sweep: it memoises per (cssFont, text), which is
  const fontLoaded = makeFontLoaded(measure) // already worth 67% off a cold build (753→249ms).
  const opts = { citationStyle: getCitationStyle(), bibEpoch: bibProvider.getVersion() }
  // The signature must be CONTENT-derived and reproducible across a reload — bibSignature() hashes
  // the sorted CSL entries precisely because the bibEpoch is a session event counter that could
  // never reproduce (ROUND 13: every hydrated table stale-missed, always). Do not put a
  // since-page-load counter in here.
  const fontsKey = document.fonts?.status === 'loaded' ? 'loaded' : 'pending'
  const sig = contextSig(geom, opts.citationStyle, bibSignature(), fontsKey)

  let built = 0, unparseable = 0, buildMs = 0
  for (const s of snaps) {
    if (signal?.aborted) break
    if (getTable(docId, s.id, sig)) continue // hydrated or already built — the whole point
    const doc = nodeFromContentJson(s.contentJson)
    if (!doc) { unparseable++; continue } // COUNTED. A version that silently reads as "no pages" is the disease.
    const b0 = performance.now()
    putTable(docId, s.id, buildBreakTable(doc, geom, measure, fontLoaded, opts, sig))
    buildMs += performance.now() - b0
    built++
  }
  if (built > 0 && !signal?.aborted) await persist(docId)

  const st = tableStats(docId)
  // Report coverage from the tables themselves, not from a counter that says what we hoped: the
  // bake counter that read 116/116 while every lookup missed is the reason this reads the real ones.
  let fullyReliable = 0, pages = 0, reliablePages = 0
  for (const s of snaps) {
    const t = getTable(docId, s.id, sig)
    if (!t) continue
    pages += t.pages
    reliablePages += t.reliablePages
    if (t.reliable) fullyReliable++
  }
  return {
    asked: snaps.length, tables: st.tables, built, fromDisk: st.loadedFromDisk, unparseable,
    ms: performance.now() - t0, msPerBuild: built ? buildMs / built : 0,
    fullyReliable, pages, reliablePages,
  }
}
