import type { InkwaveDocument, TiptapJSON } from '../types/document'
import { writeOpfsFile } from './opfsWrite'
// ⚠ The boundary predicate lives alone and TESTED (notFound.test.ts): it is the single line that
// separates 'absent' from 'could not find out', and a lenient edit to it makes the whole DocRead
// union perfectly typed and perfectly wrong. → docs/archive/storage-and-sync.md#opfs-failed-read
import { isNotFound } from './notFound'

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

/**
 * A read that FAILED — as opposed to a file that is not there.
 *
 * ⚠ A FAILED READ IS NOT AN ABSENT DOCUMENT. `null` answers "is there a document here?"; nothing
 * answers "did the disk just fail?" — so a swallowed error reaches Edit.tsx as absence, which mints
 * a blank over the writer's work. The type must keep the two apart.
 * → docs/archive/storage-and-sync.md#opfs-failed-read
 */
export class StorageReadError extends Error {
  constructor(public readonly path: string, public readonly cause: unknown) {
    super(`Could not read ${path}: ${String((cause as Error)?.message ?? cause)}`)
    this.name = 'StorageReadError'
  }
}


/**
 * Read a JSON file. Returns null ONLY when the file genuinely does not exist; THROWS
 * StorageReadError on any other failure (transient I/O, permissions, corrupt JSON).
 *
 * Callers must decide deliberately what a failure means for them — the one thing none of them may
 * do is mistake it for absence.
 */
