// The lesson layer's own types — everything §1's `Piece` does NOT already own.
//
// ─── THE SEAM (and the fork that was deleted here on rebase) ─────────────────────────────────
//
// `LessonNote`, `Assignment` and `Anchor` are the §1 CONTRACT and live in `../types` — owned by
// `feat/music-piece-photo`, read by this lane and the MusicXML lane. This file declared parallel
// copies of all three while that branch was unlanded; they are GONE. Two identical unions written
// in parallel are not harmless — they drift the first time one side gains a member (the ledger/
// email merge's `DocType` is the worked example, and `music/types.ts` says the same in its own
// header: "ADD to it; never redefine a field in place").
//
// So: this file imports the contract and declares ONLY what is genuinely the lesson's own — the
// consent record, the recap, and the record a finished lesson leaves.
//
// ─── THE ANCHOR GAP IS CLOSED (2026-07-17) ───────────────────────────────────────────────────
//
// This file used to carry a `BarOnlyAnchor` workaround and an ask: §1's `Anchor` union could not
// express **"bar 24" alone**, which is ALL a student has mid-lesson — typing while their teacher
// talks, on a photograph whose barlines may never be marked. It refused all three dishonest ways
// round it (fabricate a `region` rect; misuse `MusicXmlAnchor` on a photo Piece; re-fork an anchor)
// and reported instead. It was right on every count.
//
// The contract's owner answered with a third variant, `BarAnchor` in `../types`:
//     { kind: 'bar', bar_label: '24' }     ← mid-lesson: the teacher SAID "bar 24"
//     …+ bar_index: 23                     ← later, once barlines exist to resolve against
// which is what that contract's `bar_index`/`bar_label` ruling already implied: carry what you know,
// resolve later, never fabricate the key. So `BarOnlyAnchor` is GONE, and with it `PinnedLessonNote`
// — the bar now rides INSIDE `LessonNote.anchor` where §1 always said it should, and a bar-pinned
// lesson note round-trips into `Piece.lesson_notes[].anchor` for real.
//
// NOTE THE FIELD CHANGE: the ask proposed `bar: number`. The contract says `bar_index` (0-based
// ordinal, the key) + `bar_label` (what a human says, never a key) — because a printed bar number
// is a STRING by MusicXML spec ('0' pickups, '8a' repeat endings) and is NOT UNIQUE, so it cannot
// be a key. A lesson note gets `bar_label`.

import type { Anchor, Assignment, BarAnchor, LessonNote } from '../types'

export type { Anchor, Assignment, BarAnchor, LessonNote }

/**
 * §A3: "Consent first. Recording a teacher is socially — and often legally — sensitive. The teacher
 * must know and agree."
 *
 * `who` is the student's record of who agreed — it is NOT a verification, and nothing in this build
 * can make it one. Naming it honestly is the point: this is a prompt that makes the student ask,
 * and a record that they did.
 */
export interface LessonConsent {
  granted: boolean
  granted_at: string
  /** Free text, the student's own note ("Ms Tran, in person"). Never a signature or an identity. */
  who?: string
}

/**
 * §A3b: the end-of-session recap. THE DISTINCTION THAT IS THE WHOLE FEATURE lives in this type's
 * existence: unlike the raw transcript, a recap IS storable — "this is something the teacher is
 * *choosing* to leave — so it's comfortable, consensual, and *is* storable".
 *
 * The line is authored-vs-captured, and it is drawn HERE, in the schema, rather than by a rule
 * someone could relax later: a recap is a thing a person deliberately made, so it has a `summary`
 * field. A transcript is a thing that happened TO a person, so it has no field anywhere in this
 * file — see `LessonRecord`.
 */
export interface LessonRecap {
  id: string
  /** The teacher's own summary. Dictated with their own keyboard's mic key, or typed. */
  summary: string
  assignments: Assignment[]
  created_at: string
}

/**
 * Everything one lesson leaves behind, attached to a Piece (§A3 "organise by piece").
 *
 * THIS IS THE COMPLETE SET OF WHAT PERSISTS. It is an ALLOW-LIST by construction — the type names
 * every field that survives a session, so a field added to the live session later cannot leak into
 * storage by riding along; it is simply not part of this shape. (`report/compile.ts` uses the same
 * discipline for the same reason: a deny-list fails the other way, silently.)
 *
 * There is NO transcript field. There is no audio field. Not "empty by default" — ABSENT. The
 * contract's own `Piece` header says the same of itself: "There is deliberately NO `transcript`
 * field on Piece and there must never be one."
 */
export interface LessonRecord {
  id: string
  /** The seam to the §1 Piece. */
  piece_id: string
  started_at: string
  ended_at: string
  /** §A3: "The only thing that persists is the student's own curated notes." The bar (if any) rides
   *  in each note's own `anchor` — §1's shape, reachable now that `BarAnchor` exists. */
  lesson_notes: LessonNote[]
  /** §A3b: absent when the lesson ended without one. */
  recap?: LessonRecap
  /**
   * Which STT source the session ran on, for the record's own honesty. A record made with a source
   * we could not verify must not later be read as though it were made on-device.
   */
  source_id: string
  /** §A3: consent is a precondition, and the record says so rather than implying it. */
  consent: LessonConsent
}
