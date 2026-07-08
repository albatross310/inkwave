// Single-file local save (M4). The writer saves ONE self-contained <name>.trace.json (content +
// snapshots + Bitcoin proofs + signed receipts, with the readable text header on top) to a name +
// location THEY choose, via the File System Access "save file" picker. The handle is persisted so
// subsequent auto-saves write back to the same file. Chromium only; other browsers fall back to a
// download (and/or OneDrive).

import type { InkwaveDocument, Snapshot } from '../types/document'
import { buildExportBundleWithPdfs, bundleFilename, composeTraceFile } from '../provenance/bundle'
import { parseTraceOffThread } from '../workers/parseClient'
import { mergeSnapshots, restoreSnapshotsFromBundle, needsWritebackMerge, markWritebackMerged } from '../provenance/snapshots'

const DB_NAME = 'inkwave-folder'
const STORE = 'handles'
// Per-DOCUMENT save handle, so each document remembers its own file (Open / Open Recent resume the
// right one). (Older builds used a single 'savefile' key.)
const keyFor = (docId: string) => `savefile:${docId}`

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => reject(r.error)
  })
}
async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
async function idbDel(key: string): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

type FileHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: string }) => Promise<PermissionState>
  requestPermission?: (d: { mode: string }) => Promise<PermissionState>
}

/** Is the File System Access "save file" picker available (Chromium)? */
export function fileSaveAvailable(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

/** Prompt the writer to choose a name + location for their single .trace.json (a user gesture);
 *  persist the handle and return it. */
export async function pickSaveFile(doc: InkwaveDocument): Promise<FileSystemFileHandle | null> {
  if (!fileSaveAvailable()) return null
  try {
    const handle = await (window as unknown as {
      showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle>
    }).showSaveFilePicker({ suggestedName: bundleFilename(doc) })
    await idbSet(keyFor(doc.id), handle)
    return handle
  } catch {
    return null // cancelled
  }
}

/** This document's save file if write permission is (re-)granted; else null. */
export async function getSaveFileHandle(docId: string, interactive = false): Promise<FileHandle | null> {
  if (!fileSaveAvailable()) return null
  const handle = await idbGet<FileHandle>(keyFor(docId))
  if (!handle) return null
  try {
    const opts = { mode: 'readwrite' }
    if ((await handle.queryPermission?.(opts)) === 'granted') return handle
    if (interactive && (await handle.requestPermission?.(opts)) === 'granted') return handle
  } catch { /* stale handle */ }
  return null
}

/** Does this document have a linked save file at all (regardless of current permission)? */
export async function hasSaveFile(docId: string): Promise<boolean> {
  return !!(await idbGet<FileHandle>(keyFor(docId)))
}

/** The linked file's name (the `name` property needs no permission), or null if none. For showing
 *  a "Reconnect to keep saving to <name>" state when write permission has lapsed. */
export async function getSaveFileName(docId: string): Promise<string | null> {
  const handle = await idbGet<FileHandle>(keyFor(docId))
  return handle?.name ?? null
}

export async function forgetSaveFile(docId: string): Promise<void> {
  await idbDel(keyFor(docId))
}

/** Persist an externally-obtained file handle (e.g. from "Open…") as this document's save target. */
export async function setSaveFileHandle(docId: string, handle: FileSystemFileHandle): Promise<void> {
  await idbSet(keyFor(docId), handle)
}

const WRITE_AT_KEY = (docId: string) => `inkwave:folderWriteAt:${docId}`

/** Multi-device guard, WITHOUT reading the (possibly 20 MB) file. We only need "did another device
 *  write it after us?" — the File's lastModified answers that against the time WE last wrote (recorded
 *  in writeBundleToFile). Reading + JSON-parsing the whole file here was a big load-time / 45s-interval
 *  CPU hit. Returns a foreign-session heartbeat only when the file changed well after our last write. */
export async function readLocalHeartbeat(docId: string): Promise<{ session?: string; exportedAt?: string } | null> {
  const handle = await getSaveFileHandle(docId, false)
  if (!handle) return null
  try {
    const file = await handle.getFile() // metadata only — no content read
    let ourWrite = 0
    try { ourWrite = Number(localStorage.getItem(WRITE_AT_KEY(docId))) || 0 } catch { /* private mode */ }
    if (ourWrite && file.lastModified > ourWrite + 4000) {
      return { session: 'other-device', exportedAt: new Date(file.lastModified).toISOString() }
    }
    return null // we wrote it last (or haven't written this session yet) → no conflict
  } catch {
    return null
  }
}

/** Warm the once-per-session grow-only merge at IDLE, without writing. The first mirror fires on a
 *  provenance checkpoint MID-TYPING, so paying the whole-file read+parse there was a typing spike.
 *  Healing OPFS here makes the local set the superset; the first real write then skips its merge. */
export async function preMergeSaveFile(docId: string): Promise<void> {
  const key = `folder:${docId}`
  if (!needsWritebackMerge(key)) return
  const handle = await getSaveFileHandle(docId, false)
  if (!handle) return
  try {
    const existing = await parseTraceOffThread(await (await handle.getFile()).text())
    if (existing.snapshots?.length) await restoreSnapshotsFromBundle(docId, existing.snapshots)
    markWritebackMerged(key)
  } catch { /* unreadable / new file → the first save retries its own merge */ }
}

/** Write the current bundle to the document's chosen file (silent — no prompt). True on success. */
export async function writeBundleToFile(doc: InkwaveDocument, snapshots: Snapshot[]): Promise<boolean> {
  const handle = await getSaveFileHandle(doc.id, false)
  if (!handle) return false
  try {
    // GROW-ONLY: never let a write shrink the file's archived history. Read the file's snapshots and
    // union them in first — but ONLY once per session (reading+parsing a large file on every save is
    // the "occasional typing lag"; after the first union the local set is already the superset).
    let merged = snapshots
    const key = `folder:${doc.id}`
    if (needsWritebackMerge(key)) {
      try {
        const existing = await parseTraceOffThread(await (await handle.getFile()).text())
        if (existing.snapshots?.length) merged = mergeSnapshots(existing.snapshots, snapshots)
        markWritebackMerged(key)
      } catch { /* new / unreadable file → write the local set as-is; retry the merge next save */ }
    }
    // Self-contained write (PDFs embedded) — buildExportBundleWithPdfs reuses a per-PDF base64 cache so
    // it doesn't re-encode unchanged PDFs on every save (the ~20 MB re-encode was the lag). The initial
    // save-on-load is also skipped upstream, so nothing encodes until the doc actually changes.
    const writable = await handle.createWritable()
    await writable.write(composeTraceFile(await buildExportBundleWithPdfs(doc, merged)))
    await writable.close()
    try { localStorage.setItem(WRITE_AT_KEY(doc.id), String(Date.now())) } catch { /* private mode */ } // heartbeat baseline
    if (merged.length > snapshots.length) await restoreSnapshotsFromBundle(doc.id, merged) // heal OPFS
    return true
  } catch {
    return false
  }
}
