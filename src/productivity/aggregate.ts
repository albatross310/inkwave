// Client-side aggregates (spec §A3.3) — the ledger → report/graphs seam.
//
// §A6.4 IS WHY THIS IS CLIENT-SIDE: these numbers are MEASURED. They are computed here,
// deterministically, from the writer's own ledger, and the model never gets to hand them back.
// Aggregating here is also what keeps AI payloads small regardless of window (§A6): the report
// sends compact day rollups, not raw logs.
//
// Everything is a pure function of the rows + a clock, so the arithmetic is testable without a disk.
// `feat/prod-graphs` owns the CHARTS; this is the data they read.

import { loadLedger } from './ledgerStore'
import { localDayOf, localHourOf, localMonthOf, monthOf, weekStartOf, weekdayOf } from './sessionLogic'
import { phaseMix, type PhaseMix } from './phase'
import type { DayAggregate, DayNoteDigest, ReportWindow, SessionRow, WindowAggregate, WindowDoc } from './types'

/** Local hour a row started in — its ISO carries the writer's offset, so this IS their local hour. */
const startHourOf = (r: SessionRow): number => Number(r.start.slice(11, 13))

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * §A3.3's drafting-vs-editing signal, as a MEASURED, deterministic rule: the share of the day's
 * gross word churn that was ADDITION. 1 = pure drafting, 0 = pure cutting, 0.5 = balanced revision.
 * A day with no churn has no signal, and says so with 0 rather than inventing a midpoint.
 *
 * Deliberately NOT the model's judged `phase` (§A6.1) — this is a rule anyone can recompute from
 * the same rows and get the same answer.
 */
export function deepShallowRatio(rows: readonly SessionRow[]): number {
  const added = rows.reduce((a, r) => a + r.words_added, 0)
  const deleted = rows.reduce((a, r) => a + r.words_deleted, 0)
  const churn = added + deleted
  return churn === 0 ? 0 : round1(added / churn * 100) / 100
}

/** Roll one local day's rows up (§A3.3). */
export function dayAggregate(day: string, rows: readonly SessionRow[]): DayAggregate {
  const busiest = new Array<number>(24).fill(0)
  // A session's active minutes are attributed to the hour it STARTED in. That is a convention, and
  // the honest one available: the ledger records when a session ran, not minute-by-minute where the
  // work fell inside it, and spreading minutes across a span would invent a distribution we never
  // measured. Sessions are short (a Pomodoro is 25 min), so the attribution is close.
  for (const r of rows) busiest[startHourOf(r)] += r.active_minutes

  // A "break" is a real gap BEFORE a session — the first session of the ledger has none (0).
  const breaks = rows.filter((r) => r.break_before_min > 0)

  return {
    day,
    active_minutes: round1(rows.reduce((a, r) => a + r.active_minutes, 0)),
    session_count: rows.length,
    words_added: rows.reduce((a, r) => a + r.words_added, 0),
    words_deleted: rows.reduce((a, r) => a + r.words_deleted, 0),
    net_words: rows.reduce((a, r) => a + r.net_words, 0),
    edit_events: rows.reduce((a, r) => a + r.edit_events, 0),
    break_count: breaks.length,
    break_total_min: round1(breaks.reduce((a, r) => a + r.break_before_min, 0)),
    deep_shallow_ratio: deepShallowRatio(rows),
    busiest_hours: busiest.map(round1),
  }
}

/** Group rows by their LOCAL day (§A9). */
export function groupByDay(rows: readonly SessionRow[]): Map<string, SessionRow[]> {
  const byDay = new Map<string, SessionRow[]>()
  for (const r of rows) {
    const d = localDayOf(r.start)
    if (!d) continue // unresolvable timestamp — dropped, never filed under a wrong day
    const list = byDay.get(d)
    if (list) list.push(r)
    else byDay.set(d, [r])
  }
  return byDay
}

