// The native citation library — device-scoped persistence in OPFS at library/citations.json.
// This is the WHOLE library (every saved source, cited or not). It is NOT part of any provenance
// hash — only the mode-resolved DISPLAYED subset (doc.bibliography) is hashed. See citations §3.
//
// bibProvider holds the in-memory mirror; this module hydrates it on load and persists on change.

import type { CSLItem, IwCitationMeta } from '../types/document'
import { bibProvider } from './bibProvider'

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
  const dir = await getDir(true)
  if (!dir) return
  const handle = await dir.getFileHandle(FILE, { create: true })
  const w = await handle.createWritable()
  await w.write(JSON.stringify(items))
  await w.close()
}

/** Read the persisted library and load it into bibProvider. Call once on app/editor load. */
export async function loadLibrary(): Promise<void> {
  const items = await readFile()
  if (items.length) bibProvider.setEntries(items, 'library')
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
