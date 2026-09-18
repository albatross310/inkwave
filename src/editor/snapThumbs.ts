// ── Snapshot thumbnail cache (2026-07-16 — Peter's Photos-grade cold-scrub fix) ────────────────
//
// A LOCAL OPFS cache of pre-rasterised pane thumbnails for /snapshot scrubbing. On a cold scrub
// (a version whose live pane isn't rendered) the presenter LOADS a ~30KB WebP (~5-20ms decode)
// instead of RENDERING the pane (measured 360-1400ms via the SVG-foreignObject path). Three panes
// per snapshot — doc / diff / map — each an independent entry keyed by snapshot-id + pane + a
// per-pane RENDER-SIGNATURE (a pane only re-bakes when an input that changes ITS pixels changes).
//
// HARD CONSTRAINTS (Peter): this NEVER travels with the .studio bundle — it's a regenerable local
// cache, so the emailed/synced file stays byte-for-byte unchanged and a fresh device just warms as
// it's used. Writes go through storage/opfsWrite.ts (iOS-safe). LRU byte-budgeted (it's a cache).
// UNGATED since 2026-09-18 — the cache is simply how cold scrubbing works now. Baking happens
// ENTIRELY in the /snapshot presenter's idle capture path — the editor snapshot-create/persist path
// gets ZERO added code, so save latency is unchanged by construction (not merely measured-equal).

import { writeOpfsFile } from '../storage/opfsWrite'

export type ThumbPane = 'doc' | 'diff' | 'map'

// Local disk cap (regenerable). ~70-100KB/snapshot × count: ~30MB/300 snaps, ~60MB/600 — 80MB
// holds a large thesis' worth and evicts the oldest beyond that.
const BUDGET = 80 * 1024 * 1024

// Downscale per pane: doc/diff at 0.5× (Peter's ~30KB target); the minimap is already a narrow
// strip, keep it at natural size so its diff ticks stay legible (still only a few KB).
export function thumbScale(pane: ThumbPane): number { return pane === 'map' ? 1 : 0.5 }
const QUALITY = 0.7

// THE DEBUG OVERLAY, AND ONLY IT. The feature's own gate is gone; what survives is the on-device
// diagnostic (the wave-video lesson: SHOW the state, don't guess it).
//
// IT MUST BE SESSION-SCOPED, AND IT MUST PERSIST WITHIN THE SESSION — both halves are load-bearing
// and they pull opposite ways. /snapshot's local-first nav rewrites the URL on every step (goTo →
// navigate without our params), so a value READ FRESH FROM THE URL dies on the first scrub. But a
// `?snapThumbs=debug` written to localStorage haunted every later /snapshot visit forever
// (2026-07-19). sessionStorage is the one lifetime that satisfies both, and any stale PERSISTENT
// copy left by that bug is PURGED on load.
const DEBUG_FLAG = 'inkwave:snapThumbsDebug'

let debugResolved: boolean | undefined

function resolveDebug(): boolean {
  if (typeof window === 'undefined') return false
  try {
    localStorage.removeItem(DEBUG_FLAG)                       // purge the pre-2026-07-19 haunting
    if (new URLSearchParams(window.location.search).get('snapThumbs') === 'debug') {
      sessionStorage.setItem(DEBUG_FLAG, '1')
      return true
    }
    return sessionStorage.getItem(DEBUG_FLAG) === '1'
  } catch {
    return false                                              // private window / denied storage
  }
}

/** `?snapThumbs=debug` — the on-device diagnostic overlay, for this browser session only. */
export function snapThumbsDebug(): boolean {
  if (debugResolved === undefined) debugResolved = resolveDebug()
  return debugResolved
}

/** Test-only: forget the resolved overlay state so a fresh URL can be read. */
export function _resetSnapThumbsDebug(): void { debugResolved = undefined }

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────────────────────

export function thumbKey(snapId: string, pane: ThumbPane, sig: string): string {
  return `${snapId}|${pane}|${sig}`
}

