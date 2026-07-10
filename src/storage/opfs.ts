import type { InkwaveDocument, TiptapJSON } from '../types/document'
import { writeOpfsFile } from './opfsWrite'

// ─── Path helpers ─────────────────────────────────────────────────────────────

function docDir(documentId: string) {
  return `documents/${documentId}`
}

function currentPath(documentId: string) {
  return `${docDir(documentId)}/current.json`
}

// ─── Low-level OPFS helpers ───────────────────────────────────────────────────

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function ensureDir(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/')
  let handle: FileSystemDirectoryHandle = root
  for (const part of parts) {
    handle = await handle.getDirectoryHandle(part, { create: true })
  }
  return handle
}

async function writeJson(
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<(data: unknown) => Promise<void>> {
  const parts = filePath.split('/')
  const fileName = parts.pop()!
  const dirPath = parts.join('/')
  if (dirPath) await ensureDir(root, dirPath) // keep dir creation semantics for callers
  return async (data: unknown) => {
    // iOS-safe write (no createWritable on WebKit — worker sync-access fallback).
    await writeOpfsFile([...(dirPath ? dirPath.split('/') : []), fileName], JSON.stringify(data))
  }
}

async function readJson<T>(
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<T | null> {
  try {
    const parts = filePath.split('/')
    const fileName = parts.pop()!
    const dirPath = parts.join('/')
    let dir: FileSystemDirectoryHandle = root
    for (const part of dirPath.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(part)
    }
    const fileHandle = await dir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

// App-level JSON (recent folders, open-cache listings/index) is ALWAYS best-effort convenience
// state — so these never reject. In a private window `navigator.storage.getDirectory()` itself can
// throw (it sits OUTSIDE readJson's catch), and that must degrade to "no cache, network-only", not
// break the caller (the 2026-07-10 Firefox-private picker report). Document persistence
// (saveDocument below) deliberately KEEPS throwing — autosave failures must stay loud.

/** Read a small app-level JSON file from the OPFS root (e.g. recent-folder choices). */
export async function readAppJson<T>(name: string): Promise<T | null> {
  try { return await readJson<T>(await getRoot(), name) } catch { return null }
}

/** Write a small app-level JSON file to the OPFS root. Best-effort — never throws. */
export async function writeAppJson(name: string, data: unknown): Promise<void> {
  try {
    const write = await writeJson(await getRoot(), name)
    await write(data)
  } catch { /* private mode / quota — convenience state only */ }
}

/** Save the full document to OPFS. */
let _persistRequested = false
function requestPersistence(): void {
  if (_persistRequested) return
  _persistRequested = true
  try { void navigator.storage?.persist?.() } catch { /* unsupported */ }
}

export async function saveDocument(doc: InkwaveDocument): Promise<void> {
  requestPersistence() // Safari evicts un-persisted storage after 7 days of non-use
  const root = await getRoot()
  const write = await writeJson(root, currentPath(doc.id))
  await write(doc)
}

/** Load a document from OPFS. Returns null if it doesn't exist. */
export async function loadDocument(
  documentId: string,
): Promise<InkwaveDocument | null> {
  const root = await getRoot()
  return readJson<InkwaveDocument>(root, currentPath(documentId))
}

/** List all document IDs stored in OPFS. */
export async function listDocumentIds(): Promise<string[]> {
  try {
    const root = await getRoot()
    const docsDir = await root.getDirectoryHandle('documents')
    const ids: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const name of (docsDir as any).keys()) {
      ids.push(name)
    }
    return ids
  } catch {
    return []
  }
}

// ─── Debounced autosave ───────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null
// PHONE INPUT PRIORITY (2026-07-09): the save beat is where the editor's LAZY doc build actually
// runs — full getJSON + embedBibliography + JSON.stringify, all main-thread and O(doc). At 200ms it
// fired in ordinary inter-word typing pauses on a phone CPU; 800ms waits for a genuine pause
// (trailing — every edit re-arms it), and the crash-loss window stays under a second. Desktop keeps
// 200ms. (Same coarse-pointer test as isTouchDevice — inlined so storage doesn't import editor code.)
const AUTOSAVE_DELAY_MS =
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse) and (hover: none)').matches
    ? 800
    : 200

export function scheduleSave(
  doc: InkwaveDocument | (() => InkwaveDocument),
  onSaved?: () => void,
): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(async function beat() {
    // ZOOM-GESTURE DEFERRAL: a pre-zoom edit's autosave beat (doc serialize + OPFS write) must
    // not land mid-gesture — while a zoom gesture holds the painters (__iwZoomHold, cleared at
    // settle), push the beat back; it flushes ≤250ms after the gesture settles.
    if (typeof window !== 'undefined' && (window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold) {
      saveTimer = setTimeout(beat, 250)
      return
    }
    try {
      // A thunk defers building the document snapshot to SAVE time (200ms after the last edit) —
      // the editor passes one so serialization never runs per keystroke (see ensureDocFresh).
      await saveDocument(typeof doc === 'function' ? doc() : doc)
      onSaved?.()
    } catch (err) {
      // NEVER swallow a failed autosave (iOS quota/handle errors) — the writer must not keep
      // typing into a document that stopped persisting. UI listens on this event.
      console.error('[inkwave] autosave failed:', err)
      window.dispatchEvent(new CustomEvent('inkwave:save-failed', { detail: { error: String((err as Error)?.message ?? err) } }))
    }
  }, AUTOSAVE_DELAY_MS)
}

// (The Week-3 appendEventLog stub that lived here was deleted 2026-07-08: zero callers, and its
// read-whole-file-per-append pattern was an O(n²) trap. The provenance record is snapshots +
// signed receipts; if a per-event log is ever needed, design it append-friendly from the start.)

// ─── Helper: default empty TiptapJSON document ────────────────────────────────

export function emptyTiptapDoc(): TiptapJSON {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}
