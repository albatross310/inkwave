// The native citation library — ⚠ PER DOCUMENT, at library/<documentId>/citations.json. Every source
// saved while working on one piece of writing, cited or not. NOT part of any provenance hash — only
// the mode-resolved DISPLAYED subset (doc.bibliography) is hashed. See citations §3.
//
// It used to be ONE library for the whole origin, so every new document opened carrying the last
// one's bibliography. The per-document file is the WORKING store (its own file, so no race with the
// document's save) and `document.library` in the export bundle is how it TRAVELS.
//
// ⚠ THE LEGACY DEVICE-WIDE FILE IS NEVER ADOPTED AUTOMATICALLY — auto-importing it into every
// document would reproduce the bug this fixes. `legacyLibrarySize()`/`importLegacyLibrary()` exist so
// a writer can pull their old sources in, once, on purpose.
//
// bibProvider holds the in-memory mirror; this module hydrates it on load and persists on change.
// → docs/archive/storage-and-sync.md#library

import type { CSLItem, IwCitationMeta } from '../types/document'
import { bibProvider } from './bibProvider'

import { writeOpfsFile } from '../storage/opfsWrite'
import { isNotFound } from '../storage/notFound'
import { tabDocId } from '../storage/tabDoc'

const DIR = 'library'
const FILE = 'citations.json'

/** The document whose library is loaded. ⚠ Read at CALL time, NEVER cached: a tab can switch
 *  documents, and a stale id would persist one document's sources into another's file — the bug
 *  this module was just fixed for, wearing a different hat. */
function libPath(): string[] {
  const id = tabDocId()
  return id ? [DIR, id, FILE] : [DIR, FILE] // no document yet ⇒ the legacy path, read-only in practice
}

async function getDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    let dir = await root.getDirectoryHandle(DIR, { create })
    const id = tabDocId()
    if (id) dir = await dir.getDirectoryHandle(id, { create })
    return dir
  } catch {
    return null
  }
}

/**
 * Read the persisted library — ⚠ `[]` ONLY for a genuine ABSENCE, THROWING on any other failure.
 * `writeFile` is a blind whole-file replace, so a read that answered "empty" on a fault let the next
 * `addToLibrary` — and the extension re-flushes its queue on every visit, with no user action —
 * write the near-empty in-memory set OVER the writer's real sources.
 * → docs/archive/storage-and-sync.md#lib-absent-vs-error
 */
async function readFile(docId?: string | null): Promise<CSLItem[]> {
  const id = docId === undefined ? tabDocId() : docId
  let dir: FileSystemDirectoryHandle
  try {
    dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: false })
    if (id) dir = await dir.getDirectoryHandle(id, { create: false })
  } catch (e) {
    if (isNotFound(e)) return [] // no library for this document yet — a genuine first-use absence
    throw e // OPFS unavailable / transient — we do NOT know what is on disk; never write over it
  }
  let text: string
  try {
    text = await (await dir.getFileHandle(FILE)).getFile().then((f) => f.text())
  } catch (e) {
    if (isNotFound(e)) return [] // directory exists but no file yet — still a genuine absence
    throw e
  }
  const parsed = JSON.parse(text) // a corrupt/truncated file THROWS here → error, never "empty"
  if (!Array.isArray(parsed)) throw new Error('library file is not a JSON array')
  return parsed as CSLItem[]
}

async function writeFile(items: CSLItem[]): Promise<void> {
  const dir = await getDir(true) // ensures the dir exists / bails when OPFS is absent
  if (!dir) return
  // iOS-safe write (no createWritable on WebKit — worker sync-access fallback).
  await writeOpfsFile(libPath(), JSON.stringify(items))
}

// ─── HYDRATION READINESS ──────────────────────────────────────────────────────────────────────
// ⚠ READINESS IS A LATCH, NOT AN EVENT — a one-shot async signal with no "has it already happened?"
// check strands every late asker, silently and forever (measured on Peter's iPhone 8: a break table
// signed `capa@0` before the library landed missed for the rest of the session). So: already done ⇒
// resolve now · in flight ⇒ the SAME promise · never started ⇒ START it, or a caller that only ever
// awaits hangs on a load nobody kicked off. It resolves on FAILURE too, because the contract is
// "the attempt COMPLETED", not "a library exists" — 0 entries is a real state that may sign a table.
//
// THE PROMISE ITSELF IS THE LATCH, which is why there is no `_done` flag beside it: a resolved
// promise already resolves every later await, and MUTATION TESTING PROVED such a check dead. The
// START check below is the one that kills tests, so it is the one that is load-bearing.
// → docs/archive/storage-and-sync.md#lib-hydration-latch
let _libStarted = false
let _libResolve: (() => void) | null = null
let _libReady: Promise<void> = new Promise<void>((r) => { _libResolve = r })

