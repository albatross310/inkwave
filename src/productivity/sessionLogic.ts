// Session boundary detection + row computation (spec §A2, §A4) — PURE.
//
// Everything here is a pure function of its arguments (clock injected), so the boundary rules and
// the arithmetic are unit-testable without an editor, a DOM or a disk. The impure orchestration
// (timers, the edit stream, disk writes) lives in capture.ts.
//
// ⚠ `words_start` IS CARRIED IN FROM THE PREVIOUS CLOSE, never counted at open — the per-keystroke
// path may do NO O(doc) work. Exact, not approximate: a boundary IS an inactivity gap, and the
// document cannot change while nobody is editing it. → docs/archive/productivity-email-build.md#session-typing-shape

import type { DocType, Reflection, SessionRow } from './types'

/** Inactivity gap that closes a session (§A4 default 5 min). */
export const DEFAULT_IDLE_MS = 5 * 60_000

/**
 * The most one inter-edit gap may contribute to `active_minutes` (§A3.2 excludes idle within a
 * session). A NAMED constant so the number stays explainable — "we count up to 60s of thinking
 * between two keystrokes as working time" — rather than a black box; it is the one judgement call
 * in the arithmetic. → docs/archive/productivity-email-build.md#session-active-cap
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

/**
 * Open a new draft. The opening edit contributes no active time (there is no gap yet).
 *
 * ⚠ `edits` is 1 when a KEYSTROKE opened the session and 0 when the TIMER did — a Pomodoro block
 * opens with no edit behind it (reading printed paper), and a phantom `edit_events: 1` would claim
 * a keystroke that never happened. → docs/archive/productivity-email-build.md#session-open-edits
 */
