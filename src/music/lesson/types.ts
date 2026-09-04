// The lesson layer's own types — everything §1's `Piece` does NOT already own.
//
// ⚠ `LessonNote`, `Assignment` and `Anchor` ARE THE §1 CONTRACT and live in `../types`. This file
// declared parallel copies while that branch was unlanded; they are GONE, and must stay gone: two
// identical unions written in parallel drift the first time one side gains a member. So this file
// imports the contract and declares ONLY what is genuinely the lesson's own.
//
// The `BarOnlyAnchor` workaround is gone too, and with it `PinnedLessonNote` — the contract's own
// `BarAnchor` expresses "bar 24" alone, which is all a student has mid-lesson, so the bar now rides
// INSIDE `LessonNote.anchor` where §1 always said it should.
// → docs/archive/music-module-build.md#lessontypes

import type { Anchor, Assignment, BarAnchor, LessonNote } from '../types'

export type { Anchor, Assignment, BarAnchor, LessonNote }

/**
 * §A3: "Consent first." ⚠ `who` is the student's record of who agreed — NOT a verification, and
 * nothing in this build can make it one. Naming it honestly is the point: a prompt that makes the
 * student ask, and a record that they did.
 */
export interface LessonConsent {
  granted: boolean
  granted_at: string
  /** Free text, the student's own note ("Ms Tran, in person"). Never a signature or an identity. */
  who?: string
}

/**
 * §A3b's end-of-session recap. ⚠ THIS TYPE'S EXISTENCE IS THE AUTHORED-VS-CAPTURED LINE, drawn in
 * the SCHEMA rather than by a rule someone could relax: a recap is a thing a person deliberately
 * made, so it has a `summary` field; a transcript happened TO a person, so it has no field anywhere.
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
 * ⚠ AN ALLOW-LIST BY CONSTRUCTION — it names every field that survives, so a field added to the live
 * session later cannot leak into storage by riding along. (A deny-list fails the other way,
 * silently.) There is NO transcript field and no audio field: not "empty by default" — ABSENT.
 * → docs/archive/music-module-build.md#lessontypes
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
   * Which STT source the session ran on, for the record's own honesty: ⚠ a record made with a source
   * we could not verify must not later be read as though it were made on-device.
   */
  source_id: string
  /** §A3: consent is a precondition, and the record says so rather than implying it. */
  consent: LessonConsent
}
