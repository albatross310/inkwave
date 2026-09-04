// The lesson session — §A3's crown jewel, and the one guarantee the whole feature is worth.
//
// §A3 promises the teacher that the raw transcript CANNOT be saved, exported or kept. The brief was
// to build that STRUCTURALLY — "not a policy someone could later 'improve' away" — so the discipline
// here is not "remember to delete the transcript"; it is ⚠ ARRANGE THE CODE SO THERE IS NOTHING TO
// REMEMBER. Four structures, each doing a job a rule would do worse:
//
// 1. THE TRANSCRIPT IS A `#private` FIELD, never a TypeScript `private` one — TS `private` is a
//    compile-time fiction that `(x as any)` reads and `JSON.stringify` emits.
// 2. `toJSON()` REDACTS, so a session handed to a serialiser BY MISTAKE produces a marker, not a
//    transcript. This is the one that survives the developer who does not read this comment.
// 3. `LessonRecord` HAS NO FIELD FOR IT, so it cannot be persisted by accident.
// 4. `end()` DROPS THE ARRAY and the session cannot be restarted.
//
// AND UNDER ALL OF THEM: with the default 'no-audio' source, INKWAVE NEVER OPENS THE MICROPHONE —
// there was never any audio to delete.
//
// ⚠ WHAT THIS DOES NOT CLAIM: a student can retype anything they can read. §A3 asks that the APP
// offer no affordance to keep it, which is what is built; the teacher's comfort rests on there being
// no recording, not on the student being prevented from taking notes.
// → docs/archive/music-module-build.md#lessonsession

import { v4 as uuid } from 'uuid'
import type {
  Assignment, BarAnchor, LessonConsent, LessonNote, LessonRecap, LessonRecord,
} from './types'
import { DEFAULT_SOURCE_ID, sourceById } from './stt'

