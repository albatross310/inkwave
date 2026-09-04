// Session capture (spec §A4) — the impure orchestration around sessionLogic's pure rules.
//
// ⚠ TYPING COST IS THE DESIGN. It adds NO instrumentation: `record()` rides the editor's existing
// `onTransaction` and reuses `countSteps` — counts only, never characters, never content. The
// per-keystroke path is countSteps → compare two numbers → increment three fields, and NOTHING
// else: no doc walk, no localStorage, no per-keystroke timer (idle is ONE low-frequency interval),
// no disk, no React state. ⚠ EVERY O(doc) NUMBER IS COMPUTED AT SESSION CLOSE.
// ⚠ `words_start` IS CARRIED FROM THE PREVIOUS CLOSE'S BASELINE, and that is exact rather than
// approximate: a boundary IS an inactivity gap, and the document cannot change while nobody edits.
// → docs/archive/productivity-email-build.md#capture-typing-cost

import { v4 as uuidv4 } from 'uuid'
import type { Step } from '@tiptap/pm/transform'
import type { InkwaveDocument } from '../types/document'
import { countSteps } from '../provenance/cadence'
import { countWords } from '../provenance/snapshots'
import { pmToText } from '../provenance/bundle'
import { diffStats, diffWords } from '../provenance/diff'
import { activityDuring, observedDocType } from './pdfActivity'
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
 * add/delete numbers come from. Exported so the arithmetic is unit-testable on its own.
 *
 * ⚠ THE NORMALISATION IS LOAD-BEARING, and both clauses were measured failures: `diffWords`
 * tokenises word+trailing-whitespace, so appending to a paragraph scored a 2-word addition as
 * 3 added + 1 deleted; and `diffStats` counts `\S+` where `countWords` counts `[\p{L}\p{N}]+`, so
 * punctuation made `words_added - words_deleted` disagree with `net_words` IN THE SAME ROW.
 * → docs/archive/productivity-email-build.md#capture-word-diff
 */
export function wordDiffStats(prevText: string, nextText: string): { added: number; removed: number } {
  const words = (t: string): string => {
    const m = t.match(/[\p{L}\p{N}]+/gu)
    return m ? m.join(' ') + ' ' : ''
  }
  return diffStats(diffWords(words(prevText), words(nextText)))
}

/**
 * Default doc_type when the document does not say what it is.
 *
 * ⚠ `misc`, NOT `'essay'` — an honesty fix, not a rename: the old default FILED EVERY UNCLASSIFIED
 * SESSION AS ESSAY WRITING, a guess dressed as a measurement in the one field §A6.1 says must be
 * measured. A type is SET, never guessed — by the email layer, by the PDF surface, or by the
 * writer's own reflection. Nothing distinguishes a note from an essay, and a length- or
 * title-based rule would be invention. → docs/archive/productivity-email-build.md#capture-default-doc-type
 */
export const DEFAULT_DOC_TYPE: DocType = 'misc'

/** Fired when a session closes and its row is queued. detail: { sessionId, month }. */
export const LEDGER_ROW_EVENT = 'inkwave:ledger-row'

const VALID_DOC_TYPES: readonly string[] = ['note', 'essay', 'email', 'reading', 'annotating', 'other', 'misc']

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

  /**
   * Start the low-frequency idle watcher. Idempotent.
   *
   * ⚠ A RUNNING POMODORO SUPPRESSES THE INACTIVITY CLOSE (§A4 names it a boundary in its own
   * right). Silence means "gone" only when nobody has claimed the time: 25 minutes of reading a
   * printed article produces ZERO events, and the 5-minute rule would throw twenty of them away.
   * → docs/archive/productivity-email-build.md#capture-pomodoro-boundary
   */
  startIdleWatch(): void {
    if (this.idleTimer !== null) return
    this.idleTimer = setInterval(() => {
      const d = this.draft
      if (!d || this.pomodoroActive) return
      if (isIdleBoundary(d.lastEditAt, this.clock(), this.idleMs)) void this.close('idle')
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
      if (!this.pomodoroActive && isIdleBoundary(d.lastEditAt, now, this.idleMs)) {
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

  private openSession(now: number, openedBy: 'edit' | 'timer' = 'edit'): void {
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
      // The timer opening a session is not a keystroke — see openDraft.
      edits: openedBy === 'edit' ? 1 : 0,
    })
  }

  /**
   * A Pomodoro block starts — an explicit boundary (§A4), and THE CLAIM OF WORK.
   *
   * ⚠ IT OPENS A SESSION IMMEDIATELY rather than waiting for a keystroke: starting the timer IS
   * the writer saying *count this*, and 25 minutes of reading a printed article would otherwise
   * produce no events, no session and NO ROW. The block is measured; only its TYPE is unknown
   * (⇒ `misc`), which the end-of-stretch reflection names.
   */
  async pomodoroStart(): Promise<void> {
    await this.close('pomodoro')
    this.pomodoroActive = true
    if (this.binding) this.openSession(this.clock(), 'timer')
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

  /** Close + flush every buffered write (idle / exit / save), then queue a cloud sync. */
  async closeAndFlush(reason: CloseReason): Promise<void> {
    await this.close(reason)
    await flushLedgerNow()
    this.queueSync()
  }

  /**
   * Ask for a debounced ledger sync of the current month.
   *
   * ⚠ DYNAMICALLY IMPORTED: the sync + provider adapters must not ride the editor's load path just
   * because capture.ts does. Fire-and-forget — a sync failure must never surface as a broken close.
   */
  private queueSync(): void {
    if (typeof window === 'undefined') return
    const month = this.monthForNow()
    void import('./ledgerRemotes')
      .then((m) => m.syncLedgerSoon([month]))
      .catch(() => { /* offline / no provider — the rows are safe locally */ })
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
    const declared = doc ? resolveDocType(doc) : d.docType
    // The place label is read at CLOSE, not at open: the writer sets it once ("library") and every
    // session that closes there inherits it. Absent = no place field at all. Never auto-detected.
    const place = d.place ?? this.placeFn()

    // ⚠ A TYPING SESSION ENDS AT ITS LAST EDIT, or every session banks the idle time it took to
    // notice. A POMODORO BLOCK IS DIFFERENT IN KIND: the timer running is the claim, so it ends
    // when the block ends and ALL of it is active — otherwise a silent 25-minute reading block
    // reports `active_minutes: 0`, the same lie as not recording it at all.
    const closeAt = d.pomodoro ? this.clock() : d.lastEditAt
    const draft = d.pomodoro ? { ...d, activeMs: Math.max(0, closeAt - d.startedAt) } : d

    // WAS THIS BLOCK SPENT IN A PDF? Resolved at CLOSE, never on a keystroke — and only ever where
    // the answer would otherwise have been `misc`, i.e. where we had already admitted we did not
    // know. A session with edits, or a document that DECLARED its type, is untouched. See
    // pdfActivity.ts `observedDocType` for the full rule; the two booleans it reads are the only
    // thing this feature records about a PDF (never a page, never a position).
    const docType = observedDocType(declared, d.editEvents, activityDuring(d.startedAt, closeAt))

    const row = buildRow(
      { ...draft, docLabel: label, docType, place },
      { at: closeAt, wordsEnd: end.words, wordsAdded: stats.added, wordsDeleted: stats.removed },
      this.prevSessionEndAt,
      this.offsetMin(),
    )
    this.prevSessionEndAt = closeAt
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