/** djb2 → hex; short, collision-tolerant filename/index hash. */
export function thumbHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16)
}

/** LRU eviction plan: least-recently-used keys first until `over` bytes are freed. Pure. */
export function planThumbEviction(items: Array<{ key: string; bytes: number; used: number }>, over: number): string[] {
  if (over <= 0) return []
  const out: string[] = []
  let freed = 0
  for (const it of [...items].sort((a, b) => a.used - b.used)) {
    if (freed >= over) break
    out.push(it.key)
    freed += it.bytes
  }
  return out
}

// ── OPFS index + store ────────────────────────────────────────────────────────────────────────

interface ThumbEntry { file: string; bytes: number; used: number }
interface ThumbIndex { loaded: boolean; loading?: Promise<void>; bytes: number; clock: number; entries: Record<string, ThumbEntry> }
const _index = new Map<string, ThumbIndex>()
const _idxTimer = new Map<string, ReturnType<typeof setTimeout>>()

function indexFor(docId: string): ThumbIndex {
  let idx = _index.get(docId)
  if (!idx) { idx = { loaded: false, bytes: 0, clock: 0, entries: {} }; _index.set(docId, idx) }
  return idx
}

async function readOpfsFile(path: string[]): Promise<Uint8Array | null> {
  try {
    let dir = await navigator.storage.getDirectory()
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
    const fh = await dir.getFileHandle(path[path.length - 1])
    return new Uint8Array(await (await fh.getFile()).arrayBuffer())
  } catch { return null }
}

async function deleteOpfsFile(path: string[]): Promise<void> {
  try {
    let dir = await navigator.storage.getDirectory()
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
    await dir.removeEntry(path[path.length - 1])
  } catch { /* best-effort */ }
}

/** Load a doc's thumbnail index into memory (once). Until this resolves, hasThumb returns false
 *  (the presenter falls back to on-demand render), so it's safe to call lazily. */
export async function loadThumbIndex(docId: string): Promise<void> {
  const idx = indexFor(docId)
  if (idx.loaded) return
  if (idx.loading) return idx.loading
  idx.loading = (async () => {
    const buf = await readOpfsFile(['documents', docId, 'thumbs', 'index.json'])
    if (buf) {
      try {
        const j = JSON.parse(new TextDecoder().decode(buf)) as { clock?: number; entries?: Record<string, ThumbEntry> }
        idx.entries = j.entries ?? {}
        idx.clock = j.clock ?? 0
        idx.bytes = Object.values(idx.entries).reduce((s, e) => s + e.bytes, 0)
      } catch { /* corrupt index → start fresh */ }
    }
    idx.loaded = true
  })()
  return idx.loading
}

/** Sync existence check against the in-memory index (false until loadThumbIndex resolved). */
export function hasThumb(docId: string, snapId: string, pane: ThumbPane, sig: string): boolean {
  const idx = _index.get(docId)
  if (!idx || !idx.loaded) return false
  return !!idx.entries[thumbKey(snapId, pane, sig)]
}

async function encodeThumb(src: CanvasImageSource, srcW: number, srcH: number, scale: number): Promise<Uint8Array | null> {
  const w = Math.max(1, Math.round(srcW * scale)), h = Math.max(1, Math.round(srcH * scale))
  try {
    let blob: Blob | null = null
    if (typeof OffscreenCanvas !== 'undefined') {
      const oc = new OffscreenCanvas(w, h)
      const ctx = oc.getContext('2d'); if (!ctx) return null
      ctx.drawImage(src, 0, 0, w, h)
      blob = await oc.convertToBlob({ type: 'image/webp', quality: QUALITY }) // encode off the main thread
    } else {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d'); if (!ctx) return null
      ctx.drawImage(src, 0, 0, w, h)
      blob = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/webp', QUALITY))
    }
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
  } catch { return null }
}

