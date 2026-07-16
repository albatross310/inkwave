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
  // POSITIONAL RELIABILITY: pages [0, reliablePages) are trustworthy. A bibliography is force-broken
  // onto its own page at the END, so a whole-table boolean threw away ~57 of 58 exact pages and told
  // us nothing about WHERE. The table carries the boundary so a caller can render the exact pages and
  // fall back to the bitmap ONLY from there on.
  reliablePages: number
}

/**
 * THE BIBLIOGRAPHY'S CONTRIBUTION TO WRAP, AS A CONTENT SIGNATURE (2026-07-17).
 *
 * WHY THIS EXISTS — and it is the single thing that made persistence possible at all. contextSig
 * used to embed `opts.bibEpoch` = `bibProvider.getVersion()`, which is a **monotonic session event
 * counter** (`notify()` does `this._version++`). It counts how many bibliography notifications have
 * fired THIS SESSION. It is not derived from content, so it does not reproduce across a reload:
 * measured 15 on the writing session and 2 after reload, on a byte-identical document. Every
 * hydrated table therefore stale-missed, ALWAYS. The layer was structurally incapable of ever
 * scoring a hit — it would have shipped reporting "116 tables persisted" and served ZERO lookups,
 * forever, while looking like a working cache. That is exactly the disease: the feature's absence
 * looks identical to the feature being unnecessary.
 *
 * The ORIGINAL INTENT was right — a citation's box changes its wrap, so the bibliography genuinely
 * belongs in the signature. The INSTRUMENT was wrong: an epoch is a proxy for "something changed",
 * not a description of WHAT THE STATE IS, and only the latter survives a process boundary.
 *
 * So: hash the entries themselves. If the CSL data and the style are byte-identical, every citation
 * resolves to the same in-text string, so every citation box is the same width, so the wrap is the
 * same. OVER-invalidation is safe here (a miss rebuilds and is counted); UNDER-invalidation is the
 * direction that paints wrong words — so this hashes the WHOLE entry rather than guessing which
 * fields a given CSL style reads.
 *
 * The epoch keeps its ONE legitimate job: an in-session memo key. Hashing the library is O(entries)
 * and the epoch tells us for free when that work can be skipped.
 */
let _bibSigCache: { epoch: number; sig: string } | null = null
export function bibSignature(): string {
  const epoch = bibProvider.getVersion()
  if (_bibSigCache && _bibSigCache.epoch === epoch) return _bibSigCache.sig
  // FNV-1a over the serialized entries. Not cryptographic — this guards a regenerable cache, and a
  // collision costs a stale-looking hit on byte-identical-but-for-a-collision data. Cheap and stable
  // is what matters; the entries are sorted so Map iteration order can never move the signature.
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
 * ZOOM AND DPR ARE DELIBERATELY ABSENT — canonical pagination's whole point is that breaks are
 * measured in a forced canonical context and are therefore device- and zoom-independent ("same text
 * on page N at every zoom, on phone, and in print"). That makes a table PORTABLE: baked once, valid
 * at any zoom, on any device, across reloads. This is a claim the codebase makes, so it is VERIFIED
 * by probe (zoomPortability, and panezoom.prove.mjs on BOTH engines) rather than trusted.
 *
 * EVERY COMPONENT MUST BE CONTENT-DERIVED, NOT SESSION-DERIVED. A signature that embeds anything
 * counted since page load cannot survive the reload it exists to survive. `bibSig` replaced the
 * session epoch for exactly that reason — see bibSignature() above.
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
// At ~1.4KB a table survives reload trivially, which KILLS the cold-start penalty that has flattered
// every bitmap number we have taken (a cold scrub far from the origin currently presents ~0 real
// intermediates). Shape mirrors snapThumbs' OPFS store — one index JSON per doc — rather than
// inventing a second scheme. It NEVER travels with the .studio: regenerable, local, Peter's
// hard-minimise rule.

// BUDGET + EVICTION (2026-07-17). A table is ~1.4KB, so 116 versions is ~158KB and eviction should
// NEVER fire at Peter's scale — which is exactly why the budget must exist and must be REPORTED
// rather than assumed: a store with no bound is one long session away from being the thing that
// fills the origin's quota, and "it's only 1.4KB" is a claim about today's document. Every drop is
// NAMED (`dropped`), because bounded coverage that reports as total is how "we covered everything"
// becomes false without anyone noticing — the grow-only snapshot truncation, same lesson.
const BYTES_BUDGET = 2 * 1024 * 1024 // ~1,400 versions of a thesis-scale doc

/** Cheap, allocation-free size estimate. starts[] is the payload; the rest is bookkeeping. */
function tableBytes(t: BreakTable): number {
  return t.starts.length * 8 + t.sig.length * 2 + 64
}

// Counters are PER-DOC because that is the scope tableStats() is asked about. A global counter
// answering a per-doc question is how the signature-blind bake counter reported 116/116 while every
// lookup correctly missed.
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
        // A hydrated table has no LRU history — seed it so the first evict() can't prefer a
        // just-loaded table over one this session built.
        for (const k of Object.keys(i.tables)) i.used.set(k, ++i.clock)
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
  if (!i) { idxFor(docId).c.misses++; return null }
  // MEMORY IS AUTHORITATIVE FOR WHAT IT HOLDS (fixed 2026-07-17 — the layer's first execution
  // caught this). This used to early-return a MISS whenever `!i.loaded`, i.e. before loadTables()
  // had run. But putTable() populates `tables` WITHOUT setting `loaded`, so a session that built
  // its own tables and then looked one up MISSED EVERY TIME — a cache that reports a full index
  // and never serves a single hit, silently rebuilding forever. `loaded` only ever meant "ABSENCE
  // is authoritative"; absence already returns null → rebuild, which is correct either way. So the
  // flag has no business gating a PRESENT table. Same family as the signature-blind bake counter
  // reporting 116/116 while every lookup missed.
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
