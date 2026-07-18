import type { InkwaveDocument, TiptapJSON } from '../types/document'
import { writeOpfsFile } from './opfsWrite'
// The boundary predicate lives alone and TESTED (notFound.test.ts): it is the single line
// that separates 'absent' from 'could not find out', and a lenient edit to it makes the whole
// DocRead union perfectly typed and perfectly wrong. See notFound.ts.
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
 * THE BUG THIS TYPE EXISTS TO KILL (forensics, 2026-07-15 11:19:40 — Peter's real thesis). This
 * function used to end `catch { return null }`, which made a transient read failure
 * INDISTINGUISHABLE FROM "no such document". Edit.tsx answers null by falling through to
 * `newDocument()` and REPOINTING the active-doc pointer at the blank — so one unlucky read
 * presented Peter with an empty page where his honours proposal had been (doc `978e0772`,
 * createdAt == updatedAt, 0 chars). He then opened a `.studio` backup to recover from the blank,
 * got the stale twin, and THAT blind-overwrote Wednesday's work. The read bug CAUSED the open.
 *
 * The defect is not that the error went unlogged — it is that THE TYPE ERASED IT. `null` is the
 * honest answer to "is there a document here?" and the only answer available to "did the disk just
 * fail?", and the caller cannot tell which it got. This file already insists that WRITES stay loud
 * ("autosave failures must stay loud" — saveDocument deliberately throws). The read path was
 * silent. Same asymmetry as `current.json` being unguarded while snapshots are grow-only.
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
  // KNOWN-NEGATIVE seam: `window.__iwReadGuard = 'off'` restores the pre-fix swallow, so the
  // reproduction can produce the blank-document failure in the SAME build it proves fixed.
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
    // A corrupt file is emphatically NOT an absent one: answering null here would send Edit.tsx to
    // newDocument() and repoint the pointer away from a document whose bytes are still on disk and
    // may be recoverable (see OpfsInspector).
    throw new StorageReadError(filePath, err)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

// App-level JSON (recent folders, open-cache listings/index) is ALWAYS best-effort convenience
// state — so these never reject. In a private window `navigator.storage.getDirectory()` itself can
// throw (it sits OUTSIDE readJson's catch), and that must degrade to "no cache, network-only", not
// break the caller (the 2026-07-10 Firefox-private picker report). Document persistence
// (saveDocument below) deliberately KEEPS throwing — autosave failures must stay loud.

/**
 * Read a small app-level JSON file from the OPFS root (e.g. recent-folder choices).
 *
 * ⚠ CONVENIENCE STATE ONLY — this collapses "I could not read it" into "it isn't there", which is
 * the 2026-07-15 defect, accepted HERE and only here because the answer feeds a cache or a picker
 * list: the cost of being wrong is a re-fetch, never a lost row. **If a failure could reach a
 * WRITE, this is the wrong function** — use `readAppJsonStrict`. The ledger used to read through
 * here, and that is exactly how a transient read turned into a destroyed month (see below).
 */
export async function readAppJson<T>(name: string): Promise<T | null> {
  try { return await readJson<T>(await getRoot(), name) } catch { return null }
}

/**
 * Read a small app-level JSON file that is NOT convenience state — the writer's own records.
 *
 * The OPPOSITE contract to `readAppJson`, deliberately, and named so the difference is visible at
 * the call site: returns null ONLY when the file genuinely does not exist, and THROWS on any other
 * failure. `getRoot()` is inside the throw path on purpose — in a private window it rejects, and
 * "storage is unavailable" is emphatically not "you have no sessions this month".
 *
 * WHY IT EXISTS (auditor, 2026-07-17): `loadLedger` read through `readAppJson`, so one transient
 * OPFS failure answered "you have no rows". Its callers are read-modify-WRITE — `flushMonth` then
 * wrote the buffered rows ALONE over the month (its own comment: "Union first, always — never
 * write `rows` alone"), and `saveReflection` wrote a 0-row ledger, so saving a reflection could
 * erase the month it belonged to. No race required; a single failed read did it. The repo had
 * already SEEN this and fixed the instance, not the class: `email/testOpfsShim.ts` records "the
 * ledger read as merely EMPTY" and repaired the shim.
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
// THE ONE THING THIS APP MUST NEVER DO (2026-07-15, twice, on Peter's real thesis): let two writers
// on ONE document race and blind-overwrite each other. `saveDocument` is the whole-file replace with
// no union and no generation check — it is THE loss vector every guard in this file circles. The
// single-open lock (storage/tabDoc.ts + storage/singleOpen.ts) makes at most one live tab hold a
// document, and its "Take over here" handoff transfers that hold to a second tab. The handoff is only
// safe if the LOSING tab genuinely stops writing BEFORE the winning tab starts — otherwise the take-
// over reproduces the exact overwrite it exists to prevent.
//
// This freeze is that stop, and it lives HERE, at the single write funnel, on purpose: a UI that goes
// read-only is a promise; a `saveDocument` that refuses is a guarantee. When a tab surrenders a
// document (Web Locks stolen, or a BroadcastChannel take-over), `freezeDocWrites(id)` is called and
// from that instant NOTHING can persist a new body for that id from this tab. The winning tab only
// begins after it has the surrender ACK, so "loser stopped before winner started" is enforced at the
// bytes, not asserted in a comment.
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
 * single-open lock — surrendering it to another tab that is taking over. It ALSO drops any debounced
 * save already queued for `id`, so a beat armed a moment before the surrender cannot fire past it.
 */
export function freezeDocWrites(id: string): void {
  frozenDocIds.add(id)
  // A save queued for exactly this document must not slip through after the freeze. A beat for a
  // DIFFERENT document (none, in practice — a tab edits one doc — but be exact) is left alone.
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
  // THE INVARIANT, enforced at the funnel: a surrendered document is read-only here, no exceptions.
  // Throwing (not silently dropping) keeps this loud for any DIRECT caller (snapshots, cloud, music)
  // — none should reach a surrendered body; if one does, that is a bug worth a stack trace. The
  // autosave beat below catches this specific error and stays quiet, because there the refusal is
  // the intended read-only behaviour, not a failure to surface.
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
 * "There is no document here" and "I could not find out" are different facts with opposite
 * consequences — `absent` means it is safe to create/replace; `error` means NEVER write, because
 * the writer's work may be sitting right there. `readJson` used to answer `null` to both
 * (`catch { return null }`), Edit.tsx read that as absence, minted a blank document over the top of
 * Peter's honours proposal and repointed the active-doc pointer at it (2026-07-15 11:19:40). He
 * then opened a backup to recover from the blank, and THAT blind-overwrote Wednesday's work.
 *
 * **The defect was never a missing log — the TYPE erased the difference**, so every caller was one
 * honest mistake away from the bug, and the compiler had nothing to say. Throwing instead of
 * returning null is only half a fix: `await loadDocument(id).catch(() => null)` restores the bug in
 * eleven characters and still typechecks. (I wrote exactly that line while fixing this.)
 *
 * As a discriminated union the compiler forces every caller to say which of the three they mean.
 * Modelled on the ledger lane's `RemoteRead` (same shape, same reasoning, arrived at independently
 * for cloud sync). The shared RULE is: **never write to a target you have not just read, and never
 * treat a failed read as an absent one.** The shared rule is deliberately NOT a shared function — a
 * ledger is a SET (union it, grow-only), a document body is PROSE (it cannot be unioned; it needs a
 * staleness check). Making them look interchangeable is how the wrong one gets called.
 */
export type DocRead =
  | { kind: 'found'; doc: InkwaveDocument }
  | { kind: 'absent' } // genuinely not on disk — safe to create
  | { kind: 'error'; error: StorageReadError } // could not find out — NEVER write

/**
 * The RAW bytes of a document's `current.json`, with no parse and no interpretation.
 *
 * THE LAST RESORT, and the one that matters most. A document whose JSON will not parse is exactly
 * the document whose words the writer most needs back — and it is the one case `readDocument`
 * cannot help with, because there is nothing to return but an error. The bytes are still sitting
 * on disk with the prose legible inside them. OpfsInspector offers this as "Download raw" so a
 * corrupt document is a file the writer can salvage by hand (or send to me), rather than a row
 * that says "unreadable" and offers nothing. A recovery surface that lists the problem and gives
 * no way out is a dead end at precisely the moment it exists for.
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
 * This deliberately does NOT consult the IndexedDB meta index (`listMeta`). An ORPHANED document
 * is precisely one that OPFS has and the index does not surface (2026-07-17: one origin-wide
 * `inkwave:activeDocumentId` pointer let one tab re-point another, stranding the other tab's file
 * intact-but-unreachable). A recovery listing built from the index could never show it. Reading
 * the directory is the only way to see what is really there.
 *
 * One file read per document: `size`/`lastModified` come from the same File handle as the bytes,
 * so this costs one pass, not three. Per-document failures degrade to `doc: null` rather than
 * losing the whole listing — a corrupt file is still a document the writer may want back.
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
// PHONE INPUT PRIORITY (2026-07-09): the save beat is where the editor's LAZY doc build actually
// runs — full getJSON + embedBibliography + JSON.stringify, all main-thread and O(doc). At 200ms it
// fired in ordinary inter-word typing pauses on a phone CPU; 800ms waits for a genuine pause
// (trailing — every edit re-arms it), and the crash-loss window stays under a second. Desktop keeps
// 200ms. (Same coarse-pointer test as isTouchDevice — inlined so storage doesn't import editor code.)
const AUTOSAVE_DELAY_MS =
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse) and (hover: none)').matches
    ? 800
    : 200

// The pending save, exposed so flushPendingSave() can force it through (settings toggles reload
// the page — they MUST flush first; a debounced-away save was half an hour of Peter's work, 2026-07-10).
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
  // A surrendered document is read-only here (see freezeDocWrites). Drop the beat silently when we
  // can tell cheaply — a plain doc carries its id. A thunk is NOT evaluated just to check (that is
  // the expensive per-keystroke serialize this path exists to defer); its beat reaches saveDocument,
  // which throws DocWriteFrozenError, which the beat's catch treats as the intended quiet refusal.
  if (typeof doc !== 'function' && frozenDocIds.has(doc.id)) return
  pendingDoc = doc
  pendingOnSaved = onSaved
  deferSince = 0
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(async function beat() {
    // ZOOM-GESTURE DEFERRAL — BOUNDED (2026-07-10): while a zoom gesture holds (__iwZoomHold,
    // cleared at settle) push the beat back, but never beyond 3s total — a stuck flag must not
    // become silent data loss.
    const holding = typeof window !== 'undefined' && (window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold
    if (holding && (!deferSince || performance.now() - deferSince < 3000)) {
      if (!deferSince) deferSince = performance.now()
      saveTimer = setTimeout(beat, 250)
      return
    }
    deferSince = 0
    pendingDoc = null; pendingOnSaved = undefined
    try {
      // A thunk defers building the document snapshot to SAVE time (200ms after the last edit) —
      // the editor passes one so serialization never runs per keystroke (see ensureDocFresh).
      await saveDocument(typeof doc === 'function' ? doc() : doc)
      onSaved?.()
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('inkwave:doc-saved'))
    } catch (err) {
      // A surrendered document refusing to write is INTENDED read-only behaviour, not a failure to
      // shout about — the tab already shows it is open elsewhere. Firing save-failed here would alarm
      // the writer about the very thing they just chose ("Take over here" from the other window).
      if (err instanceof DocWriteFrozenError) return
      // NEVER swallow a genuinely failed autosave (iOS quota/handle errors) — the writer must not keep
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