async function readJson<T>(
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<T | null> {
  // KNOWN-NEGATIVE seam: `window.__iwReadGuard = 'off'` restores the pre-fix swallow, so the repro
  // produces the blank-document failure in the SAME build it proves fixed.
  const legacy = typeof window !== 'undefined'
    && (window as unknown as { __iwReadGuard?: string }).__iwReadGuard === 'off'
  let text: string
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
    text = await file.text()
  } catch (err) {
    if (legacy) return null
    if (isNotFound(err)) return null // no such file — the one honest null
    throw new StorageReadError(filePath, err)
  }
  try {
    return JSON.parse(text) as T
  } catch (err) {
    if (legacy) return null
    // ⚠ A CORRUPT FILE IS NOT AN ABSENT ONE — null here would send Edit.tsx to newDocument() and
    // repoint the pointer away from bytes still on disk and still recoverable (OpfsInspector).
    throw new StorageReadError(filePath, err)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

// App-level JSON (recent folders, open-cache listings/index) is ALWAYS best-effort convenience
// state — so these never reject; `getRoot()` itself throws in a private window and that must
// degrade to "no cache, network-only". Document persistence (saveDocument below) deliberately KEEPS
// throwing — autosave failures must stay loud. → docs/archive/storage-and-sync.md#opfs-app-json

/**
 * Read a small app-level JSON file from the OPFS root (e.g. recent-folder choices).
 *
 * ⚠ CONVENIENCE STATE ONLY — this collapses "I could not read it" into "it isn't there", which is
 * the 2026-07-15 defect, accepted here alone because the answer feeds a cache or a picker list and
 * the cost of being wrong is a re-fetch. **If a failure could reach a WRITE, this is the wrong
 * function** — use `readAppJsonStrict`.
 */
export async function readAppJson<T>(name: string): Promise<T | null> {
  try { return await readJson<T>(await getRoot(), name) } catch { return null }
}

/**
 * Read a small app-level JSON file that is NOT convenience state — the writer's own records.
 *
 * ⚠ THE OPPOSITE CONTRACT to `readAppJson`, and named so the difference is visible at the call site:
 * null ONLY when the file genuinely does not exist, THROWS on any other failure. `getRoot()` is
 * inside the throw path on purpose — "storage is unavailable" is not "you have no sessions this
 * month". Anything read-modify-WRITE must read through here.
 * → docs/archive/storage-and-sync.md#opfs-app-json
 */
export async function readAppJsonStrict<T>(name: string): Promise<T | null> {
  return readJson<T>(await getRoot(), name)
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

// ─── The single-open write freeze (the anti-overwrite invariant) ───────────────
//
// ⚠ A TAKE-OVER IS ENFORCED AT THE BYTES, NOT ASSERTED. `saveDocument` is a whole-file replace with
// no union and no generation check, so the "Take over here" handoff is only safe if the LOSING tab
// stops writing BEFORE the winner starts. The freeze lives HERE, at the single write funnel, for
// exactly that reason: a UI that goes read-only is a promise; a saveDocument that refuses is a
// guarantee. → docs/archive/storage-and-sync.md#opfs-write-freeze
const frozenDocIds = new Set<string>()

/** Thrown by `saveDocument` for a document this tab has surrendered. Distinct so the autosave beat
 *  can tell an INTENTIONAL read-only refusal from a genuine storage failure and stay quiet. */
export class DocWriteFrozenError extends Error {
  constructor(public readonly documentId: string) {
    super(`Refusing to write ${documentId}: this document is open in another window (read-only here).`)
    this.name = 'DocWriteFrozenError'
  }
}

/**
 * Stop this tab persisting a new body for `id`. Idempotent. Called when this tab loses the document's
 * single-open lock. It MUST also drop any debounced save already queued for `id`, or a beat armed a
 * moment before the surrender fires past it.
 */
export function freezeDocWrites(id: string): void {
  frozenDocIds.add(id)
  // A beat for a DIFFERENT document (none, in practice — a tab edits one doc — but be exact) is
  // left alone.
  if (saveTimer !== null && pendingDoc !== null) {
    const queuedId = typeof pendingDoc === 'function' ? pendingDoc().id : pendingDoc.id
    if (queuedId === id) { clearTimeout(saveTimer); saveTimer = null; pendingDoc = null; pendingOnSaved = undefined }
  }
}

/** Undo a freeze (the document is this tab's to write again). Used by tests and by "Open a copy",
 *  which changes the id anyway; the original id may be reclaimed later by a fresh open/reload. */
export function unfreezeDocWrites(id: string): void {
  frozenDocIds.delete(id)
}

/** Whether this tab is currently refusing to write `id`. */
export function isDocWriteFrozen(id: string): boolean {
  return frozenDocIds.has(id)
}

export async function saveDocument(doc: InkwaveDocument): Promise<void> {
  // THE INVARIANT, at the funnel: a surrendered document is read-only here, no exceptions. THROW
  // rather than silently drop — a DIRECT caller (snapshots, cloud, music) reaching a surrendered
  // body is a bug worth a stack trace; only the autosave beat below may treat it as quiet.
  if (frozenDocIds.has(doc.id)) throw new DocWriteFrozenError(doc.id)
  requestPersistence() // Safari evicts un-persisted storage after 7 days of non-use
  const root = await getRoot()
  const write = await writeJson(root, currentPath(doc.id))
  await write(doc)
}

/** Load a document from OPFS. Returns null if it doesn't exist. */
/**
 * The result of trying to read a document. **THERE IS NO `null` MEMBER, AND THAT IS THE POINT.**
 *
 * ⚠ NEVER WRITE TO A TARGET YOU HAVE NOT JUST READ, AND NEVER TREAT A FAILED READ AS AN ABSENT ONE.
 * Throwing is only half the fix — `await loadDocument(id).catch(() => null)` restores the bug in
 * eleven characters and still typechecks — so the union makes every caller say which it means.
 * NOT shared with the ledger's `RemoteRead` on purpose: a ledger is a SET (union it), a document
 * body is PROSE (it needs a staleness check), and making them interchangeable is how the wrong one
 * gets called. → docs/archive/storage-and-sync.md#opfs-failed-read
 */
export type DocRead =
  | { kind: 'found'; doc: InkwaveDocument }
  | { kind: 'absent' } // genuinely not on disk — safe to create
  | { kind: 'error'; error: StorageReadError } // could not find out — NEVER write

/**
 * The RAW bytes of a document's `current.json`, with no parse and no interpretation.
 *
 * THE LAST RESORT: a document whose JSON will not parse is the one whose words the writer most
 * needs back, and the one case `readDocument` can only answer with an error. OpfsInspector offers
 * these bytes as "Download raw" — a recovery surface that lists the problem and offers no way out
 * is a dead end at precisely the moment it exists for.
 * → docs/archive/storage-and-sync.md#opfs-raw-bytes
 */
export async function readDocumentBytes(documentId: string): Promise<Blob | null> {
  try {
    const root = await getRoot()
    let dir: FileSystemDirectoryHandle = root
    for (const part of docDir(documentId).split('/')) dir = await dir.getDirectoryHandle(part)
    return await (await dir.getFileHandle('current.json')).getFile()
  } catch {
    return null // nothing readable at any level — the caller shows no button
  }
}

/** Read a document. Callers must handle all three outcomes; see DocRead. */
export async function readDocument(documentId: string): Promise<DocRead> {
  try {
    const root = await getRoot()
    const doc = await readJson<InkwaveDocument>(root, currentPath(documentId))
    return doc ? { kind: 'found', doc } : { kind: 'absent' }
  } catch (err) {
    // getRoot() itself throws in a private window — that is emphatically not "you have no work".
    return { kind: 'error', error: err instanceof StorageReadError ? err : new StorageReadError(currentPath(documentId), err) }
  }
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

/** One document as STORAGE actually holds it — see listOpfsDocuments. */
export interface OpfsDocEntry {
  id: string
  /** Bytes of `current.json` on disk. */
  size: number
  /** The file's own mtime (ms) — survives even when the JSON is unparseable. */
  lastModified: number
  /** Parsed contents, or null when the file is missing/corrupt (the dir still exists). */
  doc: InkwaveDocument | null
}

/**
 * Enumerate `documents/` DIRECTLY — the ground truth of what this origin is storing.
 *
 * ⚠ NEVER build this listing from the IndexedDB meta index: an ORPHANED document is precisely one
 * OPFS has and the index does not surface, so a recovery listing off the index could never show it.
 * A per-document failure degrades to `doc: null` rather than losing the whole listing — a corrupt
 * file is still a document the writer may want back.
 * → docs/archive/storage-and-sync.md#opfs-list-direct
 */
export async function listOpfsDocuments(): Promise<OpfsDocEntry[]> {
  let docsDir: FileSystemDirectoryHandle
  try {
    docsDir = await (await getRoot()).getDirectoryHandle('documents')
  } catch {
    return [] // no documents/ yet, or private mode with no OPFS at all
  }
  const out: OpfsDocEntry[] = []
  for (const id of await listDocumentIds()) {
    try {
      const dir = await docsDir.getDirectoryHandle(id)
      const file = await (await dir.getFileHandle('current.json')).getFile()
      let doc: InkwaveDocument | null = null
      try { doc = JSON.parse(await file.text()) as InkwaveDocument } catch { /* corrupt — still list it */ }
      out.push({ id, size: file.size, lastModified: file.lastModified, doc })
    } catch {
      out.push({ id, size: 0, lastModified: 0, doc: null }) // dir with no current.json
    }
  }
  return out
}

// ─── Debounced autosave ───────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null
// PHONE INPUT PRIORITY: the beat is where the editor's LAZY doc build runs (getJSON +
// embedBibliography + stringify, main-thread and O(doc)), so the phone waits for a genuine pause
// and desktop keeps 200ms. → docs/archive/storage-and-sync.md#opfs-autosave-beat
const AUTOSAVE_DELAY_MS =
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse) and (hover: none)').matches
    ? 800
    : 200

// ⚠ The pending save, exposed so flushPendingSave() can force it through: anything that reloads the
// page MUST flush first — a debounced-away save was half an hour of Peter's work.
let pendingDoc: InkwaveDocument | (() => InkwaveDocument) | null = null
let pendingOnSaved: (() => void) | undefined
let deferSince = 0

/** Run any pending debounced save NOW. Resolves true if a save ran, false if none pending.
 *  THROWS on save failure — callers about to reload must abort. */
export async function flushPendingSave(): Promise<boolean> {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  if (!pendingDoc) return false
  const d = pendingDoc; const cb = pendingOnSaved
  pendingDoc = null; pendingOnSaved = undefined
  await saveDocument(typeof d === 'function' ? d() : d)
  cb?.()
  return true
}

export function scheduleSave(
  doc: InkwaveDocument | (() => InkwaveDocument),
  onSaved?: () => void,
): void {
  // A surrendered document is read-only here (see freezeDocWrites). Drop the beat only when we can
  // tell CHEAPLY — a thunk is never evaluated just to check, since that is the per-keystroke
  // serialize this path exists to defer; its beat reaches saveDocument and the throw does the work.
  if (typeof doc !== 'function' && frozenDocIds.has(doc.id)) return
  pendingDoc = doc
  pendingOnSaved = onSaved
  deferSince = 0
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(async function beat() {
    // ZOOM-GESTURE DEFERRAL — BOUNDED: push the beat back while a zoom gesture holds, but ⚠ never
    // beyond 3s total. A stuck flag must not become silent data loss.
    const holding = typeof window !== 'undefined' && (window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold
    if (holding && (!deferSince || performance.now() - deferSince < 3000)) {
      if (!deferSince) deferSince = performance.now()
      saveTimer = setTimeout(beat, 250)
      return
    }
    deferSince = 0
    pendingDoc = null; pendingOnSaved = undefined
    try {
      // A thunk defers building the document snapshot to SAVE time, so serialization never runs
      // per keystroke (see ensureDocFresh).
      await saveDocument(typeof doc === 'function' ? doc() : doc)
      onSaved?.()
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('inkwave:doc-saved'))
    } catch (err) {
      // A surrendered document refusing to write is INTENDED read-only behaviour — save-failed here
      // would alarm the writer about the very thing they just chose ("Take over here").
      if (err instanceof DocWriteFrozenError) return
      // ⚠ NEVER swallow a genuinely failed autosave (iOS quota/handle errors) — the writer must not
      // keep typing into a document that stopped persisting. UI listens on this event.
      console.error('[inkwave] autosave failed:', err)
      window.dispatchEvent(new CustomEvent('inkwave:save-failed', { detail: { error: String((err as Error)?.message ?? err) } }))
    }
  }, AUTOSAVE_DELAY_MS)
}

// (The Week-3 appendEventLog stub that lived here was deleted 2026-07-08 — if a per-event log is
// ever needed, design it append-friendly from the start.
// → docs/archive/storage-and-sync.md#opfs-deleted-eventlog)

// ─── Helper: default empty TiptapJSON document ────────────────────────────────

export function emptyTiptapDoc(): TiptapJSON {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}
