// ─── Piece persistence — through the DOCUMENT, not beside it ─────────────────
//
// §1: "The whole thing … is bundled in a single `.studio` file (the Inkwave document container),
// stored in the user's own storage."
//
// THIS FILE USED TO BREAK THAT, AND THIS IS THE FIX. It wrote `music/<pieceId>/piece.json` — a
// SECOND document container beside `documents/<id>/current.json`. §1 says not to have one, and the
// cost was concrete: a Piece got no edit history, no provenance hashing, no session capture and no
// cloud sync, because those happen to DOCUMENTS. Now `savePiece`/`loadPiece` are thin wrappers over
// the real document store, `piece.id === doc.id`, and the only thing left in the old location is
// data to migrate OUT of it (see `migrateLegacyPieces`).
//
// WHAT `listPieceIds` BECAME: nothing. It is DELETED, and the deletion is the point rather than a
// tidy-up. It existed to answer "which piece am I looking at?" by listing a private store and taking
// `[0]` — a question a Piece-as-document does not have, because the answer is "the document you have
// open". Keeping it would have meant walking and parsing every document on disk to filter by
// docType, which is precisely the whole-file-scan-on-load class CLAUDE.md forbids.
//
// ⚠️ STORAGE POSTURE: documents are written to OPFS in the clear. There is no at-rest encryption in
// this build (verified in the code — see types.ts). Do not write copy claiming there is.

import { v4 as uuidv4 } from 'uuid'
import { readDocument, saveDocument } from '../storage/opfs'
import { writeOpfsFile } from '../storage/opfsWrite'
import { newPieceDocument } from './newPieceDocument'
import type { AssetRef, Piece } from './types'

const ROOT = 'music'

// The asset path is UNCHANGED by this migration, and deliberately: `piece.id === doc.id`, so
// `music/<id>/assets/<ref>` names the same bytes it always did. A Piece written before today keeps
// its pages without a single byte moving — only the JSON that describes them relocates.
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
 * ⚠️ **NEVER WRITE TO A TARGET YOU HAVE NOT JUST READ, AND NEVER TREAT A FAILED READ AS AN ABSENT
 * ONE** — `DocRead`'s rule (storage/opfs.ts), and the first version of this function broke it. It
 * read `loadDocument(id) ?? newPieceDocument()`, so a read that ERRORED (a private window, a quota
 * fault, a transient OPFS failure) collapsed to `absent`, minted a FRESH EMPTY document, and
 * blind-overwrote the student's real Piece with it. That is the incident that type exists to
 * prevent, reproduced in eleven characters — I wrote it without noticing, which is the whole
 * argument for the union: the compiler is what caught it, not care.
 *
 * THROWS on a failed read AND on a failed write. A silent save failure is data loss; the editor's
 * autosave follows the same rule ("NEVER swallow a failed autosave"), because a student who keeps
 * annotating a piece that stopped persisting loses the lesson.
 */
export async function savePiece(piece: Piece): Promise<void> {
  const read = await readDocument(piece.id)
  if (read.kind === 'error') {
    // Could not find out whether a document is there. The one thing we must not do is write.
    throw read.error
  }
  const doc = read.kind === 'found' ? read.doc : newPieceDocument({ title: piece.title })
  await saveDocument({
    ...doc,
    // `piece.id` is authoritative: the caller holds the Piece, and a fresh document minted above
    // carries its own uuid, which would orphan every asset already written under `piece.id`.
    id: piece.id,
    title: piece.title || doc.title,
    docType: 'music',
    piece: { ...piece, updated_at: new Date().toISOString() },
  })
}

/**
 * Load a Piece from its document.
 *
 * `null` means **the document is genuinely not there** — safe to create one. A failed READ THROWS
 * rather than returning null, for the same reason `savePiece` refuses to write on one: if a read
 * error read as "no piece", the studio would open an empty Piece over the top of a real one and the
 * student would annotate into the replacement. Absence and ignorance are different answers.
 */
export async function loadPiece(pieceId: string): Promise<Piece | null> {
  const read = await readDocument(pieceId)
  if (read.kind === 'error') throw read.error
  if (read.kind === 'absent') return null
  return read.doc.docType === 'music' ? read.doc.piece ?? null : null
}

// ─── The legacy migration ────────────────────────────────────────────────────

/**
 * Move a Piece out of the old parallel container and into its document.
 *
 * IDEMPOTENT AND ONE-WAY. It reads `music/<id>/piece.json`, writes the Piece onto the document, then
 * DELETES the old file — so a second run finds nothing and does nothing. The delete is what makes it
 * a migration rather than a fork with two writers: leaving the old file would mean two copies of one
 * Piece, and the next bug is "my annotation came back after I deleted it".
 *
 * THE DOCUMENT WINS A TIE, deliberately. If a document already has a Piece, the legacy file is stale
 * by construction — it can only have been written by a build that predates this one, while the
 * document's copy is what every write since has gone to. Overwriting live data with an older
 * snapshot is the 2026-07-05 truncation incident's shape, and this is the cheap way not to repeat it.
 *
 * @returns the ids migrated.
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
 * Every id that still has a legacy piece file. The ONLY reason this walks the old directory: to
 * empty it. It is not a piece index and must not become one.
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
// Page images stay OUT of the document JSON and are referenced by `AssetRef` — the same treatment
// the app already gives PDFs. Inlining base64 would put a decode of every page on the open path,
// which is the exact class of bug that cost this app ~10s per load (CLAUDE.md: `blobToBase64`, the
// heartbeat, the OTS sweep).
//
// ⚠️ TO BE TAKEN FROM THE MEDIA LANE, NOT KEPT. Its ruling and this lane's agree — "a photo LIVES IN
// a document, it does not BECOME one" — so `importMedia`/`mediaStore` owns getting bytes in, and
// "turn this photo into a piece" READS an asset it already put there. That lane is not in this tree
// yet (`toolbarContract.SLOT_LIVE.media` is still `() => false`, "awaiting the media-import lane"),
// so these primitives stand in. When it lands, DELETE these and take its store — two importers is
// the fork this whole file exists to atone for.

export async function putAsset(pieceId: string, blob: Blob, ext = 'png'): Promise<AssetRef> {
  const ref = `${uuidv4()}.${ext}`
  await writeOpfsFile(assetPath(pieceId, ref), new Uint8Array(await blob.arrayBuffer()))
  return ref
}

export async function getAsset(pieceId: string, ref: AssetRef): Promise<Blob | null> {
  return readFile(assetPath(pieceId, ref))
}

/**
 * An object URL for a stored asset, plus its revoker.
 *
 * The caller MUST revoke. An object URL pins its blob for the document's lifetime, and a Piece is a
 * stack of multi-megabyte page images — leaking these is how a review session that flips through
 * pages ends up holding every page it ever showed.
 */
export async function assetUrl(pieceId: string, ref: AssetRef): Promise<{ url: string; revoke: () => void } | null> {
  const blob = await getAsset(pieceId, ref)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}
