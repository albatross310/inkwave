// Session capture (spec §A4) — the impure orchestration around sessionLogic's pure rules.
//
// HOW IT HOOKS THE EDIT STREAM: it does NOT add instrumentation. `record()` is called from the
// editor's existing `onTransaction` — the same stream the provenance spine already listens to — and
// derives its counts from `countSteps` (provenance/cadence.ts), which is the repo's existing
// steps→counts primitive. Counts only; never characters, never content.
//
// TYPING PERFORMANCE IS SACRED (CLAUDE.md). The per-keystroke path here is:
//   countSteps(steps) → compare two numbers → increment three fields.
// That is it. Specifically it does NOT:
//   • walk the document (words_start is carried from the previous close's baseline — see below)
//   • touch localStorage (the flag is cached; label suppression is cached)
//   • allocate a timer per keystroke (idle is found by ONE low-frequency interval, not a
//     clearTimeout/setTimeout churn per input)
//   • touch the disk or React state
// Every O(doc) number is computed at session CLOSE, off the input path.
//
// THE BASELINE (why words_start is free): a session boundary IS an inactivity gap (or an explicit
// Pomodoro start/stop, or a doc switch). The document cannot change while nobody is editing it, so
// the word count measured at the previous close IS the word count at the next open. Carrying it
// forward is exact, not an approximation — and it costs O(1) on the keystroke that opens a session.

import { v4 as uuidv4 } from 'uuid'
import type { Step } from '@tiptap/pm/transform'
import type { InkwaveDocument } from '../types/document'
import { countSteps } from '../provenance/cadence'
import { countWords } from '../provenance/snapshots'
import { pmToText } from '../provenance/bundle'
import { diffStats, diffWords } from '../provenance/diff'
import { currentPlace } from './places'
import {
  DEFAULT_IDLE_MS,
  buildRow,
  isIdleBoundary,
  isRecordable,
  isoWithOffset,
  localMonthOf,
  openDraft,
  recordEdit,
  type CloseReason,
  type SessionDraft,
} from './sessionLogic'
import { queueRow, flushLedgerNow } from './ledgerStore'
import type { DocType, SessionRow } from './types'

/**
 * Gross word additions/deletions between two states of the prose — the ONE place the ledger's
 * add/delete numbers come from.
 *
 * WHY THE NORMALISATION (both clauses were measured failures, not theory):
 * (1) `diffWords` tokenises as [word][trailing-whitespace] so that re-joining reproduces the
 *     original exactly — right for the diff VIEW it was built for, wrong as a measurement: appending
 *     to a paragraph makes the old last token ("three\n") differ from the new one ("three "), so a
 *     2-word addition measured 3 added + 1 deleted. Collapsing whitespace and giving BOTH sides a
 *     trailing space makes the shared prefix match, so only real changes are counted.
 * (2) `diffStats` counts \S+ runs while `countWords` (which produces words_start/words_end) counts
 *     [\p{L}\p{N}]+ runs. Left alone, punctuation tokens would make `words_added - words_deleted`
 *     disagree with `net_words` in the same row — two numbers on one graph contradicting each other.
 *     Reducing both sides to countWords' OWN word notion before diffing keeps the row coherent.
 * Exported so the arithmetic is unit-testable on its own.
 */
export function wordDiffStats(prevText: string, nextText: string): { added: number; removed: number } {
  const words = (t: string): string => {
    const m = t.match(/[\p{L}\p{N}]+/gu)
    return m ? m.join(' ') + ' ' : ''
  }
  return diffStats(diffWords(words(prevText), words(nextText)))
}

/**
 * Default doc_type for the editor's documents.
 *
 * JUDGEMENT CALL, flagged deliberately: nothing in the document model distinguishes a `note` from an
 * `essay` today, and inventing a heuristic (length? title?) would be exactly the "vibes-as-numbers"
 * the spec forbids for measured fields. Inkwave's documents ARE prose documents, so 'essay' is the
 * honest default; the email layer sets `docType: 'email'` explicitly and it flows through untouched.
 */
export const DEFAULT_DOC_TYPE: DocType = 'essay'

/** Fired when a session closes and its row is queued. detail: { sessionId, month }. */
export const LEDGER_ROW_EVENT = 'inkwave:ledger-row'

const VALID_DOC_TYPES: readonly string[] = ['note', 'essay', 'email', 'other']

/** Read an explicit docType off the document if one is set (the email layer sets it); else default. */
export function resolveDocType(doc: Pick<InkwaveDocument, 'id'> & { docType?: unknown }): DocType {
  const t = doc.docType
  return typeof t === 'string' && VALID_DOC_TYPES.includes(t) ? (t as DocType) : DEFAULT_DOC_TYPE
}

// ─── Per-document label suppression (§A3.2: doc_label is suppressible) ───────

const SUPPRESS_KEY = 'inkwave:ledgerNoLabel'
let _suppressed: Set<string> | null = null

