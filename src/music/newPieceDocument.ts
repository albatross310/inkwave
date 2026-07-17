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
 *
 * ⚠️ **THAT SENTENCE USED TO BE FALSE TWICE OVER, AND THIS IS THE REPAIR (2026-07-17).**
 *   1. IT HAD ZERO CALLERS. `savePiece` answered the same question LIVE and inline, with DIFFERENT
 *      semantics (`piece.title || doc.title` — an empty title fell back to the document's). Two rules
 *      for one question, and the one that actually ran was the undocumented one. The auditor mutated
 *      this function to garbage and all 1728 tests stayed green: untouched code that has never run is
 *      a plan, not a feature. `savePiece` now CALLS it, so the comment is true by construction.
 *   2. IT DID NOT DO WHAT IT SAID. `title: t || 'Untitled piece'` but `piece: { title: t }` — so on
 *      an empty title it set `doc.title = 'Untitled piece'` and `piece.title = ''`, making the two
 *      DISAGREE inside the one function whose entire job is keeping them equal. It refuted itself on
 *      the only input where the question is interesting.
 *
 * THE RULE IS `newPieceDocument`'s, above — normalise ONCE, then use that single string in BOTH
 * places. A blank title reads 'Untitled piece' everywhere, which is exactly what a brand-new Piece
 * already gets, so the two paths agree. The discarded rule (fall back to `doc.title`) cannot hold the
 * invariant at all: it leaves the studio showing a blank title while the document list shows the old
 * one — two answers to "what is this piece called?", which is the fork this lane exists to retire.
 */
export function withPieceTitle(doc: InkwaveDocument, title: string): InkwaveDocument {
  const t = title.trim() || 'Untitled piece'
  return {
    ...doc,
    title: t,
    ...(doc.piece ? { piece: { ...doc.piece, title: t } } : {}),
  }
}

/**
 * Is this document a Piece? The ONE definition — absence is not a music document.
 *
 * ⚠️ It became the one definition on 2026-07-17. It had ZERO CALLERS while `loadPiece` inlined the
 * same test (`docType === 'music' ? piece ?? null : null`) — so "the ONE definition" was a claim
 * about a function nothing called, and the auditor's garbage mutant of it killed no test. `loadPiece`
 * now calls it. If this predicate is wrong, a test dies; that is the only thing that makes a comment
 * like the one above worth reading.
 */
export function isPieceDocument(doc: Pick<InkwaveDocument, 'docType' | 'piece'>): boolean {
  return doc.docType === 'music' && !!doc.piece
}
