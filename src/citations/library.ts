// The native citation library — device-scoped persistence in OPFS at library/citations.json.
// This is the WHOLE library (every saved source, cited or not). It is NOT part of any provenance
// hash — only the mode-resolved DISPLAYED subset (doc.bibliography) is hashed. See citations §3.
//
// bibProvider holds the in-memory mirror; this module hydrates it on load and persists on change.

import type { CSLItem, IwCitationMeta } from '../types/document'
import { bibProvider } from './bibProvider'

import { writeOpfsFile } from '../storage/opfsWrite'

const DIR = 'library'
const FILE = 'citations.json'

async function getDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(DIR, { create })
  } catch {
    return null
  }
}

async function readFile(): Promise<CSLItem[]> {
  try {
    const dir = await getDir(false)
    if (!dir) return []
    const file = await (await dir.getFileHandle(FILE)).getFile()
    const parsed = JSON.parse(await file.text())
    return Array.isArray(parsed) ? (parsed as CSLItem[]) : []
  } catch {
    return []
  }
}

async function writeFile(items: CSLItem[]): Promise<void> {
  const dir = await getDir(true) // ensures the dir exists / bails when OPFS is absent
  if (!dir) return
  // iOS-safe write (no createWritable on WebKit — worker sync-access fallback).
  await writeOpfsFile([DIR, FILE], JSON.stringify(items))
}

// ─── HYDRATION READINESS ──────────────────────────────────────────────────────────────────────
// CAUGHT ON PETER'S iPHONE 8 (2026-07-17, `?btDebug=1`). The break-table signature hashes the
// bibliography's CONTENT (correctly — a citation's box changes the wrap, and an epoch counter could
// never survive a reload). But the library hydrates ASYNCHRONOUSLY from OPFS, so anything that
// builds before it lands bakes an EMPTY-library signature into the key: measured `capa@0` at build
// and `capa@20` after the reload, on a device with 20 entries. Every later lookup then misses,
// FOREVER, silently — bug 1's ghost wearing a correct signature. The signature was right; the
// caller asked too early.
//
// THE SHAPE OF THE DEFECT (the same one the wave video hit in the same minute): a ONE-SHOT ASYNC
// SIGNAL WITH NO "HAS IT ALREADY HAPPENED?" CHECK. So readiness here is a latch, not an event:
//   • already done  → resolves immediately (a late asker is never stranded)
//   • in flight     → waits on the SAME promise (no second read, no duplicate setEntries)
//   • never started → STARTS it (a caller that only ever asks readiness cannot hang forever —
//                     which would be the identical stranding bug, just relocated)
// It resolves on FAILURE too: the contract is "the initial attempt has COMPLETED", not "a library
// exists". A device with no library legitimately has 0 entries, and that 0 is a real state that
// must be allowed to sign a table.
//
// NB `loadLibrary()` keeps its exact semantics — it still re-reads on every call, because callers
// use it to re-hydrate. Only the LATCH is memoised.
// THE PROMISE ITSELF IS THE LATCH — that is the whole mechanism, and it is why there is no
// `_done` flag here. A resolved promise resolves every later `await` immediately, forever; an
// explicit "has it already happened?" check beside it would be redundant, and MUTATION TESTING
// PROVED IT: removing such a check left every test green, because it never did anything. A guard
// no test can kill is not a guard — it is a comment that costs a branch. What DOES need the check
// is the START (below): a caller that only ever awaits must not hang forever waiting for a load
// nobody kicked off — the identical stranding bug, relocated one level up. That mutation DOES kill
// tests, which is how we know the branch is load-bearing.
let _libStarted = false
let _libResolve: (() => void) | null = null
let _libReady: Promise<void> = new Promise<void>((r) => { _libResolve = r })

/**
 * Resolves once the initial library hydration attempt has COMPLETED (success or failure).
 *
 * ANY CALLER THAT PUTS THE BIBLIOGRAPHY IN A PERSISTED KEY MUST AWAIT THIS FIRST. Building before
 * it resolves signs the table with an empty library and the cache can never hit again.
 */