/** Encode + persist a pane thumbnail (idle, fire-and-forget). Dedupes on an existing sig. */
export async function putThumb(
  docId: string, snapId: string, pane: ThumbPane, sig: string,
  src: CanvasImageSource, srcW: number, srcH: number, scale: number,
): Promise<void> {
  if (!docId) return
  await loadThumbIndex(docId)
  const idx = indexFor(docId)
  const key = thumbKey(snapId, pane, sig)
  if (idx.entries[key]) { idx.entries[key].used = ++idx.clock; return } // already baked at this sig
  const buf = await encodeThumb(src, srcW, srcH, scale)
  if (!buf || !buf.length) return
  const file = `${thumbHash(key)}.webp`
  try { await writeOpfsFile(['documents', docId, 'thumbs', file], buf) } catch { return }
  idx.entries[key] = { file, bytes: buf.length, used: ++idx.clock }
  idx.bytes += buf.length
  enforceBudget(docId)
  scheduleIndexWrite(docId)
}

/** Read a pane thumbnail's WebP bytes (null if absent / signature miss). */
export async function getThumb(docId: string, snapId: string, pane: ThumbPane, sig: string): Promise<Blob | null> {
  await loadThumbIndex(docId)
  const idx = indexFor(docId)
  const key = thumbKey(snapId, pane, sig)
  const e = idx.entries[key]
  if (!e) return null
  e.used = ++idx.clock
  const buf = await readOpfsFile(['documents', docId, 'thumbs', e.file])
  if (!buf) { idx.bytes -= e.bytes; delete idx.entries[key]; return null } // index/disk drift → drop
  return new Blob([buf], { type: 'image/webp' })
}

function enforceBudget(docId: string): void {
  const idx = indexFor(docId)
  if (idx.bytes <= BUDGET) return
  const items = Object.entries(idx.entries).map(([key, e]) => ({ key, bytes: e.bytes, used: e.used }))
  for (const key of planThumbEviction(items, idx.bytes - BUDGET)) {
    const e = idx.entries[key]
    if (!e) continue
    idx.bytes -= e.bytes
    delete idx.entries[key]
    void deleteOpfsFile(['documents', docId, 'thumbs', e.file])
  }
}

function scheduleIndexWrite(docId: string): void {
  clearTimeout(_idxTimer.get(docId))
  _idxTimer.set(docId, setTimeout(() => { void writeIndex(docId) }, 1200))
}
async function writeIndex(docId: string): Promise<void> {
  const idx = indexFor(docId)
  try {
    await writeOpfsFile(['documents', docId, 'thumbs', 'index.json'],
      JSON.stringify({ clock: idx.clock, entries: idx.entries }))
  } catch { /* best-effort — reconstructable */ }
}

/** Distinct snapshots baked PER PANE (the `?snapThumbs=debug` sweep readout). Round 10: the sweep
 *  bakes doc + diff + map, so "21 thumbs" no longer says whether all three panes are covered —
 *  three separate counts do, and a lagging one is exactly the pane that will show a stale nearest. */
export function thumbPaneCounts(docId: string): Record<ThumbPane, number> {
  const idx = _index.get(docId)
  const out: Record<ThumbPane, number> = { doc: 0, diff: 0, map: 0 }
  if (!idx) return out
  const seen: Record<string, Set<string>> = { doc: new Set(), diff: new Set(), map: new Set() }
  for (const key of Object.keys(idx.entries)) {
    const [snapId, pane] = key.split('|')
    if (seen[pane]) seen[pane].add(snapId)
  }
  for (const k of ['doc', 'diff', 'map'] as ThumbPane[]) out[k] = seen[k].size
  return out
}

/** Test/diagnostic: current byte total + entry count for a doc. */
export function thumbStats(docId: string): { entries: number; bytes: number; loaded: boolean } {
  const idx = _index.get(docId)
  return { entries: idx ? Object.keys(idx.entries).length : 0, bytes: idx?.bytes ?? 0, loaded: !!idx?.loaded }
}
