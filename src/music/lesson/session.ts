// The lesson session — §A3's crown jewel, and the one guarantee the whole feature is worth.
//
// ─── WHAT THIS FILE HAS TO MAKE TRUE ─────────────────────────────────────────────────────────
//
// §A3, the owner decision, verbatim: "When the recording session ends, the **raw transcript and the
// audio are deleted automatically**; the student **cannot save, export, or otherwise keep** the
// verbatim transcript. The only thing that persists is the **student's own curated notes**... This
// is exactly what removes the teacher's self-consciousness: there is provably no keepable recording
// of them."
//
// The brief's instruction was to build that as a STRUCTURAL guarantee — "no code path that can
// persist it — not a policy someone could later 'improve' away". So the discipline in this file is
// not "remember to delete the transcript". It is: ARRANGE THE CODE SO THERE IS NOTHING TO
// REMEMBER. Four structures, each doing a job a rule would do worse:
//
// 1. THE TRANSCRIPT IS A `#private` FIELD, not a TypeScript `private` one. TS `private` is a
//    compile-time fiction — `(session as any).lines` reads it at runtime, and `JSON.stringify`
//    emits it. `#lines` is unreachable from outside the class body in the ENGINE, and invisible to
//    stringify. The difference is exactly the difference between a policy and a structure.
// 2. `toJSON()` IS OVERRIDDEN TO REDACT. Every serialiser in the app — OPFS writes, cloud sync,
//    `JSON.stringify` in a log line, a future export — goes through `toJSON`. So a session that is
//    handed to a writer BY MISTAKE still cannot spill: the mistake produces a marker, not a
//    transcript. This is the one that survives the developer who does not read this comment.
// 3. THE PERSISTABLE SHAPE HAS NO FIELD FOR IT. `toRecord()` returns `LessonRecord`, whose type
//    names every surviving field (types.ts) and has no transcript member. A transcript cannot be
//    persisted by accident because there is nowhere to put it.
// 4. `end()` DROPS THE ARRAY AND THE SESSION CANNOT BE RESTARTED. Not "clears a buffer" — the
//    reference is released and every accessor is closed off behind `#ended`. There is no reopen.
//
// AND THE STRUCTURE UNDER ALL OF THEM: with the default 'no-audio' source, INKWAVE NEVER OPENS THE
// MICROPHONE. §A3 promises the audio is deleted; the stronger and simpler truth available to a PWA
// is that there was never any audio to delete. See stt.ts for why that is the honest default and
// what `webkitSpeechRecognition` would have cost us.
//
// ─── WHAT THIS FILE DOES NOT CLAIM ───────────────────────────────────────────────────────────
//
// A student can retype anything they can read; no software prevents that, and pretending otherwise
// would be the overclaim this codebase keeps having to walk back. What §A3 actually asks for is
// that the APP offer no affordance to keep it — no save, no export, no select-all — and that is
// what is built: `distil()` is per-line and deliberate, there is no bulk path, and the transcript
// dies with the session. The teacher's comfort rests on there being no recording, which is true,
// and not on the student being prevented from taking notes, which is the point of the lesson.

import { v4 as uuid } from 'uuid'
import type {
  Assignment, BarOnlyAnchor, LessonConsent, LessonRecap, LessonRecord, PinnedLessonNote,
} from './types'
import { DEFAULT_SOURCE_ID, sourceById } from './stt'

/**
 * One line of the live transcript. Exists ONLY inside a running session's `#lines`.
 *
 * Note what it is not: it is not exported as part of any persisted type, it appears in no field of
 * `LessonRecord`, and it has no `toJSON`. It is a render-time value with a session lifetime.
 */
export interface TranscriptLine {
  id: string
  text: string
  at: string
}

export class LessonSessionEndedError extends Error {
  constructor(what: string) {
    super(
      `This lesson session has ended: ${what} is no longer available. The raw transcript is gone ` +
        `by design (§A3) — only the student's curated notes survive.`,
    )
    this.name = 'LessonSessionEndedError'
  }
}

