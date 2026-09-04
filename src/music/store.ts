// ─── Piece persistence — through the DOCUMENT, not beside it ─────────────────
//
// ⚠ A PIECE IS AN ORDINARY DOCUMENT (`piece.id === doc.id`). This file used to write a SECOND
// container at `music/<id>/piece.json`, and the cost was concrete: no edit history, no provenance
// hashing, no session capture and no cloud sync, because those happen to DOCUMENTS. `savePiece`/
// `loadPiece` are thin wrappers over the real store, and the old location holds only data to
// migrate OUT. Do not grow a parallel container — and note that `listPieceIds` is DELETED rather
// than moved: answering "which piece?" by scanning every document on disk is the whole-file-scan
// class CLAUDE.md forbids, and a Piece-as-document does not have the question.
//
// ⚠️ STORAGE POSTURE: documents are written to OPFS in the clear. There is NO at-rest encryption in
// this build. Do not write copy claiming there is.
// → docs/archive/music-module-build.md#piecestore

import { v4 as uuidv4 } from 'uuid'
import { readDocument, saveDocument } from '../storage/opfs'
import { writeOpfsFile } from '../storage/opfsWrite'
import { isPieceDocument, newPieceDocument, withPieceTitle } from './newPieceDocument'
import type { AssetRef, Piece } from './types'

const ROOT = 'music'

// The asset path is UNCHANGED by the migration, deliberately: `piece.id === doc.id`, so
// `music/<id>/assets/<ref>` names the same bytes it always did and an older Piece keeps its pages
// without one byte moving — only the JSON describing them relocates.
function assetPath(pieceId: string, ref: AssetRef): string[] { return [ROOT, pieceId, 'assets', ref] }
function legacyPiecePath(pieceId: string): string[] { return [ROOT, pieceId, 'piece.json'] }

// ─── Low-level OPFS ──────────────────────────────────────────────────────────

async function readFile(path: string[]): Promise<File | null> {
  try {
    let dir = await navigator.storage.getDirectory()
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
    const handle = await dir.getFileHandle(path[path.length - 1])
    return await handle.getFile()
  } catch {
    return null
  }
}