/** Per-document totals for the content tick-box screen (§A7.3). Carries no prose. */
export function windowDocs(rows: readonly SessionRow[]): WindowDoc[] {
  const byDoc = new Map<string, WindowDoc>()
  for (const r of rows) {
    const cur = byDoc.get(r.doc_id)
    if (cur) {
      cur.active_minutes = round1(cur.active_minutes + r.active_minutes)
      cur.session_count++
      if (!cur.doc_label && r.doc_label) cur.doc_label = r.doc_label
    } else {
      byDoc.set(r.doc_id, {
        doc_id: r.doc_id,
        ...(r.doc_label ? { doc_label: r.doc_label } : {}),
        doc_type: r.doc_type,
        active_minutes: round1(r.active_minutes),
        session_count: 1,
      })
    }
  }
  return [...byDoc.values()].sort((a, b) => b.active_minutes - a.active_minutes)
}

/**
 * The writer's own words for each day (§A7.3 tier 2). Days with nothing written contribute nothing,
 * so an untouched ledger yields an EMPTY digest rather than a list of blanks.
 */
export function noteDigest(rows: readonly SessionRow[]): DayNoteDigest[] {
  const out: DayNoteDigest[] = []
  for (const [day, dayRows] of [...groupByDay(rows).entries()].sort()) {
    const notes = dayRows.map((r) => r.note).filter((n): n is string => !!n)
    const places = [...new Set(dayRows.map((r) => r.place).filter((p): p is string => !!p))]
    if (notes.length || places.length) out.push({ day, notes, places })
  }
  return out
}

// ─── Window bounds ───────────────────────────────────────────────────────────