export function libraryReady(): Promise<void> {
  if (!_libStarted) void loadLibrary().catch(() => {})
  return _libReady
}

/** Test seam: forget the latch (module state outlives a vitest file otherwise). */
export function _resetLibraryReady(): void {
  _libStarted = false
  _libReady = new Promise<void>((r) => { _libResolve = r })
}

/** Read the persisted library and load it into bibProvider. Call once on app/editor load. */
export async function loadLibrary(): Promise<void> {
  _libStarted = true
  try {
    const items = await readFile()
    if (items.length) bibProvider.setEntries(items, 'library')
  } finally {
    // ALWAYS latch — a completed ATTEMPT, not a successful one. NB readFile() swallows its own
    // OPFS errors and returns [], so it cannot throw; this `finally` guards the OTHER failure
    // (setEntries throwing on malformed data). That distinction was found by mutation testing: a
    // test that made the OPFS READ throw passed against a mutant with no `finally` at all, because
    // the read never throws — the test was measuring nothing. The guard is real; aim at the path
    // that can actually reach it.
    _libResolve?.()
  }
}

/** Write the current in-memory library to OPFS. */
export async function persistLibrary(): Promise<void> {
  await writeFile(bibProvider.getAll())
}

// Two entries are "the same source" when they share a DOI (or, lacking one, an identical title) —
// used to replace-in-place rather than mint a colliding citekey.
function sameSource(a: CSLItem, b: CSLItem): boolean {
  if (a.DOI && b.DOI) return String(a.DOI).toLowerCase() === String(b.DOI).toLowerCase()
  return !!a.title && a.title === b.title
}

/** A citekey not already taken by a DIFFERENT source. Appends -2, -3, … on collision. */
function freeCitekey(base: string, incoming: CSLItem): string {
  const existing = bibProvider.get(base)
  if (!existing || sameSource(existing, incoming)) return base
  let n = 2
  while (true) {
    const cand = `${base}-${n}`
    const e = bibProvider.get(cand)
    if (!e || sameSource(e, incoming)) return cand
    n++
  }
}

/**
 * Add (or replace) a source in the library. Resolves citekey collisions, updates bibProvider, and
 * persists. Returns the stored item (its `id` may be suffixed to avoid a collision).
 */
export async function addToLibrary(item: CSLItem): Promise<CSLItem> {
  const id = freeCitekey(item.id, item)
  let stored = id === item.id ? item : { ...item, id }
  // Preserve re-verification history (changelog / lastVerified / deadUrl) when the SAME source is
  // re-captured — e.g. the extension re-flushes its queue on every visit, and a fresh capture carries
  // no changelog. `??` keeps the incoming values when present (so a real re-verify still updates the
  // history) and otherwise falls back to the previous entry's, so a re-flush never wipes it.
  const prev = bibProvider.get(id)
  const prevIw = (prev as { _iw?: IwCitationMeta } | undefined)?._iw
  if (prev && prevIw && sameSource(prev, stored) && (prevIw.changelog || prevIw.lastVerified || prevIw.deadUrl != null)) {
    const curIw = (stored as { _iw?: IwCitationMeta })._iw ?? {}
    stored = { ...stored, _iw: {
      ...curIw,
      changelog: curIw.changelog ?? prevIw.changelog,
      lastVerified: curIw.lastVerified ?? prevIw.lastVerified,
      deadUrl: curIw.deadUrl ?? prevIw.deadUrl,
    } }
  }
  bibProvider.upsert(stored, 'library')
  await persistLibrary()
  return stored
}

/** Remove a source from the library and persist. Returns true if it existed. */
export async function removeFromLibrary(citekey: string): Promise<boolean> {
  const had = bibProvider.remove(citekey)
  if (had) await persistLibrary()
  return had
}