// TRUE once a hydration attempt FAILED to read the disk (as opposed to reading an empty/absent one).
// ⚠ `persistLibrary` REFUSES while this holds: we do not know what the file contains and the
// writer's real library may be in it. A later SUCCESSFUL read clears it. Starts false — a fresh page
// that has not tried to read has nothing on disk it could be shadowing.
let _libUnreadable = false

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
  _libUnreadable = false
  _libReady = new Promise<void>((r) => { _libResolve = r })
}

/** Read the persisted library and load it into bibProvider. Call once on app/editor load. */
export async function loadLibrary(): Promise<void> {
  _libStarted = true
  try {
    const items = await readFile() // throws on a real read failure; [] ONLY on a genuine absence
    // ⚠ SET UNCONDITIONALLY, INCLUDING EMPTY. With a library PER DOCUMENT an empty read means "this
    // document has no sources", so an `if (items.length)` guard leaves the PREVIOUS document's
    // entries in the tab-global provider — the bug being fixed. Only reached on a SUCCESSFUL read.
    bibProvider.setEntries(items, 'library')
    _libUnreadable = false // a completed, SUCCESSFUL read (even an empty one) — persist is safe now
  } catch {
    // We could NOT read it — do not hydrate, and BLOCK persists so the next mutation cannot
    // blind-overwrite a disk we never saw. The change stays in memory; a later successful load
    // re-enables writes.
    _libUnreadable = true
  } finally {
    // ⚠ ALWAYS latch — a completed ATTEMPT, success OR failure. Both the catch above and a
    // `setEntries` throw land here, so a builder awaiting `libraryReady()` is never stranded.
    _libResolve?.()
  }
}

/** Write the current in-memory library to OPFS. */
export async function persistLibrary(): Promise<void> {
  if (_libUnreadable) {
    // ⚠ The last hydration FAILED, so we do not know what the file holds and the writer's real
    // sources may be in it. REFUSE the write; a later successful loadLibrary() clears the flag.
    console.warn('[inkwave] library not persisted — it could not be read this session; not overwriting it')
    return
  }
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
  // ⚠ PRESERVE re-verification history when the SAME source is re-captured — the extension reflushes
  // its queue on every visit and a fresh capture carries no changelog, so `??` keeps a real re-verify
  // while a re-flush falls back to the previous entry's.
  // → docs/archive/storage-and-sync.md#lib-reverification
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


// ── LEGACY DEVICE-WIDE LIBRARY (pre-2026-08-28) ──────────────────────────────────────────────────
// Left on disk untouched. ⚠ NOTHING READS IT AUTOMATICALLY — that IS the fix — but a writer whose
// sources are all in it needs a way to bring them into the document that needs them.

/** How many sources sit in the old device-wide library. 0 when there isn't one (or it can't be
 *  read — an unreadable legacy file must not be advertised as importable). */
export async function legacyLibrarySize(): Promise<number> {
  try { return (await readFile(null)).length } catch { return 0 }
}

/** Copy the old device-wide library into THIS document's library, merging rather than replacing —
 *  a source already saved here keeps its citekey and its re-verification history. */
export async function importLegacyLibrary(): Promise<number> {
  const legacy = await readFile(null)
  let added = 0
  for (const item of legacy) {
    if (bibProvider.get(item.id)) continue
    bibProvider.upsert(item, 'library')
    added++
  }
  if (added) await persistLibrary()
  return added
}

/** Seed THIS document's library from a .studio that carried one (storage/openDoc.ts). Merge, never
 *  replace: the file may be a copy the writer has since added to on this device. */
export async function restoreLibraryFromBundle(items: CSLItem[] | undefined): Promise<void> {
  if (!items?.length) return
  let changed = false
  for (const item of items) {
    if (bibProvider.get(item.id)) continue
    bibProvider.upsert(item, 'library')
    changed = true
  }
  if (changed) await persistLibrary()
}
