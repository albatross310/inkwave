// BREAK TABLE — the whole-document page index, at ~8 bytes per page: per version, the doc position
// each page STARTS at. That is all a renderer needs, because a page's layout is PREFIX-INDEPENDENT
// — a break `at` IS a line start and greedy wrap restarts deterministically there, so the prefix is
// needed only to FIND the break, never to draw the page.
//
// ⚠ STALENESS MUST FAIL LOUDLY. A table is a function of the canonical context; hydrate one whose
// context has moved and we paint the WRONG WORDS and report success. So every table carries its
// context SIGNATURE, and a mismatch is a MISS (rebuild), never a silent reuse (R1).
// → docs/archive/pagination-rounds.md#break-table

import { writeOpfsFile } from '../storage/opfsWrite'
import { bibProvider } from '../citations/bibProvider'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Measure } from './arithmeticLayout'
import { buildRenderModel, type RenderGeom, type BuildOpts } from './textRender'

export interface BreakTable {
  v: 1
  sig: string       // canonical-context signature — a mismatch MUST rebuild, never reuse
  pages: number
  starts: number[]  // doc position each page begins at (starts[0] is the doc start)
  reliable: boolean // convenience: nothing was estimated anywhere
  // POSITIONAL reliability — pages [0, reliablePages) are exact. A whole-table boolean threw away
  // ~57 of 58 exact pages (the refList force-breaks at the END) and said nothing about WHERE.
  reliablePages: number
}

/**
 * The bibliography's contribution to wrap, as a CONTENT signature.
 *
 * ⚠ NO COMPONENT OF A PERSISTED SIGNATURE MAY BE A SESSION COUNTER. `contextSig` embedded
 * `bibProvider.getVersion()` — a monotonic notification count — so every hydrated table stale-missed
 * ALWAYS: a cache structurally incapable of a hit, indistinguishable from one nobody built (R7, R4).
 * ⚠ Hash the WHOLE entry, never the fields a given CSL style is thought to read. OVER-invalidating
 * costs a counted rebuild; UNDER-invalidating paints wrong words (R8). The epoch keeps its one
 * honest job — an in-session memo key. → docs/archive/pagination-rounds.md#bib-signature
 */
let _bibSigCache: { epoch: number; sig: string } | null = null
export function bibSignature(): string {
  const epoch = bibProvider.getVersion()
  if (_bibSigCache && _bibSigCache.epoch === epoch) return _bibSigCache.sig
  // FNV-1a over the serialized entries — not cryptographic; this guards a regenerable cache. SORT
  // them, so Map iteration order can never move the signature.
  const items = bibProvider.getAll().slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const s = JSON.stringify(items)
  let h = 0x811c9dc5
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const sig = `${items.length}:${h.toString(36)}`
  _bibSigCache = { epoch, sig }
  return sig
}

/** Test seam: forget the memo (the epoch is a session counter, so tests must be able to reset it). */
export function _resetBibSig(): void { _bibSigCache = null }

/**
 * THE CONTEXT SIGNATURE. Everything the break positions are a function of, and nothing they aren't.
 *
 * ⚠ ZOOM AND DPR ARE DELIBERATELY ABSENT — canonical breaks are zoom- and device-independent, which
 * is what makes a table PORTABLE. That is a claim, so it is probe-VERIFIED, never trusted (R3).
 * ⚠ EVERY COMPONENT MUST BE CONTENT-DERIVED, never session-derived — see `bibSignature` (R7).
 * → docs/archive/pagination-rounds.md#break-table
 */
export function contextSig(geom: RenderGeom, citationStyle: string, bibSig: string, fontsKey: string): string {
  return [
    'v1',
    `p${geom.pageWidthPx.toFixed(2)}x${geom.pageHeightPx.toFixed(2)}`,
    `m${geom.topMarginPx}/${geom.sideMarginPx}`,
    `b${geom.basePx}`, `r${geom.ratio}`, `s${geom.paraSpacingEm}`,
    `c${citationStyle}@${bibSig}`,
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
// One index JSON per doc, mirroring snapThumbs' OPFS store rather than inventing a second scheme
// (R2). It NEVER travels with the .studio: regenerable, local, Peter's hard-minimise rule.
//
// ⚠ THE BUDGET MUST EXIST AND EVERY DROP MUST BE NAMED (`dropped`). "It's only 1.4KB" is a claim
// about today's document, and bounded coverage that reports as total is the grow-only truncation
// lesson again (R4). → docs/archive/pagination-rounds.md#break-table
const BYTES_BUDGET = 2 * 1024 * 1024 // ~1,400 versions of a thesis-scale doc

/** Cheap, allocation-free size estimate. starts[] is the payload; the rest is bookkeeping. */
function tableBytes(t: BreakTable): number {
  return t.starts.length * 8 + t.sig.length * 2 + 64
}

// ⚠ Counters are PER-DOC, the scope `tableStats()` is asked about — a global counter answering a
// per-doc question is how a bake counter reported 116/116 while every lookup missed (R9).
interface TableCounters {
  hits: number      // served from cache, signature matched
  misses: number    // nothing cached for this snapId (or the index isn't loaded yet)
  stale: number     // cached BUT the signature moved ⇒ REBUILD. Never a silent reuse.
  builds: number    // putTable calls — a rebuild landing in the cache
  persisted: number // tables in the last successful OPFS write
  loadedFromDisk: number // tables hydrated by loadTables() on this session's cold start
  dropped: string[] // snapIds evicted, BY NAME
}
interface TableIndex {
  loaded: boolean
  loading?: Promise<void>
  tables: Record<string, BreakTable>
  used: Map<string, number> // snapId → LRU clock
  clock: number
  c: TableCounters
}
const _idx = new Map<string, TableIndex>()
const _timer = new Map<string, ReturnType<typeof setTimeout>>()

function idxFor(docId: string): TableIndex {
  let i = _idx.get(docId)
  if (!i) {
    i = {
      loaded: false, tables: {}, used: new Map(), clock: 0,
      c: { hits: 0, misses: 0, stale: 0, builds: 0, persisted: 0, loadedFromDisk: 0, dropped: [] },
    }
    _idx.set(docId, i)
  }
  return i
}

/** LRU to budget. Named drops only — silent truncation is the failure this store exists to avoid. */
function evict(i: TableIndex): void {
  let bytes = 0
  for (const k of Object.keys(i.tables)) bytes += tableBytes(i.tables[k])
  if (bytes <= BYTES_BUDGET) return
  const byAge = Object.keys(i.tables).sort((a, b) => (i.used.get(a) ?? 0) - (i.used.get(b) ?? 0))
  for (const k of byAge) {
    if (bytes <= BYTES_BUDGET) break
    bytes -= tableBytes(i.tables[k])
    delete i.tables[k]
    i.used.delete(k)
    i.c.dropped.push(k)
  }
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
        i.c.loadedFromDisk = Object.keys(i.tables).length
        // A hydrated table has no LRU history — seed it, or the first evict() prefers a just-loaded
        // table over one this session built.
        for (const k of Object.keys(i.tables)) i.used.set(k, ++i.clock)
      } catch { /* corrupt ⇒ start fresh; a table is regenerable */ }
    }
    i.loaded = true
  })()
  return i.loading
}

