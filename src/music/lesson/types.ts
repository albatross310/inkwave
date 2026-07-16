// The lesson layer's slice of the §1 Piece — written AGAINST the spec, not forking it.
//
// `Piece` itself is owned by `feat/music-piece-photo`. This module declares ONLY the two fields §1
// says the lesson path fills — `lesson_notes: [LessonNote]` and `assignments: [...]` — plus the
// recap that §A3b introduces. When the two branches meet, `Piece` imports these; nothing here
// redeclares a field the other lane owns. (The email/ledger merge is the precedent: two identical
// unions declared in parallel are not harmless — they drift the first time one side gains a member.
// So the seam is `piece_id`, and the Piece is never described here.)
//
// FIELD NAMES ARE §1's, VERBATIM — `created_at`, not `createdAt`. This is a document-schema
// contract shared with another branch and (via §A6) hashed into the provenance record; the
// productivity ledger's snake_case rule applies for the same reason. Don't tidy it.

/** A bar-anchored location on a Piece. §A2: every annotation carries an anchor. */
export interface BarAnchor {
  /** The bar number the note is about. §A3's "bar 24 — watch the dynamics". */
  bar: number
  /** Optional page, for the photo path where one Piece spans several images. */
  page?: number
}

/**
 * §1: `LessonNote { id, snippet, anchor(optional → bar), created_at }` — "distilled + curated by
 * the student only".
 *
 * READ §1's OWN NOTE ON THIS TYPE: "the *raw* transcript is **never** stored here (see §A3); only
 * the student's own distilled snippets." `snippet` is the STUDENT'S text — what they chose to
 * write down. It is not a transcript line, and there is no field here that could hold one.
 */
export interface LessonNote {
  id: string
  /** The student's own words. Their selection or paraphrase — never a verbatim capture. */
  snippet: string
  /** Where on the score this note belongs. Absent = a note about the lesson, not a bar. */
  anchor?: BarAnchor
  created_at: string
}

/**
 * §A3b: the teacher's "+" attachments — "for next week" → the student's practice to-dos.
 * §1: `assignments: [ { kind: "youtube"|"note", ref, due: "next_week" } ]`.
 */
export interface Assignment {
  id: string
  kind: 'youtube' | 'note'
  /** A YouTube URL, or the written note's text. */
  ref: string
  due: 'next_week'
  /** §A3b: "where relevant, anchored to bars/pieces". */
  anchor?: BarAnchor
  created_at: string
}

/**
 * §A3b: the end-of-session recap. THE DISTINCTION THAT IS THE WHOLE FEATURE lives in this type's
 * existence: unlike the raw transcript, a recap IS storable — "this is something the teacher is
 * *choosing* to leave — so it's comfortable, consensual, and *is* storable".
 *
 * The line is authored-vs-captured, and it is drawn HERE, in the schema, rather than by a rule
 * someone could relax later: a recap is a thing a person deliberately made, so it has a `summary`
 * field. A transcript is a thing that happened TO a person, so it has no field anywhere in this
 * file — see `persist.ts`.
 */
export interface LessonRecap {
  id: string
  /** The teacher's own summary. Dictated with their own keyboard's mic key, or typed. */
  summary: string
  assignments: Assignment[]
  created_at: string
}

/**
 * Everything one lesson leaves behind, attached to a Piece (§A3 "organise by piece" — "distilled
 * notes attach to Pieces, so each piece accumulates its feedback history over time").
 *
 * THIS IS THE COMPLETE SET OF WHAT PERSISTS. It is an ALLOW-LIST by construction — the type names
 * every field that survives a session, so a field added to the live session later cannot leak into
 * storage by riding along; it is simply not part of this shape. (The AI report's payload uses the
 * same discipline for the same reason: a deny-list fails the other way, silently.)
 *
 * There is NO transcript field. There is no audio field. Not "empty by default" — ABSENT.
 */
export interface LessonRecord {
  id: string
  /** The seam to `feat/music-piece-photo`'s Piece. */
  piece_id: string
  started_at: string
  ended_at: string
  /** §A3: "The only thing that persists is the student's own curated notes." */
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

/**
 * §A3: "Consent first. Recording a teacher is socially — and often legally — sensitive. The teacher
 * must know and agree."
 *
 * `who` is the student's record of who agreed — it is NOT a verification, and nothing in this build
 * can make it one. Naming it honestly is the point: this is a prompt that makes the student ask,
 * and a record that they did.
 */
export interface LessonConsent {
  /** The teacher was asked and agreed, in the room, before anything started. */
  granted: boolean
  granted_at: string
  /** Free text, the student's own note ("Ms Tran, in person"). Never a signature or an identity. */
  who?: string
}