function suppressedSet(): Set<string> {
  if (_suppressed) return _suppressed
  try {
    const raw = localStorage.getItem(SUPPRESS_KEY)
    _suppressed = new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    _suppressed = new Set()
  }
  return _suppressed
}

/** True when this document's title must never reach the ledger. */
export function isLabelSuppressed(docId: string): boolean {
  return suppressedSet().has(docId)
}

/** Suppress (or restore) a document's title in the ledger. Existing rows are not rewritten. */
export function setLabelSuppressed(docId: string, on: boolean): void {
  const s = suppressedSet()
  if (on) s.add(docId)
  else s.delete(docId)
  try {
    localStorage.setItem(SUPPRESS_KEY, JSON.stringify([...s]))
  } catch { /* private mode — suppression stays session-only */ }
}

// ─── The capture engine ──────────────────────────────────────────────────────

/** How the capture reaches the live document. Supplied by the editor. */
export interface DocBinding {
  docId: string
  /** MUST return the fresh document (the editor's ensureDocFresh). Called only at session close. */
  getDoc: () => InkwaveDocument
}

export interface CaptureOptions {
  clock?: () => number
  /** Minutes to ADD to UTC for local time; injected so tests are timezone-independent. */
  offsetMin?: () => number
  idleMs?: number
  newId?: () => string
  /** Test seam — where finished rows go. Defaults to the debounced ledger writer. */
  sink?: (month: string, row: SessionRow) => void
  /** The sticky place label, read at each close. Defaults to the writer's current label. */
  placeFn?: () => string | undefined
}

/** How often the idle watcher looks for a closed session. Not a per-keystroke cost. */
export const IDLE_CHECK_MS = 30_000

interface Baseline {
  words: number
  text: string
}

export class SessionCapture {
  private readonly clock: () => number
  private readonly offsetMin: () => number
  private readonly idleMs: number
  private readonly newId: () => string
  private readonly sink: (month: string, row: SessionRow) => void
  private readonly placeFn: () => string | undefined

