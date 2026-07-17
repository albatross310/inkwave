// ATTACHING MUSIC TO THE DOCUMENT (build spec §B6, and the producer §B5 was missing).
//
// ─── Why this file exists: a mechanism with no producer ──────────────────────────────────────
// §B5's anchoring landed complete and proved — bundleHash v:4, the snapshot freeze, the verifier
// recompute, tamper tests that fail. And NOTHING WROTE `doc.music`. Excerpts lived in React state,
// so no document was ever v:4, and the entire §B5 path was unreachable in production. Every test
// passed because they constructed the document themselves.
//
// That is this codebase's disease in its purest form: the feature's absence looked exactly like the
// feature being unnecessary. It was found by grepping for WRITERS, not by reading a green suite —
// because a green suite is precisely what it produced. This module is the writer.
//
// ─── The shape ───────────────────────────────────────────────────────────────────────────────
// `doc.music` holds REFERENCES, never notation (§B6). The MusicXML bytes stay in OPFS under
// `music/master.ts`, exactly as an embedded PDF's bytes do; what lands on the document is
// `{ id, contentHash }` per master plus the excerpt addresses. That is what `musicAttachmentsHash`
// anchors, and it is why correcting a score under an anchored analysis stops the bundle verifying.
//
// The mutators below are PURE — `(music, thing) => music` — so the merge rules are testable without
// OPFS, and the one impure function (`updateDocumentMusic`) does nothing but load → apply → save.

import type { InkwaveDocument, MusicAttachments, MusicExcerptRef, MusicMasterRef } from '../types/document'
import type { MasterMeta } from './master'
import type { Transclusion } from './transclusion'

export const EMPTY_MUSIC: MusicAttachments = { masters: [], excerpts: [], annotations: [] }

/** A document's attachments, or an empty set. Never mutates the document. */
export function musicOf(doc: InkwaveDocument): MusicAttachments {
  return doc.music ?? EMPTY_MUSIC
}

/** True when there is nothing to anchor — snapshots then keep the v:1/v:2/v:3 bundle form. */
export function isEmptyMusic(music: MusicAttachments): boolean {
  return music.masters.length === 0 && music.excerpts.length === 0 && music.annotations.length === 0
}

/** The reference form of a master: identity + the hash that pins its notation. Display fields ride
 *  along for the UI but are deliberately NOT part of musicAttachmentsHash (a corpus renaming a piece
 *  must not read as a tamper). */
export function masterRef(meta: MasterMeta): MusterRefOut {
  return {
    id: meta.id,
    contentHash: meta.contentHash,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.composer ? { composer: meta.composer } : {}),
    ...(meta.attribution ? { attribution: meta.attribution } : {}),
  }
}
type MusterRefOut = MusicMasterRef

/**
 * Attach a master, or REFRESH the one already attached.
 *
 * Re-attaching an existing id updates its `contentHash` rather than adding a duplicate — that is the
 * §B6 "fix the master" path arriving at the document: the student corrects the score in MuseScore and
 * re-imports, the master's id is unchanged, and the document must now anchor the NEW notation. Adding
 * a second entry with the same id would leave the old hash in the anchored set forever and make the
 * document claim to be about two versions of one score at once.
 */
export function attachMaster(music: MusicAttachments, meta: MasterMeta): MusicAttachments {
  const ref = masterRef(meta)
  const at = music.masters.findIndex(m => m.id === ref.id)
  const masters = at < 0 ? [...music.masters, ref] : music.masters.map((m, i) => (i === at ? ref : m))
  return { ...music, masters }
}

/** Insert an excerpt (§B6). Idempotent on id, so a double-click cannot double-anchor. */
export function attachExcerpt(music: MusicAttachments, tx: Transclusion): MusicAttachments {
  if (music.excerpts.some(e => e.id === tx.id)) return music
  const ref: MusicExcerptRef = {
    id: tx.id,
    masterId: tx.masterId,
    barStart: tx.barStart,
    barEnd: tx.barEnd,
    partIndex: tx.partIndex,
    createdAt: tx.createdAt,
  }
  return { ...music, excerpts: [...music.excerpts, ref] }
}

/** Remove one excerpt. The master stays attached — other excerpts may still reference it. */
export function detachExcerpt(music: MusicAttachments, excerptId: string): MusicAttachments {
  return { ...music, excerpts: music.excerpts.filter(e => e.id !== excerptId) }
}

/**
 * Remove a master AND every excerpt of it.
 *
 * Leaving orphaned excerpts behind would anchor addresses into a score the document no longer
 * carries — they would fail to resolve, loudly (`resolveTransclusion` throws), but the ANCHORED
 * record would still assert bars of a master that isn't there. Detaching together keeps the
 * document's claim about itself true.
 */
export function detachMaster(music: MusicAttachments, masterId: string): MusicAttachments {
  return {
    ...music,
    masters: music.masters.filter(m => m.id !== masterId),
    excerpts: music.excerpts.filter(e => e.masterId !== masterId),
  }
}

/** Masters referenced by no excerpt — attached but unused. */
export function unusedMasters(music: MusicAttachments): MusicMasterRef[] {
  const used = new Set(music.excerpts.map(e => e.masterId))
  return music.masters.filter(m => !used.has(m.id))
}

/**
 * Apply a change to the ACTIVE document's music and persist it.
 *
 * Read-modify-write against OPFS on purpose: the editor owns `contentJson` and may be saving it
 * concurrently, so we re-read immediately before writing and touch ONLY `music`. Holding a document
 * in memory here and writing it back whole would clobber whatever the writer typed while the score
 * panel was open — the same class of bug as the snapshot truncation incident (CLAUDE.md: write-backs
 * must never assume they hold the newest copy).
 *
 * Returns the updated document, or null when there is no active document to attach to (the student
 * opened /music without ever having opened the editor) — the caller must SAY so rather than silently
 * dropping the attachment on the floor.
 */
export async function updateDocumentMusic(
  documentId: string,
  apply: (music: MusicAttachments) => MusicAttachments,
): Promise<InkwaveDocument | null> {
  const { loadDocument, saveDocument } = await import('../storage/opfs')
  const doc = await loadDocument(documentId)
  if (!doc) return null

  const next = apply(musicOf(doc))
  // Drop the key entirely when nothing is attached, so a document that never carried a score — or
  // whose last excerpt was just removed — keeps the v:1/v:2/v:3 bundle form and hashes exactly as it
  // always did. An empty-but-present `music: {masters:[],…}` would be a silent schema change to every
  // such document's JSON.
  const updated: InkwaveDocument = isEmptyMusic(next)
    ? (() => { const { music, ...rest } = doc; void music; return rest })()
    : { ...doc, music: next }

  await saveDocument(updated)
  return updated
}

/** The document the writer currently has open. Mirrors `storage/openDoc.ts`'s key. */
export function activeDocumentId(): string | null {
  try { return localStorage.getItem('inkwave:activeDocumentId') } catch { return null }
}
