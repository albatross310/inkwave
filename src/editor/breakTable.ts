// BREAK TABLE (2026-07-17) — the whole-document index, at ~8 bytes per page.
//
// WHAT IT IS. Per version: the doc position each page STARTS at. That is all a renderer needs to be
// whole-document, because a page's layout is PREFIX-INDEPENDENT (proved before this was built:
// windowProof/windowCost — 30/30, 31/31, 31/31 line starts at 2k/10k/40k, mid-line negatives
// collapsing to 0). A break `at` IS a line start and greedy wrap restarts deterministically there,
// so the prefix is needed ONLY to FIND the break, never to draw the page.
//
// WHY IT REPLACES A BITMAP CACHE RATHER THAN JOINING ONE. A thumbnail is a picture of one pane, at
// one scrollTop, at one zoom, for one version — coverage means baking every page of every version,
// and it goes stale the moment the reader scrolls somewhere new. That is the mechanism behind doc's
// 116/116-baked-yet-12%-real. A table has no window to fall outside of:
//     171 pages x 8B = 1.4KB/version   ·   116 versions ~ 158KB   (vs 1.53MB/version = 177.8MB fat)
// Cost: ONE full build per version (measured 4/16/62ms at 2k/10k/40k), once, then every page of
// that version renders on demand in ~0.6ms.
//
// STALENESS MUST FAIL LOUDLY. A table is a function of the canonical context. If that context moves
// and we hydrate anyway, we paint the WRONG WORDS on the page and report success — which is exactly
// what paginate()'s retired orphan rule did to us once already. So every table carries its context
// SIGNATURE and a mismatch is a MISS (rebuild), never a silent reuse.

import { writeOpfsFile } from '../storage/opfsWrite'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Measure } from './arithmeticLayout'
import { buildRenderModel, type RenderGeom, type BuildOpts } from './textRender'

export interface BreakTable {
  v: 1
  sig: string       // canonical-context signature — a mismatch MUST rebuild, never reuse
  pages: number
  starts: number[]  // doc position each page begins at (starts[0] is the doc start)
  reliable: boolean // convenience: nothing was estimated anywhere
  // POSITIONAL RELIABILITY: pages [0, reliablePages) are trustworthy. A bibliography is force-broken
  // onto its own page at the END, so a whole-table boolean threw away ~57 of 58 exact pages and told
  // us nothing about WHERE. The table carries the boundary so a caller can render the exact pages and
  // fall back to the bitmap ONLY from there on.
  reliablePages: number
}

/**
 * THE CONTEXT SIGNATURE. Everything the break positions are a function of, and nothing they aren't.
 *
 * ZOOM AND DPR ARE DELIBERATELY ABSENT — canonical pagination's whole point is that breaks are
 * measured in a forced canonical context and are therefore device- and zoom-independent ("same text
 * on page N at every zoom, on phone, and in print"). That makes a table PORTABLE: baked once, valid
 * at any zoom, on any device, across reloads. This is a claim the codebase makes, so it is VERIFIED
 * by probe (zoomPortability) rather than trusted — if a table ever proved zoom-dependent, zoom would
 * have to join this signature and the portability win would be gone.
 *
 * The citation epoch DOES belong here: a citation's box changes its wrap, so a bibliography
 * hydration or CSL style switch genuinely moves the breaks.
 */
export function contextSig(geom: RenderGeom, opts: BuildOpts, fontsKey: string): string {
  return [
    'v1',
    `p${geom.pageWidthPx.toFixed(2)}x${geom.pageHeightPx.toFixed(2)}`,
    `m${geom.topMarginPx}/${geom.sideMarginPx}`,
    `b${geom.basePx}`, `r${geom.ratio}`, `s${geom.paraSpacingEm}`,
    `c${opts.citationStyle ?? ''}@${opts.bibEpoch ?? -1}`,
    `f${fontsKey}`,
  ].join('|')
}

/** Build a version's table. ONE full layout — the only O(doc) work in the whole design. */
export function buildBreakTable(
  doc: PMNode,
  geom: RenderGeom,
  measure: Measure,
  fontLoaded: (stack: string, sizePx: number) => boolean,
  opts: BuildOpts,
  sig: string,
): BreakTable {
  const model = buildRenderModel(doc, geom, measure, fontLoaded, opts)
  const starts: number[] = []
  for (let i = 0; i < model.lines.length; i++) {
    const p = model.pageOfLine[i]
    if (starts.length === p) starts.push(model.lines[i].pos)
  }
  return {
    v: 1, sig, pages: Math.max(1, starts.length), starts,
    reliable: model.breaksReliable, reliablePages: model.reliablePages,
  }
}