/** The redaction `toJSON()` emits in place of a session. A marker, never content. */
export const SESSION_REDACTION = {
  _iw: 'lesson-session',
  storable: false,
  note: 'A live lesson session is not storable. Persist toRecord() instead.',
} as const

export interface StartSessionOptions {
  piece_id: string
  consent: LessonConsent
  /** Defaults to 'no-audio' — the only source whose promise we can keep. See stt.ts. */
  source_id?: string
}

export class LessonSession {
  // ── The transcript. `#private`: unreachable at runtime, invisible to JSON.stringify. ──
  //
  // Typed `| null` and NULLED (not emptied) by end(), so "ended" and "has no lines" are the same
  // fact in one place — two flags that can disagree is how a session ends without ending.
  #lines: TranscriptLine[] | null = []

  #subscribers = new Set<(lines: readonly TranscriptLine[]) => void>()

  readonly id: string
  readonly piece_id: string
  readonly consent: LessonConsent
  readonly source_id: string
  readonly started_at: string

  #ended_at: string | null = null
  #notes: PinnedLessonNote[] = []
  #recap: LessonRecap | null = null

  constructor(opts: StartSessionOptions) {
    // CONSENT IS A PRECONDITION, NOT A STEP. §A3: "Consent first." A session cannot come into
    // existence unconsented — so there is no window in which a transcript exists without it, and no
    // ordering bug that could open one. This is a throw rather than a `granted` flag on a running
    // session for that exact reason.
    if (!opts.consent?.granted) {
      throw new Error(
        'A lesson session cannot start without the teacher’s consent (§A3). Ask first.',
      )
    }
    if (!opts.piece_id) throw new Error('A lesson session must be attached to a Piece (§A3 organise-by-piece).')

    const source_id = opts.source_id ?? DEFAULT_SOURCE_ID
    if (!sourceById(source_id)) {
      // An unregistered source is refused rather than defaulted — a session that silently ran on a
      // different pipeline than it recorded is exactly the fiction this module exists to prevent.
      throw new Error(`Unknown speech source: ${source_id}. See stt.ts SOURCES.`)
    }

    this.id = uuid()
    this.piece_id = opts.piece_id
    this.consent = opts.consent
    this.source_id = source_id
    this.started_at = new Date().toISOString()
  }

  get ended(): boolean {
    return this.#ended_at !== null
  }

  // ─── The live transcript (session-scoped) ──────────────────────────────────

