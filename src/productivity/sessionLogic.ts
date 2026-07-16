// Session boundary detection + row computation (spec §A2, §A4) — PURE.
//
// Everything here is a pure function of its arguments (clock injected by the caller), so the
// boundary rules and the arithmetic are unit-testable without an editor, a DOM or a disk.
// The impure orchestration (timers, the edit stream, disk writes) lives in capture.ts.
//
// THE TYPING-PERFORMANCE SHAPE (why this module looks the way it does): the editor's per-keystroke
// path may do NO O(doc) work. So a session's `words_start` is NOT counted when the session opens —
// it is carried in from the previous close's baseline. That is exact, not an approximation: a
// session boundary IS an inactivity gap (or an explicit start/stop, or a doc switch), and the
// document cannot change while nobody is editing it. So the word count at the previous close is the
// word count at the next open, and a keystroke costs O(steps). See capture.ts for the baseline.

import type { DocType, SessionRow } from './types'

/** Inactivity gap that closes a session (§A4 default 5 min). */
export const DEFAULT_IDLE_MS = 5 * 60_000

/**
 * The most one inter-edit gap may contribute to `active_minutes`.
 *
 * `active_minutes` is "time actually editing (excludes idle within session)" (§A3.2), so it is the
 * sum of gaps BETWEEN consecutive edits, each capped: a writer who types, thinks for 3 minutes
 * (under the 5-minute boundary) and types again was not editing for those 3 minutes. The cap is the
 * one judgement call in the arithmetic — it is deliberately a named constant so the number it
 * produces is explainable ("we count up to 60s of thinking between two keystrokes as working
 * time"), never a black box.
 */
export const ACTIVE_GAP_CAP_MS = 60_000

/** Reasons a session closes — carried for diagnosis; NOT persisted (the row schema is fixed). */
export type CloseReason = 'idle' | 'pomodoro' | 'doc-switch' | 'exit' | 'manual'

/** The in-flight session. `startText`/`wordsStart` come from the previous close's baseline. */
export interface SessionDraft {
  sessionId: string
  docId: string
  docLabel?: string
  docType: DocType
  pomodoro: boolean
  /** epoch ms of the first edit in this session. */
  startedAt: number
  /** epoch ms of the most recent edit. */
  lastEditAt: number
  /** Accumulated capped inter-edit time (ms). */
  activeMs: number
  /** Content-changing transactions seen. */
  editEvents: number
  /** Word count at session start, carried from the baseline. */
  wordsStart: number
  /** The writer's typed place label, applied at close. Never auto-detected — see types.ts. */
  place?: string
  /** The writer's diary note. Usually attached AFTER close, from the ledger view. */
  note?: string
}

/**
 * Tidy a user-typed note/place: trim and collapse internal whitespace, and treat blank as ABSENT so
 * the field is omitted entirely rather than stored as "". Returns undefined for nothing-to-store.
 */
export function cleanText(s: string | undefined | null, maxLen = 2000): string | undefined {
  if (!s) return undefined
  const t = s.replace(/\s+/g, ' ').trim().slice(0, maxLen)
  return t.length ? t : undefined
}

/** True when `now` is far enough past the last edit to close the session (§A4). */
export function isIdleBoundary(lastEditAt: number, now: number, idleMs: number = DEFAULT_IDLE_MS): boolean {
  return now - lastEditAt >= idleMs
}

/** Open a new draft on its first edit. The first edit contributes no active time (no gap yet). */
export function openDraft(opts: {
  sessionId: string
  docId: string
  docLabel?: string
  docType: DocType
  pomodoro: boolean
  at: number
  wordsStart: number
}): SessionDraft {
  return {
    sessionId: opts.sessionId,
    docId: opts.docId,
    docLabel: opts.docLabel,
    docType: opts.docType,
    pomodoro: opts.pomodoro,
    startedAt: opts.at,
    lastEditAt: opts.at,
    activeMs: 0,
    editEvents: 1,
    wordsStart: opts.wordsStart,
  }
}

/**
 * Fold one content-changing edit into the draft, IN PLACE — this is the per-keystroke path, so it
 * allocates nothing and walks nothing. Returns the same object.
 */
