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
// ⚠️ ONE FIELD IS MISSING FROM THE CONTRACT AND I HAVE NOT ADDED IT — see `BarOnlyAnchor` below.

import type { Anchor, Assignment, LessonNote } from '../types'

export type { Anchor, Assignment, LessonNote }

/**
 * ⚠️ THE ANCHOR GAP — reported to the coordinator, NOT forked.
 *
 * §1 says `LessonNote { …, anchor(optional → bar), … }` and §A3's differentiator is literally
 * "bar 24 — watch the dynamics" → a note anchored to bar 24. But the contract's `Anchor` union is
 * `RegionAnchor` (needs `page` + a normalised `region` rect) | `MusicXmlAnchor` (needs `measure`).
 * **Neither can express "bar 24" alone**, and during a lesson that is ALL the student has: they are
 * typing while their teacher talks, on a Piece whose barlines may not be marked yet (§A5) and whose
 * pages may be photographs with no measure numbers.
 *
 * The dishonest fixes, and why each is refused:
 *   · Fabricate a `region` rect — invents coordinates the student never gave. A lie in the schema.
 *   · Use `MusicXmlAnchor.measure` on a photo Piece — the wrong path's addressing.
 *   · Declare my own `BarAnchor` — the fork this file's header exists to refuse.
 *
 * So the note carries NO anchor and the bar rides in `bar` on the lesson's own side (below) until
 * the contract's owner decides. The honest cost is stated rather than hidden: a bar-pinned lesson
 * note does not yet round-trip into `Piece.lesson_notes[].anchor`, so §A3's pin-to-bars is complete
 * WITHIN a lesson and not yet joined to the score. **The ask: a third `Anchor` variant**
 * `{ kind: 'bar'; bar: number; page?: number }` — `bar` is already the union's documented JOIN KEY
 * ("that is what links a lesson note, a heatmap range and a recording to the same music whichever
 * path the Piece came in through"), so a bar-only variant is what the join key implies when it is
 * the only thing known.
 */
export interface BarOnlyAnchor {
  bar: number
  page?: number
}

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

/** A lesson note plus the bar it was pinned to, pending the `Anchor` variant above. */
export interface PinnedLessonNote {
  note: LessonNote
  /** Absent = a note about the lesson, not about a bar. */
  bar?: BarOnlyAnchor
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
  /** §A3: "The only thing that persists is the student's own curated notes." */
  lesson_notes: PinnedLessonNote[]
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