  /**
   * Append a line to the live transcript. Called by whatever source is running.
   *
   * After end() this THROWS rather than no-oping: a source still pushing lines into a dead session
   * is a real bug (a recogniser that outlived its session), and a silent no-op is how it would run
   * for months unnoticed. Fail loudly — the house disease is checks that cannot see their own
   * failure.
   */
  append(text: string): TranscriptLine {
    if (!this.#lines) throw new LessonSessionEndedError('the transcript')
    const line: TranscriptLine = { id: uuid(), text, at: new Date().toISOString() }
    this.#lines.push(line)
    this.#notify()
    return line
  }

  /**
   * The live transcript, for RENDERING ONLY — §A3's "source panel during the lesson".
   *
   * Returns a fresh shallow copy so a caller cannot mutate the session's own array, and returns
   * `[]` once ended. Deliberately NOT a getter named `transcript`: this is a live view with a
   * session lifetime, and the name should stop a reader thinking it is a document.
   */
  liveLines(): readonly TranscriptLine[] {
    return this.#lines ? [...this.#lines] : []
  }

  subscribe(fn: (lines: readonly TranscriptLine[]) => void): () => void {
    this.#subscribers.add(fn)
    fn(this.liveLines())
    return () => this.#subscribers.delete(fn)
  }

  #notify(): void {
    const lines = this.liveLines()
    for (const fn of this.#subscribers) fn(lines)
  }

  // ─── Distil: the ONLY bridge from transcript to anything that survives ─────

  /**
   * §A3: "the student distils from it in real time — copying the useful lines into their own notes
   * as the lesson happens", and "Pin feedback to bars... ('bar 24 — watch the dynamics' → a
   * LessonNote anchored to bar 24). The under-served differentiator."
   *
   * ONE LINE, ONE DELIBERATE ACT. There is no `distilAll`, no range, no select-all — not as a rule
   * but because no such method exists. That is the affordance §A3 rules out, ruled out by absence.
   *
   * `text` lets the student write their OWN words (a paraphrase); omitted, the line seeds the note,
   * which is the "copying the useful lines" §A3 describes. Either way the note is the student's —
   * it is their act, their selection, and it is what §1 means by "distilled + curated by the
   * student only".
   */
  distil(lineId: string, opts?: { text?: string; bar?: BarOnlyAnchor }): PinnedLessonNote {
    if (!this.#lines) throw new LessonSessionEndedError('the transcript')
    const line = this.#lines.find((l) => l.id === lineId)
    if (!line) throw new Error(`No such transcript line: ${lineId}`)
    return this.#keep(opts?.text ?? line.text, opts?.bar)
  }

  /**
   * A note the student writes themselves, with no transcript line behind it — the ordinary case on
   * the 'no-audio' source, where the panel IS their own notes. Same shape, same destination.
   */
  note(text: string, bar?: BarOnlyAnchor): PinnedLessonNote {
    if (this.ended) throw new LessonSessionEndedError('note-taking')
    return this.#keep(text, bar)
  }

  /**
   * The one place a note is made. §1's `LessonNote` carries no bar-only anchor yet (types.ts
   * BarOnlyAnchor explains the gap and the ask), so the bar rides alongside rather than inside —
   * and when the contract gains its variant this is the ONE function that changes.
   */
  #keep(text: string, bar?: BarOnlyAnchor): PinnedLessonNote {
    const snippet = text.trim()
    if (!snippet) throw new Error('A lesson note cannot be empty.')
    const pinned: PinnedLessonNote = {
      note: { id: uuid(), snippet, created_at: new Date().toISOString() },
      ...(bar ? { bar } : {}),
    }
    this.#notes.push(pinned)
    return pinned
  }

  notes(): readonly PinnedLessonNote[] {
    return [...this.#notes]
  }

  // ─── §A3b: the recap — DELIBERATELY AUTHORED, therefore storable ───────────

  /**
   * §A3b: "the student hands over the phone and the teacher dictates a short summary... Unlike the
   * raw transcript, this is something the teacher is *choosing* to leave — so it's comfortable,
   * consensual, and *is* storable."
   *
   * THE DISTINCTION THAT IS THE WHOLE FEATURE runs through this method: `summary` is a string the
   * teacher composed and can see, edit, and delete before it is kept. It is authored. The
   * transcript is captured. That is why this one has a home in `LessonRecord` and the other has no
   * field anywhere.
   *
   * Note what does NOT happen here: a recap is not assembled FROM the transcript. There is no
   * "summarise the session" path — that would launder captured speech into the storable side and
   * erase the very line the feature sells. The teacher writes it, or dictates it with their own
   * keyboard's mic key.
   */
  setRecap(summary: string, assignments: Assignment[] = []): LessonRecap {
    if (this.ended) throw new LessonSessionEndedError('the recap')
    const text = summary.trim()
    if (!text) throw new Error('A recap cannot be empty — if there is nothing to leave, leave nothing.')
    this.#recap = {
      id: this.#recap?.id ?? uuid(),
      summary: text,
      assignments,
      created_at: this.#recap?.created_at ?? new Date().toISOString(),
    }
    return this.#recap
  }

  /** §A3b's "+" button: attach a YouTube link or a written note as a "for next week" item. */
  addAssignment(kind: 'youtube' | 'note', ref: string): Assignment {
    if (this.ended) throw new LessonSessionEndedError('assignments')
    const value = ref.trim()
    if (!value) throw new Error('An assignment needs a link or some text.')
    // §1's Assignment is exactly { kind, ref, due } — no id, no anchor, no created_at. Those are
    // fields I wanted and did NOT add: adding them here would fork the contract silently. The ask
    // is in the report; until then an assignment is identified by its position in the recap.
    const a: Assignment = { kind, ref: value, due: 'next_week' }
    if (!this.#recap) {
      // A teacher may attach "for next week" items before writing the summary. The recap is created
      // empty-summaried here and setRecap fills it — but `toRecord` REFUSES a summary-less recap
      // rather than persisting a half-thing (see below).
      this.#recap = { id: uuid(), summary: '', assignments: [], created_at: new Date().toISOString() }
    }
    this.#recap.assignments.push(a)
    return a
  }

  recap(): LessonRecap | null {
    return this.#recap ? { ...this.#recap, assignments: [...this.#recap.assignments] } : null
  }

  // ─── End: the transcript ceases to exist ───────────────────────────────────

  /**
   * §A3: "When the recording session ends, the raw transcript and the audio are deleted
   * automatically."
   *
   * The array reference is DROPPED, not emptied — nothing retains it, and `#lines === null` is the
   * single fact that closes every accessor at once. Subscribers are notified with `[]` (so a panel
   * still on screen empties in the same tick) and then dropped, because a retained subscriber
   * closure is exactly the kind of thing that keeps a "deleted" transcript alive in a heap.
   *
   * Idempotent: ending an ended session is not an error — the postcondition is already true, and
   * throwing here would only tempt a caller into a `try {} catch {}` around the deletion.
   */
  end(): void {
    if (this.ended) return
    this.#ended_at = new Date().toISOString()
    this.#lines = null
    for (const fn of this.#subscribers) fn([])
    this.#subscribers.clear()
  }

  /**
   * §A3's "organise by piece" — what this lesson leaves on the Piece.
   *
   * The ONLY function in this module that produces a storable value, and it is built field-by-field
   * from the allow-list in `types.ts`. It reads `#notes` and `#recap`. It CANNOT read `#lines`
   * meaningfully — by the time a record is normally taken they are gone — and there is no field to
   * put them in if it did.
   */
  toRecord(): LessonRecord {
    if (!this.ended) {
      // A record is what a lesson LEFT — taking one from a running session would mean the raw
      // transcript still exists at the moment something storable is produced, which is precisely
      // the window §A3 closes. So: end first. This ordering is the guarantee, not a nicety.
      throw new Error('End the session before taking its record (§A3): the transcript must be gone first.')
    }
    const recap = this.#recap
    return {
      id: this.id,
      piece_id: this.piece_id,
      started_at: this.started_at,
      ended_at: this.#ended_at!,
      lesson_notes: [...this.#notes],
      // A recap with no summary is an accident of the "+"-before-summary order, not a thing the
      // teacher authored. Dropping it keeps "everything stored was deliberately left" literally true.
      ...(recap && recap.summary ? { recap: { ...recap, assignments: [...recap.assignments] } } : {}),
      source_id: this.source_id,
      consent: this.consent,
    }
  }

  /**
   * THE SERIALISER FIREBREAK. `JSON.stringify(session)` — from an OPFS write, a cloud sync, a log
   * line, a React devtools dump, a future export nobody has written yet — emits a marker, never a
   * transcript.
   *
   * This is the structure that protects against the mistake rather than the intention. Every other
   * guarantee here assumes someone calls the right method; this one holds when they don't.
   */
  toJSON(): typeof SESSION_REDACTION {
    return SESSION_REDACTION
  }
}

/**
 * §A3: "Consent first." The only way to make a session — named so the consent is in the caller's
 * face at the call site, not three fields deep in an options bag.
 */
export function startSession(opts: StartSessionOptions): LessonSession {
  return new LessonSession(opts)
}