/** Is page N's break trustworthy? Positional — pages below the first estimated block are exact. */
export function tablePageReliable(t: BreakTable, pageIdx: number): boolean {
  return pageIdx < t.reliablePages
}

/** The doc position page N begins at — the seam the window renderer opens from. */
export function pageStart(t: BreakTable, pageIdx: number): number | null {
  return t.starts[pageIdx] ?? null
}

/** The page carrying a doc position. Content-anchored: never "page N" across versions. */
export function pageOfPos(t: BreakTable, pos: number): number {
  let lo = 0, hi = t.starts.length - 1, best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (t.starts[mid] <= pos) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return best
}

// ── Persistence ───────────────────────────────────────────────────────────────────────────────
// At ~1.4KB a table survives reload trivially, which KILLS the cold-start penalty that has flattered
// every bitmap number we have taken (a cold scrub far from the origin currently presents ~0 real
// intermediates). Shape mirrors snapThumbs' OPFS store — one index JSON per doc — rather than
// inventing a second scheme. It NEVER travels with the .studio: regenerable, local, Peter's
// hard-minimise rule.

interface TableIndex { loaded: boolean; loading?: Promise<void>; tables: Record<string, BreakTable> }
const _idx = new Map<string, TableIndex>()
const _timer = new Map<string, ReturnType<typeof setTimeout>>()
const dbg = { hits: 0, misses: 0, stale: 0, builds: 0, persisted: 0, loaded: 0 }
if (typeof window !== 'undefined') (window as unknown as { __iwBreakTables?: unknown }).__iwBreakTables = dbg

function idxFor(docId: string): TableIndex {
  let i = _idx.get(docId)
  if (!i) { i = { loaded: false, tables: {} }; _idx.set(docId, i) }
  return i
}

async function readOpfs(path: string[]): Promise<Uint8Array | null> {
  try {
    let dir = await navigator.storage.getDirectory()
    for (const p of path.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true })
    const fh = await dir.getFileHandle(path[path.length - 1])
    return new Uint8Array(await (await fh.getFile()).arrayBuffer())
  } catch { return null }
}

export async function loadTables(docId: string): Promise<void> {
  const i = idxFor(docId)
  if (i.loaded) return
  if (i.loading) return i.loading
  i.loading = (async () => {
    const buf = await readOpfs(['documents', docId, 'breaks', 'index.json'])
    if (buf) {
      try {
        const j = JSON.parse(new TextDecoder().decode(buf)) as { tables?: Record<string, BreakTable> }
        i.tables = j.tables ?? {}
        dbg.loaded = Object.keys(i.tables).length
      } catch { /* corrupt ⇒ start fresh; a table is regenerable */ }
    }
    i.loaded = true
  })()
  return i.loading
}

/**
 * A cached table for this version, or null ⇒ the caller must build.
 * A SIGNATURE MISMATCH RETURNS NULL AND IS COUNTED. It is never "close enough": a table from a
 * different canonical context describes a different pagination, and using it would paint the wrong
 * words on the page while reporting success.
 */
export function getTable(docId: string, snapId: string, sig: string): BreakTable | null {
  const i = _idx.get(docId)
  if (!i || !i.loaded) { dbg.misses++; return null }
  const t = i.tables[snapId]
  if (!t) { dbg.misses++; return null }
  if (t.sig !== sig) { dbg.stale++; return null } // loud by construction: counted, and rebuilt
  dbg.hits++
  return t
}

export function putTable(docId: string, snapId: string, t: BreakTable): void {
  const i = idxFor(docId)
  i.tables[snapId] = t
  dbg.builds++
  schedulePersist(docId)
}

function schedulePersist(docId: string): void {
  clearTimeout(_timer.get(docId))
  _timer.set(docId, setTimeout(() => { void persist(docId) }, 1500))
}

async function persist(docId: string): Promise<void> {
  const i = idxFor(docId)
  try {
    await writeOpfsFile(['documents', docId, 'breaks', 'index.json'], JSON.stringify({ v: 1, tables: i.tables }))
    dbg.persisted = Object.keys(i.tables).length
  } catch { /* best-effort — regenerable */ }
}

export function tableStats(docId: string): { tables: number; bytes: number; loaded: boolean } {
  const i = _idx.get(docId)
  const tables = i ? Object.keys(i.tables).length : 0
  const bytes = i ? JSON.stringify({ tables: i.tables }).length : 0
  return { tables, bytes, loaded: !!i?.loaded }
}

export function _resetTables(): void { _idx.clear() }