  private binding: DocBinding | null = null
  private draft: SessionDraft | null = null
  /** Word count + text at the last close (or doc open) — the next session's exact start point. */
  private baselines = new Map<string, Baseline>()
  /** Global across documents (§A4: capture is global; a break is a gap between any two sessions). */
  private prevSessionEndAt: number | null = null
  private pomodoroActive = false
  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: CaptureOptions = {}) {
    this.clock = opts.clock ?? (() => Date.now())
    this.offsetMin = opts.offsetMin ?? (() => -new Date().getTimezoneOffset())
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS
    this.newId = opts.newId ?? uuidv4
    this.sink = opts.sink ?? queueRow
    this.placeFn = opts.placeFn ?? currentPlace
  }

  /** The month ledger a session that closed now would land in — the annotate path needs it. */
  monthForNow(): string {
    return localMonthOf(isoWithOffset(this.clock(), this.offsetMin()))
  }

  /**
   * Bind the live document. Closes any session in the OUTGOING document first (§A4: a document
   * switch is a session boundary), then takes the incoming document's baseline.
   */
  async bindDoc(binding: DocBinding): Promise<void> {
    if (this.binding && this.binding.docId !== binding.docId) await this.close('doc-switch')
    this.binding = binding
    // Baseline the incoming doc — O(doc), but this is a document OPEN, never a keystroke. Only if we
    // don't already hold one (a rebind of the same doc mid-session must not clobber the baseline the
    // in-flight session started from).
    if (!this.baselines.has(binding.docId)) this.baselines.set(binding.docId, this.measure(binding.getDoc()))
  }

  /** Start the low-frequency idle watcher. Idempotent. */
  startIdleWatch(): void {
    if (this.idleTimer !== null) return
    this.idleTimer = setInterval(() => {
      const d = this.draft
      if (d && isIdleBoundary(d.lastEditAt, this.clock(), this.idleMs)) void this.close('idle')
    }, IDLE_CHECK_MS)
  }

  stopIdleWatch(): void {
    if (this.idleTimer !== null) clearInterval(this.idleTimer)
    this.idleTimer = null
  }

  /**
   * THE PER-KEYSTROKE PATH. Fold one transaction's steps into the open session.
   * O(steps); no doc walk, no allocation beyond countSteps' single bin object.
   */
  record(steps: readonly Step[]): void {
    const { ins, del } = countSteps(steps)
    if (ins === 0 && del === 0) return // selection / marks / decorations — not an edit event
    const b = this.binding
    if (!b) return
    const now = this.clock()

    const d = this.draft
    if (d) {
      // DEFENSIVE: the watcher should have closed this already. It can miss only if timers were
      // throttled (a backgrounded tab) AND the visibility close didn't run. Close it off the input
      // path; the measurement is taken a tick late, so it can absorb this keystroke — a rare,
      // documented drift of a few characters, never a lost session.
      if (isIdleBoundary(d.lastEditAt, now, this.idleMs)) {
        const stale = d
        this.draft = null
        setTimeout(() => void this.closeDraft(stale, 'idle'), 0)
      } else {
        recordEdit(d, now)
        return
      }
    }
    this.openSession(now)
  }

  private openSession(now: number): void {
    const b = this.binding!
    const base = this.baselines.get(b.docId)
    this.draft = openDraft({
      sessionId: this.newId(),
      docId: b.docId,
      // The label + doc_type are resolved at CLOSE (they need the fresh document, which is an O(doc)
      // build): opening a session must stay O(1).
      docLabel: undefined,
      docType: DEFAULT_DOC_TYPE,
      pomodoro: this.pomodoroActive,
      at: now,
      wordsStart: base ? base.words : 0,
    })
  }

  /** Mark that Pomodoro work blocks are running — an explicit boundary (§A4). */
  async pomodoroStart(): Promise<void> {
    await this.close('pomodoro')
    this.pomodoroActive = true
  }

  /** End Pomodoro framing — closes the timed block so it persists with `pomodoro: true`. */
  async pomodoroStop(): Promise<void> {
    await this.close('pomodoro')
    this.pomodoroActive = false
  }

  /** Close the open session (if any) and queue its row. */
  async close(reason: CloseReason): Promise<void> {
    const d = this.draft
    if (!d) return
    this.draft = null
    await this.closeDraft(d, reason)
  }

  /** Close + flush every buffered write (idle / exit / save). */
  async closeAndFlush(reason: CloseReason): Promise<void> {
    await this.close(reason)
    await flushLedgerNow()
  }

  private async closeDraft(d: SessionDraft, _reason: CloseReason): Promise<void> {
    if (!isRecordable(d)) return
    const b = this.binding
    // The O(doc) work — at CLOSE, never on a keystroke.
    const doc = b && b.docId === d.docId ? b.getDoc() : null
    const base = this.baselines.get(d.docId)
    const end: Baseline = doc ? this.measure(doc) : (base ?? { words: d.wordsStart, text: '' })

    // Gross word add/delete = the session's start→end word diff (reuses provenance/diff.ts).
    // HONEST LIMIT: churn that nets out WITHIN a session (type a word, delete it before close) is
    // not counted as +1/-1 here. The per-word evidence for that lives in the paid cadence tap, not
    // in the ledger — and the ledger deliberately holds no keystroke-level content.
    const stats = base && doc ? wordDiffStats(base.text, end.text) : { added: 0, removed: 0 }

    const label = doc && !isLabelSuppressed(d.docId) ? doc.title : undefined
    const docType = doc ? resolveDocType(doc) : d.docType
    // The place label is read at CLOSE, not at open: the writer sets it once ("library") and every
    // session that closes there inherits it. Absent = no place field at all. Never auto-detected.
    const place = d.place ?? this.placeFn()

    const row = buildRow(
      { ...d, docLabel: label, docType, place },
      { at: d.lastEditAt, wordsEnd: end.words, wordsAdded: stats.added, wordsDeleted: stats.removed },
      this.prevSessionEndAt,
      this.offsetMin(),
    )
    this.prevSessionEndAt = d.lastEditAt
    // The baseline advances to the close point — the next session starts from here for free.
    this.baselines.set(d.docId, end)
    const month = localMonthOf(row.start)
    this.sink(month, row)
    // Let the ledger view know a session just closed, so it can offer its diary note (§A5). Carries
    // ids only — never the row, so no measurement or prose rides on an event bus.
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent(LEDGER_ROW_EVENT, { detail: { sessionId: row.session_id, month } }))
      } catch { /* no-op */ }
    }
  }

  private measure(doc: InkwaveDocument): Baseline {
    // pmToText(…, false) is the byte-deterministic form the provenance spine hashes; using the same
    // projection keeps the ledger's word arithmetic consistent with the rest of the app.
    return { words: countWords(doc.contentJson), text: pmToText(doc.contentJson, false) }
  }

  /** Diagnostics/tests. */
  get openSessionId(): string | null {
    return this.draft ? this.draft.sessionId : null
  }
  get editEvents(): number {
    return this.draft ? this.draft.editEvents : 0
  }
}

// ─── The app-wide singleton (§A4: capture is GLOBAL — any open doc contributes) ──

let _capture: SessionCapture | null = null

export function getCapture(): SessionCapture {
  if (!_capture) {
    _capture = new SessionCapture()
    // Diagnosis handle, in the house style (__iwPerf / __iwScrub / __scas). The tap is flag-gated
    // and its whole job is invisible, so "is it even running?" must be answerable without a
    // debugger — on Peter's phone as much as in a probe. Reads only; costs nothing when unused.
    if (typeof window !== 'undefined') {
      const cap = _capture
      ;(window as unknown as { __iwLedger?: unknown }).__iwLedger = {
        get openSessionId() { return cap.openSessionId },
        get editEvents() { return cap.editEvents },
        close: (reason: CloseReason = 'manual') => cap.closeAndFlush(reason),
      }
    }
  }
  return _capture
}

/** Test seam. */
export function _resetCapture(): void {
  _capture?.stopIdleWatch()
  _capture = null
}
