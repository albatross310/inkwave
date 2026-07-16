// ─── Piece persistence ───────────────────────────────────────────────────────
//
// §1: "The whole thing … is bundled in a single `.studio` file (the Inkwave document container),
// stored in the user's own storage."
//
// WHAT IS TRUE TODAY, precisely: the Piece JSON and its page images live in OPFS, in the clear.
// Zero-retention IS real — there is no server and none of this leaves the device. At-rest encryption
// is NOT (verified in the code; see types.ts). The honest sentence is "Stored on your device — we
// never hold it."
//
// THE BYTES ARE SIDECARS, NOT INLINE. Page images are written as separate OPFS files and referenced
// by `AssetRef`, exactly as the app already treats PDFs. Inlining base64 into the Piece JSON would
// mean every read of the Piece decodes every page — an O(whole file) parse on the open path, which
// is the precise class of bug that cost this app ~10s per load (CLAUDE.md: `blobToBase64`, the
// heartbeat, the OTS sweep). Refs let a page load when it is looked at.

import { v4 as uuidv4 } from 'uuid'
import { writeOpfsFile } from '../storage/opfsWrite'
import type { AssetRef, Piece } from './types'

const ROOT = 'music'

function pieceDir(pieceId: string): string[] { return [ROOT, pieceId] }
function piecePath(pieceId: string): string[] { return [...pieceDir(pieceId), 'piece.json'] }
function assetPath(pieceId: string, ref: AssetRef): string[] { return [...pieceDir(pieceId), 'assets', ref] }

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

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** Save a Piece. THROWS on failure — a silent save failure is data loss (CLAUDE.md's autosave rule). */
export async function savePiece(piece: Piece): Promise<void> {
  try { void navigator.storage?.persist?.() } catch { /* unsupported */ }
  const next: Piece = { ...piece, updated_at: new Date().toISOString() }
  await writeOpfsFile(piecePath(piece.id), JSON.stringify(next))
}

export async function loadPiece(pieceId: string): Promise<Piece | null> {
  const f = await readFile(piecePath(pieceId))
  if (!f) return null
  try { return JSON.parse(await f.text()) as Piece } catch { return null }
}

export async function listPieceIds(): Promise<string[]> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(ROOT)
    const ids: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const name of (dir as any).keys()) ids.push(name)
    return ids
  } catch {
    return []
  }
}

// ─── Assets ──────────────────────────────────────────────────────────────────

/** Write page/audio bytes and return the ref to store on the Piece. */
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
 * The caller MUST revoke. An object URL pins its blob in memory for the document's lifetime, and a
 * Piece is a stack of multi-megabyte page images — leaking these is how a review session that flips
 * through pages ends up holding every page it ever showed.
 */
export async function assetUrl(pieceId: string, ref: AssetRef): Promise<{ url: string; revoke: () => void } | null> {
  const blob = await getAsset(pieceId, ref)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}
