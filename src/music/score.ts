// The PARSED-SCORE model for the MusicXML path (build spec PART B).
//
// ─── Why this is `score.ts` and not `types.ts` ───────────────────────────────────────────────
// `src/music/types.ts` is the shared **Piece** CONTRACT (§1), owned by the photo lane and read by
// all three lanes. This file is a different thing and must not be confused with it:
//
//   types.ts (Piece)  — the DOCUMENT: what is persisted in a .studio, snake_case, a wire contract.
//   score.ts (Score)  — the READING of one MusicXML file: transient, derived, thrown away and
//                       re-derived on every resolve. Nothing here is persisted, ever.
//
// The distinction is load-bearing for §B6: a transclusion re-parses its master on every resolve, so
// a Score is deliberately cheap and disposable. Persisting one would BE the copy that §B6 forbids.
//
// This is Inkwave's OWN reading of the score, deliberately independent of the render engine. Two
// reasons, both learned the hard way (CLAUDE.md, "when a bug survives every self-consistency check,
// stop adding checks derived from the same structure"):
//
//  1. It lets us QUERY FROM OUTSIDE. If bar addressing came from OSMD's internals, every check of
//     "does bar 12 mean bar 12?" would be derived from the same structure as the thing it checks,
//     and could not fail. Parsing the XML ourselves gives an independent answer to compare against.
//  2. It is what the excerpt/citation/annotation layers address. Those must keep meaning the same
//     thing if the render engine is ever swapped (Verovio was the live alternative — see the module
//     report), so the engine must not own the addressing vocabulary.
//
// ─── BAR ADDRESSING: printed number vs index (a real distinction, not pedantry) ───────────────
// MusicXML's `<measure number="…">` is the PRINTED bar number — what a student means by "bars
// 12-16" and what a citation "m. 34" refers to. It is NOT a position:
//   - a pickup/anacrusis is conventionally numbered "0" (or marked implicit), so printed bar 1 is
//     the SECOND measure in the file;
//   - `number` is a string by spec — "8a"/"8b" appear around repeat endings;
//   - numbering can restart between movements.
// So we carry BOTH: `number` (printed, verbatim string) and `index` (0-based position). Excerpts
// and citations address by PRINTED number, because that is what the writer typed; resolution maps
// it to an index through THIS model, and reports ambiguity rather than guessing.

/** One note (or rest) as the score states it. */
export interface ScoreNote {
  /** Absolute onset from the start of the score, in QUARTER NOTES (part-independent). */
  onsetQuarters: number
  /** Sounding length in quarter notes. Ties are already merged (see parse.ts). */
  durationQuarters: number
  /** Null for a rest. */
  pitch: Pitch | null
  /** MusicXML voice within the part (as written; may be absent → '1'). */
  voice: string
  /** 1-based staff within the part (piano: 1 = treble, 2 = bass). */
  staff: number
  /** 0-based index of the measure this note starts in. */
  measureIndex: number
  /** Stable id — addressable by annotations (§B4: "anchor comments to specific notes"). */
  id: string
}

export interface Pitch {
  /** C D E F G A B */
  step: string
  /** Chromatic alteration in semitones: -1 flat, +1 sharp, 0/absent natural. */
  alter: number
  /** Scientific octave — middle C is C4. */
  octave: number
  /** MIDI note number, derived. Middle C (C4) = 60. */
  midi: number
}

/** One measure (bar) of one part. */
export interface ScoreMeasure {
  /** 0-based position in the part. Always unambiguous. */
  index: number
  /** The PRINTED bar number, verbatim from `<measure number="…">`. May be '0', '8a', or ''. */
  number: string
  /** True when MusicXML marks it `implicit="yes"` — a pickup/anacrusis, not a counted bar. */
  implicit: boolean
  /** Onset of the measure's start, in quarter notes from the score start. */
  onsetQuarters: number
  /** Nominal length in quarter notes, from the prevailing time signature. */
  durationQuarters: number
  notes: ScoreNote[]
}

export interface TimeSignature { beats: number; beatType: number }

/** A tempo change: from `onsetQuarters` onward, play at `bpm` quarter-notes per minute. */
export interface TempoMark { onsetQuarters: number; bpm: number }

export interface ScorePart {
  id: string
  name: string
  measures: ScoreMeasure[]
}

export interface Score {
  title: string
  composer: string
  parts: ScorePart[]
  /** Tempo map for the whole score, ascending by onset. Always has an entry at 0 (default 120). */
  tempos: TempoMark[]
  timeSignature: TimeSignature
  /** Number of measures — taken from the longest part. */
  measureCount: number
  /**
   * Non-fatal things we noticed while parsing (unsupported features, odd numbering). Surfaced in
   * the UI rather than swallowed: a silently-dropped feature looks exactly like the score not
   * having it, which is the failure mode this codebase keeps re-learning.
   */
  warnings: string[]
}

/** A playable event, resolved to wall-clock seconds against the tempo map. */
export interface NoteEvent {
  timeSec: number
  durationSec: number
  midi: number
  /** 0-based measure index this event belongs to — lets the cursor and bar-loops address it. */
  measureIndex: number
  noteId: string
}