async function removeFile(path: string[]): Promise<void> {
  try {
    let dir = await navigator.storage.getDirectory()
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
    await dir.removeEntry(path[path.length - 1])
  } catch { /* already gone — the migration is idempotent */ }
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/**
 * Save a Piece by saving its DOCUMENT.
 *
 * ⚠️ NEVER WRITE TO A TARGET YOU HAVE NOT JUST READ, AND NEVER TREAT A FAILED READ AS AN ABSENT ONE
 * — `DocRead`'s rule, which the first version of this function broke in eleven characters
 * (`loadDocument(id) ?? newPieceDocument()` minted a blank over a real Piece on any read error).
 * THROWS on a failed read AND a failed write: a silent save failure is data loss.
 *
 * ⚠ THE TITLE IS `withPieceTitle`'S JOB, never inlined here — an inline copy and that function had
 * DIFFERENT semantics for a blank title, with the live one undocumented.
 * → docs/archive/music-module-build.md#store-read-before-write
 */
export async function savePiece(piece: Piece): Promise<void> {
  const read = await readDocument(piece.id)
  if (read.kind === 'error') {
    // Could not find out whether a document is there. The one thing we must not do is write.
    throw read.error
  }
  const doc = read.kind === 'found' ? read.doc : newPieceDocument({ title: piece.title })
  await saveDocument(withPieceTitle({
    ...doc,
    // `piece.id` is authoritative: a freshly minted document carries its own uuid, which would
    // orphan every asset already written under `piece.id`.
    id: piece.id,
    docType: 'music',
    piece: { ...piece, updated_at: new Date().toISOString() },
  }, piece.title))
}

/**
 * Load a Piece from its document. `null` means the document is genuinely NOT THERE — safe to create
 * one. ⚠ A failed READ THROWS: if a read error read as "no piece", the studio would open an empty
 * Piece over a real one and the student would annotate into the replacement. Absence and ignorance
 * are different answers. → docs/archive/music-module-build.md#store-read-before-write
 */
export async function loadPiece(pieceId: string): Promise<Piece | null> {
  const read = await readDocument(pieceId)
  if (read.kind === 'error') throw read.error
  if (read.kind === 'absent') return null
  // ⚠ `isPieceDocument` is THE definition of "is this a Piece?" — inlining a copy is how a predicate
  // documented as "the ONE definition" ends up with no callers.
  return isPieceDocument(read.doc) ? read.doc.piece ?? null : null
}

// ─── The legacy migration ────────────────────────────────────────────────────

/**
 * Move a Piece out of the old parallel container and into its document. IDEMPOTENT AND ONE-WAY —
 * ⚠ the DELETE is what makes it a migration rather than a fork with two writers, since two copies of
 * one Piece produce "my annotation came back after I deleted it".
 *
 * ⚠ THE DOCUMENT WINS A TIE: a legacy file beside a document that already has a Piece is stale by
 * construction, and overwriting live data with an older snapshot is the 2026-07-05 truncation
 * incident's shape. → docs/archive/music-module-build.md#store-migration
 */
export async function migrateLegacyPiece(pieceId: string): Promise<boolean> {
  const f = await readFile(legacyPiecePath(pieceId))
  if (!f) return false
  let legacy: Piece | null = null
  try { legacy = JSON.parse(await f.text()) as Piece } catch { legacy = null }
  if (!legacy) { await removeFile(legacyPiecePath(pieceId)); return false }

  const read = await readDocument(pieceId)
  if (read.kind === 'error') return false   // could not find out — leave the legacy file alone
  const doc = read.kind === 'found' ? read.doc : null
  if (doc?.piece) {
    // Already migrated (or written fresh). Drop the stale copy; never clobber the live one.
    await removeFile(legacyPiecePath(pieceId))
    return false
  }
  await savePiece({ ...legacy, id: pieceId })
  await removeFile(legacyPiecePath(pieceId))
  return true
}

/**
 * Every id that still has a legacy piece file. ⚠ The ONLY reason this walks the old directory is to
 * EMPTY it. It is not a piece index and must not become one.
 */
export async function legacyPieceIds(): Promise<string[]> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(ROOT)
    const ids: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind !== 'directory') continue
      if (await readFile(legacyPiecePath(name))) ids.push(name)
    }
    return ids
  } catch {
    return []
  }
}

/** Drain the old container. Safe to call on every open; does nothing once empty. */
export async function migrateLegacyPieces(): Promise<string[]> {
  const done: string[] = []
  for (const id of await legacyPieceIds()) {
    if (await migrateLegacyPiece(id)) done.push(id)
  }
  return done
}

// ─── Assets ──────────────────────────────────────────────────────────────────
//
// Page images stay OUT of the document JSON, referenced by `AssetRef` — the treatment PDFs already
// get. Inlining base64 puts a decode of every page on the open path, the class of bug that cost this
// app ~10s per load.
//
// ⚠️ TO BE TAKEN FROM THE MEDIA LANE, NOT KEPT. That lane owns getting bytes in, and "turn this photo
// into a piece" READS an asset it already put there. These primitives stand in until it lands; when
// it does, DELETE them — two importers is the fork this whole file exists to atone for.
// → docs/archive/music-module-build.md#store-assets

export async function putAsset(pieceId: string, blob: Blob, ext = 'png'): Promise<AssetRef> {
  const ref = `${uuidv4()}.${ext}`
  await writeOpfsFile(assetPath(pieceId, ref), new Uint8Array(await blob.arrayBuffer()))
  return ref
}

export async function getAsset(pieceId: string, ref: AssetRef): Promise<Blob | null> {
  return readFile(assetPath(pieceId, ref))
}

/**
 * An object URL for a stored asset, plus its revoker. ⚠ THE CALLER MUST REVOKE: an object URL pins
 * its blob for the document's lifetime, and a Piece is a stack of multi-megabyte page images, so
 * leaking these is how flipping through pages ends up holding every page it ever showed.
 */
export async function assetUrl(pieceId: string, ref: AssetRef): Promise<{ url: string; revoke: () => void } | null> {
  const blob = await getAsset(pieceId, ref)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}