/**
 * A cached table for this version, or null ⇒ the caller must build.
 * ⚠ A SIGNATURE MISMATCH RETURNS NULL AND IS COUNTED — never "close enough": a table from another
 * canonical context describes another pagination, and using it paints wrong words (R1).
 */
export function getTable(docId: string, snapId: string, sig: string): BreakTable | null {
  const i = _idx.get(docId)
  if (!i) { idxFor(docId).c.misses++; return null }
  // ⚠ MEMORY IS AUTHORITATIVE FOR WHAT IT HOLDS. `loaded` means only "ABSENCE is authoritative" and
  // must never gate a PRESENT table: putTable() populates `tables` without setting it, so an
  // early-return on `!i.loaded` made a session that built its own tables MISS every one (R1).
  // → docs/archive/pagination-rounds.md#break-table
  const t = i.tables[snapId]
  if (!t) { i.c.misses++; return null }
  if (t.sig !== sig) { i.c.stale++; return null } // loud by construction: counted, and rebuilt
  i.c.hits++
  i.used.set(snapId, ++i.clock)
  return t
}

export function putTable(docId: string, snapId: string, t: BreakTable): void {
  const i = idxFor(docId)
  i.tables[snapId] = t
  i.used.set(snapId, ++i.clock)
  i.c.builds++
  evict(i)
  schedulePersist(docId)
}

function schedulePersist(docId: string): void {
  clearTimeout(_timer.get(docId))
  _timer.set(docId, setTimeout(() => { void persist(docId) }, 1500))
}

/**
 * Write the index to OPFS. EXPORTED (2026-07-17) so a caller — or a probe — can flush
 * deterministically instead of racing the 1500ms debounce. Goes through `storage/opfsWrite.ts`,
 * which is the ONLY sanctioned OPFS write path: WebKit has no createWritable, so iOS writes via a
 * worker createSyncAccessHandle, serialized, ONE open handle per file. Never bypass it.
 */
export async function persist(docId: string): Promise<void> {
  const i = idxFor(docId)
  clearTimeout(_timer.get(docId)) // a pending debounce would re-write what we just wrote
  _timer.delete(docId)
  try {
    await writeOpfsFile(['documents', docId, 'breaks', 'index.json'], JSON.stringify({ v: 1, tables: i.tables }))
    i.c.persisted = Object.keys(i.tables).length
  } catch { /* best-effort — regenerable */ }
}

export interface TableStats {
  tables: number
  bytes: number
  loaded: boolean
  hits: number
  misses: number
  stale: number
  builds: number
  persisted: number
  loadedFromDisk: number
  dropped: string[]
  budget: number
}

/** The honest picture for one doc: hit/miss/stale/rebuild, bytes, and what was evicted BY NAME. */
export function tableStats(docId: string): TableStats {
  const i = _idx.get(docId)
  const tables = i ? Object.keys(i.tables).length : 0
  let bytes = 0
  if (i) for (const k of Object.keys(i.tables)) bytes += tableBytes(i.tables[k])
  return {
    tables, bytes, loaded: !!i?.loaded, budget: BYTES_BUDGET,
    hits: i?.c.hits ?? 0, misses: i?.c.misses ?? 0, stale: i?.c.stale ?? 0,
    builds: i?.c.builds ?? 0, persisted: i?.c.persisted ?? 0,
    loadedFromDisk: i?.c.loadedFromDisk ?? 0,
    dropped: i ? [...i.c.dropped] : [],
  }
}

export function _resetTables(): void { _idx.clear(); _timer.clear() }
