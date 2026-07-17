// ─── Media import (2026-07-17) ───────────────────────────────────────────────
// Peter: "a photo import button (which has photo or audio or video)". GENERAL — into any
// document, not a music feature. It is also the prerequisite for two other things: the music
// lane's "import photo → select → music button → turn this photo into a piece", and §A5's
// bar-anchored practice recordings.
//
// THE SHAPE FOLLOWS THE PDF PRECEDENT EXACTLY, because it is the same problem: the bytes are big
// and binary, so they live in OPFS and the DOCUMENT carries only a reference (`pdfName` +
// `library/pdfs/<citekey>.pdf`). A .studio that inlined 20MB of photo would re-break every load-
// performance rule the PDF precedent exists to keep.

/** What a writer brought in. Peter's three, and no more — each is a real decode path. */
export type MediaKind = 'photo' | 'audio' | 'video'

export interface MediaAsset {
  /** Stable id — the OPFS filename and the reference anything else holds. */
  id: string
  kind: MediaKind
  /** The file's own MIME type, verbatim. Needed to reconstruct the Blob on read. */
  mime: string
  /** Original filename, for display only — never an address. */
  name: string
  /** Bytes, so a UI can say "4.2 MB" without reading the file back. */
  size: number
  /** Local clock. Ordering only, NEVER authority — the ledger's §A9 rule. */
  addedAt: string
}

/**
 * DECIDED — a photo LIVES IN a document; it does not BECOME one. This agrees with the music
 * lane's ruling rather than competing with it, and the two together are the whole answer:
 *
 *   · The music lane: "§1 says the Piece IS a `.studio`" (docType 'music' + `piece`), and it is
 *     retiring `music/<pieceId>/piece.json` as a second document container. Correct.
 *   · This lane: an imported photo is an ASSET — bytes plus a reference — exactly like an embedded
 *     source PDF. A photo dropped into an essay must not mint a document; every inline image
 *     becoming its own .studio is the parallel-container mistake the music lane just deleted.
 *
 * They compose without contradiction because "turn this photo into a piece" is a THIRD thing: it
 * READS an asset and produces (or becomes) a `docType: 'music'` document. Import makes an asset;
 * the music lane makes a Piece FROM one. Neither owns the other's job, and there is exactly one
 * importer either way (see `importMedia` — Peter's two paths converge on it BY CONSTRUCTION).
 */
export interface MediaRef {
  assetId: string
}