/**
 * One line of the live transcript. Exists ONLY inside a running session's `#lines` — part of no
 * persisted type, no field of `LessonRecord`, no `toJSON`. A render-time value with a session
 * lifetime, and it must stay one.
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
  // ⚠ Typed `| null` and NULLED (not emptied) by end(), so "ended" and "has no lines" are ONE fact:
  // two flags that can disagree is how a session ends without ending.
  #lines: TranscriptLine[] | null = []

  #subscribers = new Set<(lines: readonly TranscriptLine[]) => void>()

  readonly id: string
  readonly piece_id: string
  readonly consent: LessonConsent
  readonly source_id: string
  readonly started_at: string

  #ended_at: string | null = null
  #notes: LessonNote[] = []
  #recap: LessonRecap | null = null

  constructor(opts: StartSessionOptions) {
    // ⚠ CONSENT IS A PRECONDITION, NOT A STEP (§A3, "Consent first"). A session cannot come into
    // existence unconsented, so there is no window in which a transcript exists without it — which
    // is why this throws rather than setting a `granted` flag on a running session.
    if (!opts.consent?.granted) {
      throw new Error(
        'A lesson session cannot start without the teacher’s consent (§A3). Ask first.',
      )
    }
    if (!opts.piece_id) throw new Error('A lesson session must be attached to a Piece (§A3 organise-by-piece).')

    const source_id = opts.source_id ?? DEFAULT_SOURCE_ID
    if (!sourceById(source_id)) {
      // ⚠ REFUSED, never defaulted: a session that silently ran on a different pipeline than it
      // recorded is exactly the fiction this module exists to prevent.
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
   * Append a line to the live transcript. ⚠ After end() this THROWS rather than no-oping: a source
   * still pushing lines into a dead session is a real bug, and a silent no-op is how it would run
   * for months unnoticed.
   */
  append(text: string): TranscriptLine {
    if (!this.#lines) throw new LessonSessionEndedError('the transcript')
    const line: TranscriptLine = { id: uuid(), text, at: new Date().toISOString() }
    this.#lines.push(line)
    this.#notify()
    return line
  }

  /**
   * The live transcript, for RENDERING ONLY. A fresh shallow copy so a caller cannot mutate the
   * session's own array; `[]` once ended. ⚠ Deliberately NOT named `transcript` — the name should
   * stop a reader thinking it is a document.
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
   * §A3's real-time distil, and the bar-pinned feedback that is its differentiator.
   *
   * ⚠ ONE LINE, ONE DELIBERATE ACT. There is no `distilAll`, no range, no select-all — not as a rule
   * but because no such method exists. That is the affordance §A3 rules out, ruled out by ABSENCE.
   * → docs/archive/music-module-build.md#ls-distil
   */
  distil(lineId: string, opts?: { text?: string; anchor?: BarAnchor }): LessonNote {
    if (!this.#lines) throw new LessonSessionEndedError('the transcript')
    const line = this.#lines.find((l) => l.id === lineId)
    if (!line) throw new Error(`No such transcript line: ${lineId}`)
    return this.#keep(opts?.text ?? line.text, opts?.anchor)
  }

  /**
   * A note the student writes themselves, with no transcript line behind it — the ordinary case on
   * the 'no-audio' source, where the panel IS their own notes. Same shape, same destination.
   */
  note(text: string, anchor?: BarAnchor): LessonNote {
    if (this.ended) throw new LessonSessionEndedError('note-taking')
    return this.#keep(text, anchor)
  }

  /** The one place a note is made — and the ONE function that changed when the contract gained its
   *  bar variant. The bar rides INSIDE `LessonNote.anchor`, where §1 always said it belonged. */
  #keep(text: string, anchor?: BarAnchor): LessonNote {
    const snippet = text.trim()
    if (!snippet) throw new Error('A lesson note cannot be empty.')
    const note: LessonNote = {
      id: uuid(),
      snippet,
      ...(anchor ? { anchor } : {}),
      created_at: new Date().toISOString(),
    }
    this.#notes.push(note)
    return note
  }

  notes(): readonly LessonNote[] {
    return [...this.#notes]
  }

  // ─── §A3b: the recap — DELIBERATELY AUTHORED, therefore storable ───────────

  /**
   * §A3b's recap — the teacher's own summary, and storable BECAUSE they chose to leave it.
   *
   * ⚠ THE DISTINCTION THAT IS THE WHOLE FEATURE: a recap is AUTHORED, a transcript is CAPTURED. So a
   * recap is never assembled FROM the transcript — there must be no "summarise the session" path,
   * which would launder captured speech into the storable side.
   * → docs/archive/music-module-build.md#ls-recap
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
    // ⚠ §1's Assignment is exactly { kind, ref, due } — adding an id/anchor/created_at here would
    // fork the contract silently. Until the ask is answered, position in the recap is the identity.
    const a: Assignment = { kind, ref: value, due: 'next_week' }
    if (!this.#recap) {
      // A teacher may attach "for next week" items before writing the summary, so the recap is
      // created empty-summaried — and `toRecord` REFUSES a summary-less one rather than persisting
      // a half-thing.
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
   * §A3's automatic deletion. ⚠ The array reference is DROPPED, not emptied, and subscribers are
   * notified with `[]` and then DROPPED — a retained subscriber closure is exactly the kind of thing
   * that keeps a "deleted" transcript alive in a heap. Idempotent, because throwing here would only
   * tempt a caller into a `try {} catch {}` around the deletion.
   */
  end(): void {
    if (this.ended) return
    this.#ended_at = new Date().toISOString()
    this.#lines = null
    for (const fn of this.#subscribers) fn([])
    this.#subscribers.clear()
  }

  /**
   * §A3's "organise by piece" — what this lesson leaves on the Piece. The ONLY function here that
   * produces a storable value, built field-by-field from the allow-list in `types.ts`; it has no
   * field to put `#lines` in even if they still existed.
   */
  toRecord(): LessonRecord {
    if (!this.ended) {
      // ⚠ END FIRST — a record taken from a running session means the raw transcript still exists at
      // the moment something storable is produced, which is the window §A3 closes. The ordering is
      // the guarantee, not a nicety.
      throw new Error('End the session before taking its record (§A3): the transcript must be gone first.')
    }
    const recap = this.#recap
    return {
      id: this.id,
      piece_id: this.piece_id,
      started_at: this.started_at,
      ended_at: this.#ended_at!,
      lesson_notes: [...this.#notes],
      // ⚠ A summary-less recap is an accident of the "+"-before-summary order, not a thing the
      // teacher authored. Dropping it keeps "everything stored was deliberately left" literally true.
      ...(recap && recap.summary ? { recap: { ...recap, assignments: [...recap.assignments] } } : {}),
      source_id: this.source_id,
      consent: this.consent,
    }
  }

  /**
   * ⚠ THE SERIALISER FIREBREAK. `JSON.stringify(session)` — from an OPFS write, a cloud sync, a log
   * line, a future export nobody has written yet — emits a marker, never a transcript. Every other
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