/** Inclusive local-day bounds for a window, ending on `todayLocal` ('YYYY-MM-DD'). */
export function windowBounds(window: ReportWindow, todayLocal: string): { from: string; to: string } {
  if (window === 'daily') return { from: todayLocal, to: todayLocal }
  if (window === 'weekly') {
    const d = new Date(`${todayLocal}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 6) // the last 7 local days, inclusive
    return { from: d.toISOString().slice(0, 10), to: todayLocal }
  }
  return { from: `${todayLocal.slice(0, 7)}-01`, to: todayLocal } // the calendar month to date
}

/** Every 'YYYY-MM' a [from,to] day range touches — a week can straddle two ledgers. */
export function monthsSpanning(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from.slice(0, 7)
  const last = to.slice(0, 7)
  for (let i = 0; i < 24 && cur <= last; i++) {
    out.push(cur)
    const [y, m] = cur.split('-').map(Number)
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  return out
}

// ─── The seam ────────────────────────────────────────────────────────────────

/** Build a window from rows already loaded — pure, so the whole shape is testable. */
export function buildWindow(
  window: ReportWindow,
  todayLocal: string,
  rows: readonly SessionRow[],
): WindowAggregate {
  const { from, to } = windowBounds(window, todayLocal)
  const inWindow = rows.filter((r) => {
    const d = localDayOf(r.start)
    return d >= from && d <= to
  })
  const days = [...groupByDay(inWindow).entries()].sort().map(([day, rs]) => dayAggregate(day, rs))
  const digest = noteDigest(inWindow)

  return {
    window,
    from,
    to,
    days,
    // §A6.4 (see types.ts): raw session rows only at DAILY, where judged rows are per-session. At
    // weekly/monthly the day rollups are the ONLY copy of the measured numbers, and the writer's
    // opted-in words travel as the digest.
    sessions: window === 'daily' ? [...inWindow] : [],
    ...(digest.length ? { note_digest: digest } : {}),
    docs: windowDocs(inWindow),
  }
}

/** Read the writer's ledger(s) and build the window. Returns null only if there is no data at all. */
export async function loadWindowFromLedger(
  window: ReportWindow,
  todayLocal: string,
): Promise<WindowAggregate | null> {
  const { from, to } = windowBounds(window, todayLocal)
  const rows: SessionRow[] = []
  for (const m of monthsSpanning(from, to)) rows.push(...(await loadLedger(m)).rows)
  if (rows.length === 0) return null // honest: no ledger yet — never invent numbers to fill a screen
  return buildWindow(window, todayLocal, rows)
}

/** The month a day belongs to — re-exported for callers that only import this module. */
export const monthOfDay = (day: string): string => localMonthOf(day)


// ═══ THE CHART AGGREGATES (§A3.3) — `feat/prod-graphs`' rollups ══════════════════════════════════
//
// MERGED 2026-07-17 (feat/prod-integrate). Both lanes wrote an `aggregate.ts`; this is ONE module
// now, over ONE schema. What was reconciled, and what deliberately was not:
//
// • ONE ROW TYPE. The graphs lane built against `ledger.ts`'s `LedgerSession` — an explicit
//   placeholder mirror of §A3.2, retired here in favour of the real `SessionRow` (types.ts), and
//   the day-grouping/rounding/time rules below are now the same ones the window builder uses.
//   That is the swap its own THE LEDGER SEAM comment anticipated.
//
// • TWO OUTPUT SHAPES, KEPT — they answer different questions and are NOT a fork:
//     `DayAggregate`      (types.ts, snake_case) = the §A3.3 WIRE contract the report payload emits.
//     `ChartDayAggregate` (here,     camelCase)  = the view model the SVG charts read.
//   The graphs lane's `DayAggregate` was renamed to `ChartDayAggregate` because two exported types
//   sharing one name in one module is exactly how a caller silently gets the wrong contract. The
//   wire name belongs to the schema owner.
//
// • THE HOUR HISTOGRAMS DIFFER ON PURPOSE, and both are honest about it: `busiest_hours` (above)
//   attributes a session's minutes to the hour it STARTED in; `hourHistogram` (below) apportions
//   them across the hours the session spans. Both conserve total active minutes, so they cannot
//   contradict each other on any total — they differ only in how they distribute WITHIN a day, and
//   each documents its own limitation. Collapsing them would have silently rewritten one lane's
//   measured behaviour to make a merge look tidy.
//
// PURE. No clock, no storage, no network, no React, no AI. Every number here is computed from the
// ledger's own bytes and is GROUND TRUTH (§A6.4): these must never round-trip through an LLM, which
// is the whole reason the graphs are worth believing.

// ─── Day ──────────────────────────────────────────────────────────────────────

export interface BreakStats {
  /** Number of gaps BETWEEN sessions counted within the window. */
  count: number
  totalMinutes: number
  medianMinutes: number
  longestMinutes: number
}

export interface ChartDayAggregate {
  /** Local calendar day, `YYYY-MM-DD` (§A9). */
  day: string
  activeMinutes: number
  sessionCount: number
  /** Gross additions across the day. */
  wordsAdded: number
  /** Gross deletions. NOT a failure metric — cutting is writing (§A5). */
  wordsDeleted: number
  /** Sum of per-session net; can be negative on a heavy editing day. */
  netWords: number
  editEvents: number
  breaks: BreakStats
  /** Deep-vs-shallow BY HEURISTIC — an estimate, not a measurement. See phase.ts. */
  phases: PhaseMix
  /** 24 buckets, index = local hour, value = active minutes attributed to that hour. */
  hourHistogram: number[]
  pomodoroSessions: number
  /** Minutes per doc_type — lets "40m on email" be read off the day (§B2.1). */
  minutesByDocType: Record<string, number>
  /** Distinct documents touched. */
  docCount: number
}

/**
 * Attribute a session's ACTIVE minutes across the wall-clock hours it spans.
 *
 * Honest limitation, stated rather than hidden: the ledger records a session's start/end and its
 * active_minutes, but NOT which minutes inside the span were active. So active time is spread
 * proportionally over the hours the session covers. For a session inside one hour this is exact; for
 * a session straddling hours it is an apportionment. The histogram is therefore reliable at the
 * "which part of the day do you write in" scale it is drawn at, and should not be read as a
 * minute-accurate record of any single hour.
 */
function spreadActiveMinutes(s: SessionRow, into: number[]): void {
  const t0 = Date.parse(s.start), t1 = Date.parse(s.end)
  const startHour = localHourOf(s.start)
  const spanMin = Number.isNaN(t0) || Number.isNaN(t1) ? 0 : (t1 - t0) / 60_000

  if (!(spanMin > 0) || s.active_minutes <= 0) {
    if (s.active_minutes > 0) into[startHour] += s.active_minutes
    return
  }
  // Walk the span hour by hour, apportioning active minutes by each hour's share of the span.
  const density = s.active_minutes / spanMin
  let cursor = 0
  let hour = startHour
  // Minutes from the session start to the first hour boundary.
  const startMinuteInHour = (Date.parse(s.start) + hourOffsetMs(s.start)) % 3_600_000 / 60_000
  let toBoundary = 60 - startMinuteInHour
  while (cursor < spanMin) {
    const chunk = Math.min(toBoundary, spanMin - cursor)
    into[hour % 24] += chunk * density
    cursor += chunk
    hour = (hour + 1) % 24
    toBoundary = 60
  }
}

/** The ms offset embedded in an ISO string (or 0 for `Z`/absent) — used to find local hour boundaries. */
function hourOffsetMs(iso: string): number {
  const m = /(Z|[+-]\d{2}:?\d{2})$/.exec(iso.trim())
  if (!m || m[1] === 'Z') return 0
  const sign = m[1][0] === '-' ? -1 : 1
  const body = m[1].slice(1).replace(':', '')
  return sign * (Number(body.slice(0, 2)) * 60 + Number(body.slice(2, 4))) * 60_000
}

function breakStats(gaps: number[]): BreakStats {
  if (gaps.length === 0) return { count: 0, totalMinutes: 0, medianMinutes: 0, longestMinutes: 0 }
  const sorted = [...gaps].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    count: gaps.length,
    totalMinutes: round1(gaps.reduce((a, b) => a + b, 0)),
    medianMinutes: round1(median),
    longestMinutes: round1(sorted[sorted.length - 1]),
  }
}

/** Group ledger rows into per-day aggregates, ascending by day. */
export function aggregateDays(sessions: readonly SessionRow[]): ChartDayAggregate[] {
  const byDay = new Map<string, SessionRow[]>()
  for (const s of sessions) {
    const day = localDayOf(s.start)
    if (!day) continue
    const list = byDay.get(day)
    if (list) list.push(s); else byDay.set(day, [s])
  }

  const out: ChartDayAggregate[] = []
  for (const [day, rows] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = [...rows].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    const hourHistogram = new Array(24).fill(0)
    const minutesByDocType: Record<string, number> = {}
    const docs = new Set<string>()
    let activeMinutes = 0, wordsAdded = 0, wordsDeleted = 0, netWords = 0, editEvents = 0, pomodoroSessions = 0

    for (const s of ordered) {
      activeMinutes += s.active_minutes
      wordsAdded += s.words_added
      wordsDeleted += s.words_deleted
      netWords += s.net_words
      editEvents += s.edit_events
      if (s.pomodoro) pomodoroSessions++
      docs.add(s.doc_id)
      minutesByDocType[s.doc_type] = round1((minutesByDocType[s.doc_type] ?? 0) + s.active_minutes)
      spreadActiveMinutes(s, hourHistogram)
    }

    // Only gaps BETWEEN this day's sessions count as the day's breaks — the first session's
    // break_before_min reaches back to the previous day (often overnight) and would swamp the stat.
    const gaps = ordered.slice(1).map(s => s.break_before_min).filter(n => Number.isFinite(n) && n > 0)

    out.push({
      day,
      activeMinutes: round1(activeMinutes),
      sessionCount: ordered.length,
      wordsAdded, wordsDeleted, netWords, editEvents,
      breaks: breakStats(gaps),
      phases: phaseMix(ordered),
      hourHistogram: hourHistogram.map(round1),
      pomodoroSessions,
      minutesByDocType,
      docCount: docs.size,
    })
  }
  return out
}

// ─── Week ─────────────────────────────────────────────────────────────────────

/**
 * A descriptive association between break-taking and output (§A3.3: "break-vs-output correlations
 * (DESCRIPTIVE ONLY)").
 *
 * This is a Pearson r over days. It is an ASSOCIATION IN THIS WINDOW and nothing more — it cannot
 * establish that breaks cause output (the writer who takes more breaks may simply be having a longer
 * day). The panel renders it with a descriptive caption only, and never at the daily window (§A6.2).
 * `n` travels with `r` so a coefficient can never be read without its sample size.
 */
export interface Correlation {
  r: number
  n: number
  /** False when n is too small for the number to mean anything — the UI must not render it. */
  reportable: boolean
}

/** Below this, a correlation is noise dressed as a number. */
export const MIN_CORRELATION_N = 5

export function pearson(xs: readonly number[], ys: readonly number[]): Correlation {
  const n = Math.min(xs.length, ys.length)
  if (n < MIN_CORRELATION_N) return { r: 0, n, reportable: false }
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n))
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  const den = Math.sqrt(dx2 * dy2)
  // Zero variance on either axis ⇒ r is undefined, not zero. Don't report a made-up 0.
  if (den === 0) return { r: 0, n, reportable: false }

  const r = num / den
  // ─── WHY THIS IS NOT A CLAMP ────────────────────────────────────────────────
  // For a correct Pearson, Cauchy–Schwarz puts |r| ≤ 1 ALWAYS: a clamp to [-1, 1] is unreachable in
  // working code, and the only thing it can ever actually do is disguise a BROKEN formula as a
  // plausible number. That is not hypothetical — this function shipped with `clamp(num/den, -1, 1)`
  // and an external audit dropped the Y spread from the denominator (`sqrt(dx2*dy2)` →
  // `sqrt(dx2*dx2)`); the mutant computed r=2 for a perfectly-correlated fixture and the clamp
  // returned exactly the 1.0 the test asserted. The whole 1054-test repo stayed green while a
  // correlation shown to the writer would have read 1.0 ("your breaks predict your output") where
  // the truth was 0.70. The clamp was load-bearing for the bug, not for the user.
  //
  // So: snap only the floating-point hair (a legitimate ±1 can land at 1.0000000000000002), and
  // REFUSE anything grossly out of range. An impossible r means the maths is wrong, and the honest
  // response to "my measurement is impossible" is to stop reporting it — not to round it into the
  // range where it looks fine. Unreportable is the one answer that cannot mislead (§A6.1).
  if (!Number.isFinite(r) || Math.abs(r) > 1 + 1e-9) return { r: 0, n, reportable: false }
  return { r: clamp(r, -1, 1), n, reportable: true }
}

export interface WeekAggregate {
  /** Monday of the ISO week, `YYYY-MM-DD`. */
  weekStart: string
  /** Day rollups present in this week, ascending. Absent days are ABSENT, never fabricated (§A9). */
  days: ChartDayAggregate[]
  activeMinutes: number
  sessionCount: number
  wordsAdded: number
  wordsDeleted: number
  netWords: number
  /** Active minutes per weekday, index 0 = Monday … 6 = Sunday. Days with no data stay 0. */
  weekdayMinutes: number[]
  /** Days (of those present) that had any active time — the honest denominator for "days written". */
  daysWritten: number
  phases: PhaseMix
  hourHistogram: number[]
  /** Break minutes vs gross words, across this week's days. Descriptive only; see Correlation. */
  breakVsOutput: Correlation
}

export function aggregateWeeks(days: readonly ChartDayAggregate[], sessions: readonly SessionRow[]): WeekAggregate[] {
  const byWeek = new Map<string, ChartDayAggregate[]>()
  for (const d of days) {
    const k = weekStartOf(d.day)
    const list = byWeek.get(k)
    if (list) list.push(d); else byWeek.set(k, [d])
  }
  const sessionsByDay = groupByDay(sessions)

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, ds]) => {
      const daysSorted = [...ds].sort((a, b) => a.day.localeCompare(b.day))
      const weekdayMinutes = new Array(7).fill(0)
      const hourHistogram = new Array(24).fill(0)
      for (const d of daysSorted) {
        weekdayMinutes[weekdayOf(d.day)] += d.activeMinutes
        for (let h = 0; h < 24; h++) hourHistogram[h] += d.hourHistogram[h]
      }
      const weekSessions = daysSorted.flatMap(d => sessionsByDay.get(d.day) ?? [])
      return {
        weekStart,
        days: daysSorted,
        activeMinutes: round1(sum(daysSorted.map(d => d.activeMinutes))),
        sessionCount: sum(daysSorted.map(d => d.sessionCount)),
        wordsAdded: sum(daysSorted.map(d => d.wordsAdded)),
        wordsDeleted: sum(daysSorted.map(d => d.wordsDeleted)),
        netWords: sum(daysSorted.map(d => d.netWords)),
        weekdayMinutes: weekdayMinutes.map(round1),
        daysWritten: daysSorted.filter(d => d.activeMinutes > 0).length,
        phases: phaseMix(weekSessions),
        hourHistogram: hourHistogram.map(round1),
        breakVsOutput: pearson(
          daysSorted.map(d => d.breaks.totalMinutes),
          daysSorted.map(d => d.wordsAdded),
        ),
      }
    })
}

// ─── Month ────────────────────────────────────────────────────────────────────

export interface MonthAggregate {
  /** `YYYY-MM`. */
  month: string
  weeks: WeekAggregate[]
  days: ChartDayAggregate[]
  activeMinutes: number
  wordsAdded: number
  netWords: number
  sessionCount: number
  daysWritten: number
  phases: PhaseMix
  /** Week-over-week deltas in active minutes — `weeks[i] - weeks[i-1]`, so length = weeks-1. */
  weekOverWeekMinutes: number[]
  /** Week-over-week deltas in gross words. */
  weekOverWeekWords: number[]
}

export function aggregateMonths(weeks: readonly WeekAggregate[], sessions: readonly SessionRow[]): MonthAggregate[] {
  const byMonth = new Map<string, WeekAggregate[]>()
  // A week can straddle two months; attribute it to the month of its FIRST day that has data, so a
  // week is never double-counted and its totals stay internally consistent.
  for (const w of weeks) {
    const k = monthOf(w.days[0]?.day ?? w.weekStart)
    const list = byMonth.get(k)
    if (list) list.push(w); else byMonth.set(k, [w])
  }
  const sessionsByDay = groupByDay(sessions)

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, ws]) => {
      const weeksSorted = [...ws].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      const days = weeksSorted.flatMap(w => w.days)
      const monthSessions = days.flatMap(d => sessionsByDay.get(d.day) ?? [])
      return {
        month,
        weeks: weeksSorted,
        days,
        activeMinutes: round1(sum(weeksSorted.map(w => w.activeMinutes))),
        wordsAdded: sum(weeksSorted.map(w => w.wordsAdded)),
        netWords: sum(weeksSorted.map(w => w.netWords)),
        sessionCount: sum(weeksSorted.map(w => w.sessionCount)),
        daysWritten: sum(weeksSorted.map(w => w.daysWritten)),
        phases: phaseMix(monthSessions),
        weekOverWeekMinutes: deltas(weeksSorted.map(w => w.activeMinutes)),
        weekOverWeekWords: deltas(weeksSorted.map(w => w.wordsAdded)),
      }
    })
}

/** The whole client-side aggregate set — one pass over the ledger (§A3.3). */
export interface LedgerAggregates {
  days: ChartDayAggregate[]
  weeks: WeekAggregate[]
  months: MonthAggregate[]
}

/**
 * Compute every aggregate from a month's ledger rows. Deterministic and pure — same rows in, same
 * numbers out, no clock read.
 */
export function aggregateLedger(sessions: readonly SessionRow[]): LedgerAggregates {
  const days = aggregateDays(sessions)
  const weeks = aggregateWeeks(days, sessions)
  const months = aggregateMonths(weeks, sessions)
  return { days, weeks, months }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function deltas(xs: readonly number[]): number[] {
  return xs.slice(1).map((x, i) => round1(x - xs[i]))
}

function sum(xs: readonly number[]): number { return xs.reduce((a, b) => a + b, 0) }
function mean(xs: readonly number[]): number { return xs.length ? sum(xs) / xs.length : 0 }
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)) }