export function recordEdit(d: SessionDraft, at: number): SessionDraft {
  const gap = at - d.lastEditAt
  if (gap > 0) d.activeMs += Math.min(gap, ACTIVE_GAP_CAP_MS)
  d.lastEditAt = at
  d.editEvents++
  return d
}

// ─── Time formatting (§A9: store UTC + offset) ───────────────────────────────

function pad(n: number, w = 2): string {
  return String(Math.abs(n)).padStart(w, '0')
}

/**
 * ISO-8601 carrying the UTC instant AND the writer's local offset, e.g.
 * `2026-07-17T09:14:03.000+10:00`. §A9 requires UTC + offset so aggregation can happen in the
 * writer's LOCAL day; a bare `Z` string loses the offset and with it the local day.
 *
 * `offsetMin` is minutes to ADD to UTC to get local time (Brisbane = +600), i.e. the negation of
 * `Date.prototype.getTimezoneOffset()`. Injected so tests are timezone-independent.
 */
export function isoWithOffset(ms: number, offsetMin: number): string {
  const local = new Date(ms + offsetMin * 60_000)
  const sign = offsetMin < 0 ? '-' : '+'
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `.${pad(local.getUTCMilliseconds(), 3)}` +
    `${sign}${pad(Math.trunc(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`
  )
}

/** The local day ('YYYY-MM-DD') an offset-carrying ISO string falls in — the date part as written. */
export function localDayOf(iso: string): string {
  return iso.slice(0, 10)
}

/** The local month ('YYYY-MM') an offset-carrying ISO string falls in — picks the month's ledger. */
export function localMonthOf(iso: string): string {
  return iso.slice(0, 7)
}

/** Round to one decimal — minutes are reported to 0.1, never fake precision. */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// ─── Row computation (§A3.2) ─────────────────────────────────────────────────

/** What the caller measured at close: the O(doc) numbers, computed off the keystroke path. */
export interface CloseMeasurement {
  at: number
  wordsEnd: number
  /** Gross word additions across the session (start→end diff). */
  wordsAdded: number
  /** Gross word deletions across the session (start→end diff). */
  wordsDeleted: number
}

/**
 * Build the persisted row (§A3.2).
 *
 * `prevSessionEndAt` is the epoch ms the PREVIOUS session (in any document — capture is global)
 * closed, or null when this is the ledger's first session → `break_before_min` 0.
 * `offsetMin` is the local UTC offset (see isoWithOffset).
 *
 * `doc_label`, `note` and `place` are OMITTED (not emptied) when absent or suppressed, so a
 * suppressed title or a skipped note leaves no trace at all.
 */
export function buildRow(
  d: SessionDraft,
  close: CloseMeasurement,
  prevSessionEndAt: number | null,
  offsetMin: number,
): SessionRow {
  const note = cleanText(d.note)
  const place = cleanText(d.place, 120)
  return {
    session_id: d.sessionId,
    doc_id: d.docId,
    ...(d.docLabel ? { doc_label: d.docLabel } : {}),
    start: isoWithOffset(d.startedAt, offsetMin),
    end: isoWithOffset(close.at, offsetMin),
    active_minutes: round1(d.activeMs / 60_000),
    words_start: d.wordsStart,
    words_end: close.wordsEnd,
    words_added: close.wordsAdded,
    words_deleted: close.wordsDeleted,
    net_words: close.wordsEnd - d.wordsStart,
    edit_events: d.editEvents,
    break_before_min: prevSessionEndAt === null ? 0 : round1(Math.max(0, d.startedAt - prevSessionEndAt) / 60_000),
    pomodoro: d.pomodoro,
    doc_type: d.docType,
    ...(note ? { note } : {}),
    ...(place ? { place } : {}),
  }
}

/**
 * Is this session worth persisting? A stray keystroke that opens and closes a session is noise, not
 * work. Kept deliberately loose (ANY real edit counts) — §A5's kindness constraint cuts against
 * discarding a writer's thinking-heavy, low-output session.
 */
export function isRecordable(d: SessionDraft): boolean {
  return d.editEvents > 0
}
