// ─── "Make this a music score" — a photo BECOMES a Piece (§A1, the creation flow) ────────────────
//
// THE MISSING PRODUCER between two shipped halves. The media lane imports a photo as an ASSET on a
// document (`doc.media`, bytes in OPFS via `mediaStore`); MusicStudio opens the Piece OF a document.
// Nothing turned a photo INTO a Piece, so `docType:'music'` was never minted in production and the
// studio dead-ended at "This document isn't a score" for every writer who had photographed one. This
// module is that turn — the same disease this repo keeps curing: a feature's absence looked exactly
// like the feature being unnecessary.
//
// ⚠️ IT DOES NOT CONVERT THE OPEN DOCUMENT. "A photo LIVES IN a document; it does not BECOME one"
// (media/types.ts) and "the Piece IS a `.studio`" (§1) compose to ONE answer: a photo asset is READ,
// and a NEW `docType:'music'` document is born from it. The essay the writer had open is untouched —
// minting a Piece over a thesis would convert prose into a score, which MusicStudio's own comment
// forbids. The new score is its OWN document: it appears in the document list and carries its own
// edit history, provenance and cloud sync, because it is an ordinary document (newPieceDocument).
//
// ONE PIECE STORE, ONE IMPORTER, ONE PIPELINE. It calls `savePiece` (store.ts) — never a second
// container; `loadMedia` (mediaStore) — never a second byte store; and `capturePage` — the SAME
// capture→deskew→detect→reflow pipeline the studio's "+ page" already runs. There is no parallel road.

import { v4 as uuidv4 } from 'uuid'
import { upsertMeta } from '../storage/indexeddb'
import { loadMedia } from '../media/mediaStore'
import type { MediaAsset } from '../media/types'
import { capturePage } from './capture'
import { putAsset, savePiece } from './store'
import { newPiece, type Piece, type PiecePage } from './types'

/**
 * Only a PHOTO can become a score — the detector reads page geometry, so audio/video have nothing to
 * detect. The creation UI only ever offers this on photos, but the guard lives here too: the caller
 * must never hand the pipeline bytes it cannot read (an audio file "imported fine" as a blank score
 * is the worst way to discover the mistake — the media lane's own reasoning for `kindOf` returning
 * null rather than guessing).
 */
export function canBecomeScore(asset: Pick<MediaAsset, 'kind'>): boolean {
  return asset.kind === 'photo'
}

/** A starting title, from the photo's filename sans extension — the student renames it in the studio.
 *  Blank (or an extension-only name) falls back, so `doc.title`, `piece.title` and the document-list
 *  row all read the same string (withPieceTitle's invariant). */
export function titleFromAsset(asset: Pick<MediaAsset, 'name'>): string {
  return asset.name.replace(/\.[^./\\]+$/, '').trim() || 'Untitled piece'
}

export type CreateResult =
  | { ok: true; piece: Piece }
  | { ok: false; reason: string }

/**
 * Create a new music document (Piece) from an imported photo asset.
 *
 * The pipeline is the studio's own: decode → estimate skew → deskew the stored image → detect systems
 * → build the page (capture.ts). The page bytes go to OPFS as a PER-PIECE asset under the new id, and
 * the Piece is saved as its `docType:'music'` document. `piece.id === doc.id` throughout (savePiece
 * pins it), so the page image lands under the SAME id the document carries — no orphaned assets.
 *
 * REFUSES rather than guesses (the media lane's rule): a non-photo, or a photo whose bytes are gone,
 * or a capture/save failure, yields `{ok:false}` with a message the writer sees — never a blank Piece
 * and never a half-written document the studio would open empty.
 */
export async function createPieceFromPhoto(asset: MediaAsset): Promise<CreateResult> {
  if (!canBecomeScore(asset)) return { ok: false, reason: 'Only a photo can become a score.' }

  // Bytes first: a missing file is a "the file is gone" bug (media/types), not a blank score. The
  // media lane guarantees the asset only exists if the write succeeded, but a cleared cache / fresh
  // device can still leave the reference without the bytes.
  const blob = await loadMedia(asset)
  if (!blob) {
    return { ok: false, reason: "That photo’s file is missing — it may not have finished importing." }
  }

  let captured
  try {
    captured = await capturePage(blob)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Could not read that photo as a score.' }
  }

  const id = uuidv4()
  const title = titleFromAsset(asset)
  try {
    const ref = await putAsset(id, captured.blob)
    const page: PiecePage = { ...captured.page, image_ref: ref }
    const piece: Piece = {
      ...newPiece({ id, title, source: { type: 'photo', captured_via: 'image' } }),
      pages: [page],
    }
    // savePiece THROWS on a failed read/write (never silent — a student who annotates a piece that
    // stopped persisting loses the lesson), so a success here means the document is really on disk.
    await savePiece(piece)
    // Register it in the document index so the new score is REACHABLE. It is its own document and must
    // appear in the writer's list, or it is stranded the moment the studio panel closes. saveDocument
    // alone does not touch the index — the editor calls upsertMeta explicitly, and so must we.
    await upsertMeta({ id: piece.id, title: piece.title, updatedAt: new Date().toISOString() })
    return { ok: true, piece }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Could not save the new score.' }
  }
}
