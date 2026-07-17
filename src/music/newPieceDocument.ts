// ─── A Piece IS an ordinary document (§1) ────────────────────────────────────
//
// §1: "The whole thing … is bundled in a single `.studio` file (the Inkwave document container)."
//
// This file is the retirement of a fork I shipped. `music/store.ts` used to write a PARALLEL
// container at `music/<pieceId>/piece.json`, beside `documents/<id>/current.json` — a second
// document store, which §1 explicitly says not to have. The cost was not theoretical: a Piece got no
// edit history, no provenance hashing, no session capture and no cloud sync, because every one of
// those is a thing that happens to DOCUMENTS, not to a private JSON file this module invented.
//
// The precedent is `email/newEmail.ts`, and its comment is the whole design: "An email is an
// ORDINARY document." So is a score. `docType: 'music'` + `piece`; the pages are assets; the rest is
// inherited rather than arranged.
//
// ⚠️ **`piece.id === doc.id`, ALWAYS.** One identity, not two. It is what keeps the asset paths
// (`music/<id>/assets/…`) byte-identical across this migration, and it is what lets the layer open
// "the Piece of the document you are looking at" without a lookup table. Two ids for one object is
// how a piece and its own pages come to disagree about which piece they belong to.

import { v4 as uuidv4 } from 'uuid'
import type { InkwaveDocument } from '../types/document'
import { newPiece, type PieceSource } from './types'

/** A new, empty music document. The Piece's id IS the document's id — see the banner. */
export function newPieceDocument(init?: { title?: string; source?: PieceSource }): InkwaveDocument {
  const id = uuidv4()
  const now = new Date().toISOString()
  const title = init?.title?.trim() || 'Untitled piece'
  return {
    id,
    title,
    // A score's "body" is its pages, not prose — but the document still carries a real contentJson,
    // because it is an ordinary document and everything downstream (pagination, hashing, the ledger's
    // word counts) walks it. Empty is honest: the student has written nothing yet. §A6's "write about
    // the piece in Inkwave" fills this in, on the same document, with no second container.
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    createdAt: now,
    updatedAt: now,
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: uuidv4(),
    docType: 'music',
    piece: newPiece({ id, title, source: init?.source ?? { type: 'photo', captured_via: 'image' } }),
  }
}

/**
 * A music document's title tracks its Piece's title, exactly as an email's tracks its subject.
 *
 * ONE TITLE, TWO PLACES IT IS READ FROM: the document list reads `doc.title`; the studio reads
 * `piece.title`. They are the same string and this is the one function that keeps them so — the
 * email lane needed the identical thing (`ensureDocFresh` was overwriting an email's subject-derived
 * title with the first line of the body) and it was found by a live probe, not a unit test.
 */
export function withPieceTitle(doc: InkwaveDocument, title: string): InkwaveDocument {
  const t = title.trim()
  return {
    ...doc,
    title: t || 'Untitled piece',
    ...(doc.piece ? { piece: { ...doc.piece, title: t } } : {}),
  }
}

/** Is this document a Piece? The ONE definition — absence is not a music document. */
export function isPieceDocument(doc: Pick<InkwaveDocument, 'docType' | 'piece'>): boolean {
  return doc.docType === 'music' && !!doc.piece
}