export function openDraft(opts: {
  sessionId: string
  docId: string
  docLabel?: string
  docType: DocType
  pomodoro: boolean
  at: number
  wordsStart: number
  edits?: number
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
    editEvents: opts.edits ?? 1,
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
 * `2026-07-17T09:14:03.000+10:00`. ⚠ NEVER A BARE `Z`: §A9 aggregates in the writer's LOCAL day and
 * a `Z` string loses it. `offsetMin` is minutes to ADD to UTC (Brisbane = +600) — the negation of
 * `getTimezoneOffset()`, injected so tests are timezone-independent.
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

// ─── Local-day / local-hour resolution (§A9) — THE ONE TIME RULE ─────────────
// ⚠ ROLL UP BY THE WRITER'S LOCAL DAY, never the UTC day, and read the offset OUT OF THE ISO STRING
// — so aggregation is a pure function of the ledger's own bytes and cannot depend on the machine's
// TZ (fixtures carry explicit offsets for the same reason). These five functions are the ONE
// implementation; the graphs lane's `ledger.ts` mirror was retired into them (R2).
// → docs/archive/productivity-email-build.md#session-local-day

/** Matches a trailing `Z` or `±HH:MM` / `±HHMM` offset on an ISO-8601 timestamp. */
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/

/**
 * The local calendar day (`YYYY-MM-DD`) an ISO timestamp falls in, honouring its own UTC offset.
 * Falls back to the runtime's local day when the string carries no offset at all, and returns ''
 * for input that is not a date — never a wrong day.
 */
export function localDayOf(iso: string): string {
  const m = OFFSET_RE.exec(iso.trim())
  if (!m) {
    // No offset in the data → the only meaning available is the runtime's local day.
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const offMin = m[1] === 'Z' ? 0 : offsetMinutes(m[1])
  // Shift into the writer's wall clock, then read the date parts in UTC.
  const shifted = new Date(t + offMin * 60_000)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/** The local wall-clock hour (0–23) an ISO timestamp falls in — the busiest-hours histogram's bucket. */
export function localHourOf(iso: string): number {
  const m = OFFSET_RE.exec(iso.trim())
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  if (!m) return new Date(iso).getHours()
  const offMin = m[1] === 'Z' ? 0 : offsetMinutes(m[1])
  return new Date(t + offMin * 60_000).getUTCHours()
}

function offsetMinutes(off: string): number {
  const sign = off[0] === '-' ? -1 : 1
  const body = off.slice(1).replace(':', '')
  return sign * (Number(body.slice(0, 2)) * 60 + Number(body.slice(2, 4)))
}

/** The local month ('YYYY-MM') an offset-carrying ISO string falls in — picks the month's ledger. */
export function localMonthOf(iso: string): string {
  return iso.slice(0, 7)
}

/** ISO weekday index for a `YYYY-MM-DD` day key: 0 = Monday … 6 = Sunday. */
export function weekdayOf(dayKey: string): number {
  const d = new Date(`${dayKey}T00:00:00Z`)
  return (d.getUTCDay() + 6) % 7
}

/** The Monday (`YYYY-MM-DD`) of the ISO week containing `dayKey`. */
export function weekStartOf(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - weekdayOf(dayKey))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The `YYYY-MM` month a day key falls in. */
export function monthOf(dayKey: string): string { return dayKey.slice(0, 7) }

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
 * Build the persisted row (§A3.2). `prevSessionEndAt` is the epoch ms the PREVIOUS session (in any
 * document — capture is global) closed, or null for the ledger's first → `break_before_min` 0.
 * ⚠ `doc_label`, `note` and `place` are OMITTED, never emptied, so a suppressed title or a skipped
 * note leaves no trace at all.
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
    // STATED, never left to absence. Everything reaching buildRow came off the timer's own capture.
    entered: 'timer',
    ...(note ? { note } : {}),
    ...(place ? { place } : {}),
  }
}

/**
 * Did this row's time come from the writer's memory rather than the timer?
 *
 * ⚠ THE ONE PLACE `entered` IS READ, and it asks the POSITIVE question: a row must CLAIM to be
 * testimony to be treated as testimony, so nothing re-derives it as `!row.entered`. Here rather
 * than in `aggregate.ts` so the panel can ask without dragging the rollup layer in.
 * → docs/archive/productivity-email-build.md#session-ispost-hoc
 */
export function isPostHoc(r: SessionRow): boolean {
  return r.entered === 'post-hoc'
}

/**
 * Split rows by where their time came from. Every consumer that TOTALS anything starts here, so
 * "measured" and "told to us" cannot be accidentally summed.
 *
 * ⚠ EXPORTED because the drop-up's `daySummary` is a REAL caller: it summed all rows and reported
 * 45 remembered minutes as "focused minutes" with every unit test green (they guard `aggregate.ts`,
 * which the panel never calls). → docs/archive/productivity-email-build.md#session-ispost-hoc
 */
export function splitByEntry(rows: readonly SessionRow[]): { measured: SessionRow[]; postHoc: SessionRow[] } {
  const measured: SessionRow[] = [], postHoc: SessionRow[] = []
  for (const r of rows) (isPostHoc(r) ? postHoc : measured).push(r)
  return { measured, postHoc }
}

/** The most a post-hoc block may claim. Longer is a day, not a session — and a rough number, at that. */
export const POSTHOC_MAX_MINUTES = 8 * 60

/** What the writer tells us afterwards. Rough duration, rough category — that is the whole form. */
export interface PostHocEntry {
  /** Roughly how long. Minutes. */
  minutes: number
  /** Roughly what. Their pick, never our guess. */
  docType: DocType
  /** Optional — their own words, same class as `note`. Opt-in, omitted when blank. */
  note?: string
}

/**
 * Build a row the writer TOLD us about (§A5's repair tool).
 *
 * ⚠ DO NOT MAKE HIM PRECISE — a form demanding start/end times will not get used on a Tuesday. The
 * input is a rough duration and a rough category; the span is derived (ends when he told us,
 * reaches back by what he said) and `entered: 'post-hoc'` flags the WHOLE row as testimony.
 * ⚠ EVERY MEASURED FIELD IS ZERO AND THAT IS THE TRUE VALUE, not missing data: we did not see him
 * type. `break_before_min` is 0 because a break is a gap between two MEASURED sessions.
 * → docs/archive/productivity-email-build.md#session-posthoc-row
 */
export function buildPostHocRow(
  entry: PostHocEntry,
  opts: { sessionId: string; at: number; offsetMin: number },
): SessionRow {
  const minutes = round1(Math.max(0, Math.min(entry.minutes, POSTHOC_MAX_MINUTES)))
  const note = cleanText(entry.note)
  return {
    session_id: opts.sessionId,
    // ⚠ NOT the open document: he is repairing the RECORD, and the work may not have been in
    // Inkwave at all. Attributing it to whatever was on screen is a guess in measurement's clothes.
    doc_id: 'post-hoc',
    start: isoWithOffset(opts.at - minutes * 60_000, opts.offsetMin),
    end: isoWithOffset(opts.at, opts.offsetMin),
    active_minutes: minutes,
    words_start: 0,
    words_end: 0,
    words_added: 0,
    words_deleted: 0,
    net_words: 0,
    edit_events: 0,
    break_before_min: 0,
    pomodoro: false,
    doc_type: entry.docType,
    entered: 'post-hoc',
    ...(note ? { note } : {}),
  }
}

/**
 * Is this session worth persisting?
 *
 * ANY real edit counts — a thinking-heavy, low-output session is still work, and discarding it is
 * the judgement §A5 forbids. ⚠ AND A POMODORO BLOCK COUNTS WITH NO EDITS AT ALL: `editEvents > 0`
 * silently dropped every paper-reading block on its way to the ledger.
 * → docs/archive/productivity-email-build.md#session-recordable
 */
export function isRecordable(d: SessionDraft): boolean {
  return d.editEvents > 0 || d.pomodoro
}


// ─── The reflection prompt (§A5b — "what did I actually do?") ────────────────

/**
 * Active minutes that must accrue before the writer is asked to reflect.
 *
 * ⚠ ACTIVE minutes, not clock minutes and not per Pomodoro block (a toll booth every 25 minutes
 * kills the ritual), and not at day's close (you cannot remember by then). Once per stretch, never
 * re-prompted, always skippable — a skipped reflection is not a failure and nothing may treat it as
 * one. → docs/archive/productivity-email-build.md#session-reflection
 */
export const REFLECT_AFTER_ACTIVE_MS = 25 * 60_000

/**
 * Should we offer the reflection now? PURE. ASKING IS OFFERING: true at most once per stretch
 * because accepting or skipping resets the accumulator, never because we track compliance.
 */
export function shouldOfferReflection(activeMsSinceLastReflection: number): boolean {
  return activeMsSinceLastReflection >= REFLECT_AFTER_ACTIVE_MS
}

/**
 * The rows a reflection has not yet spoken for, for the given local day. PURE.
 *
 * ⚠ ONE RULE for "what counts as unreflected": the drop-up SHOWS the prompt and the session-close
 * watcher OPENS the panel to it, and two copies would drift (R2). Spoken-for = ends at/before the
 * newest reflection's `to`.
 * ⚠ §A6.1: MEASURED ROWS ONLY. The prompt shows these minutes back as "focused minutes" and the
 * gate opens the panel on their total, so a remembered block reaching either one merges testimony
 * into measurement — and asks the writer to recall a stretch they have already described.
 */
export function unreflectedRows(rows: SessionRow[], reflections: Reflection[], todayLocal: string): SessionRow[] {
  const last = reflections.reduce<string>((a, r) => (r.to > a ? r.to : a), '')
  const { measured } = splitByEntry(rows)
  return measured.filter((r) => localDayOf(r.start) === todayLocal && r.end > last)
}

/**
 * Whether a longer session has closed with enough UNREFLECTED active time to be worth asking about
 * (Peter, 2026-07-17: "at the end of every longer session"). PURE; the caller supplies today's local
 * day. This is the gate the session-close watcher uses to decide whether to surface the reflection —
 * so it opens the panel only for a stretch actually worth reflecting on, never on every row.
 */
export function reflectionDue(rows: SessionRow[], reflections: Reflection[], todayLocal: string): boolean {
  const activeMs = unreflectedRows(rows, reflections, todayLocal).reduce((a, r) => a + r.active_minutes * 60_000, 0)
  return shouldOfferReflection(activeMs)
}
