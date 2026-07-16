// Client-side daily/weekly/monthly aggregates over the ledger — build-spec §A3.3.
//
// PURE. No clock, no storage, no network, no React, no AI. Every number here is computed from the
// ledger's own bytes and is GROUND TRUTH (§A6.4): these must never round-trip through an LLM, which
// is the whole reason the graphs are worth believing. Keeping the module pure is also what keeps it
// off the load path (§CLAUDE.md load performance) — the caller decides when to run it, and nothing
// in here reads the .studio or walks the doc.
//
// Aggregating client-side is additionally what keeps AI payloads small at any window (§A3.3): the
// AI lane sends these compact rollups, never raw logs.

import type { LedgerSession } from './ledger'
import { localDayOf, localHourOf, monthOf, weekStartOf, weekdayOf } from './ledger'
import { phaseMix, type PhaseMix } from './phase'

// ─── Day ──────────────────────────────────────────────────────────────────────

export interface BreakStats {
  /** Number of gaps BETWEEN sessions counted within the window. */
  count: number
  totalMinutes: number
  medianMinutes: number
  longestMinutes: number
}

export interface DayAggregate {
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
function spreadActiveMinutes(s: LedgerSession, into: number[]): void {
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
export function aggregateDays(sessions: readonly LedgerSession[]): DayAggregate[] {
  const byDay = new Map<string, LedgerSession[]>()
  for (const s of sessions) {
    const day = localDayOf(s.start)
    if (!day) continue
    const list = byDay.get(day)
    if (list) list.push(s); else byDay.set(day, [s])
  }

  const out: DayAggregate[] = []
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
  return { r: clamp(num / den, -1, 1), n, reportable: true }
}

export interface WeekAggregate {
  /** Monday of the ISO week, `YYYY-MM-DD`. */
  weekStart: string
  /** Day rollups present in this week, ascending. Absent days are ABSENT, never fabricated (§A9). */
  days: DayAggregate[]
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

export function aggregateWeeks(days: readonly DayAggregate[], sessions: readonly LedgerSession[]): WeekAggregate[] {
  const byWeek = new Map<string, DayAggregate[]>()
  for (const d of days) {
    const k = weekStartOf(d.day)
    const list = byWeek.get(k)
    if (list) list.push(d); else byWeek.set(k, [d])
  }
  const sessionsByDay = groupSessionsByDay(sessions)

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
  days: DayAggregate[]
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

export function aggregateMonths(weeks: readonly WeekAggregate[], sessions: readonly LedgerSession[]): MonthAggregate[] {
  const byMonth = new Map<string, WeekAggregate[]>()
  // A week can straddle two months; attribute it to the month of its FIRST day that has data, so a
  // week is never double-counted and its totals stay internally consistent.
  for (const w of weeks) {
    const k = monthOf(w.days[0]?.day ?? w.weekStart)
    const list = byMonth.get(k)
    if (list) list.push(w); else byMonth.set(k, [w])
  }
  const sessionsByDay = groupSessionsByDay(sessions)

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
  days: DayAggregate[]
  weeks: WeekAggregate[]
  months: MonthAggregate[]
}

/**
 * Compute every aggregate from a month's ledger rows. Deterministic and pure — same rows in, same
 * numbers out, no clock read.
 */
export function aggregateLedger(sessions: readonly LedgerSession[]): LedgerAggregates {
  const days = aggregateDays(sessions)
  const weeks = aggregateWeeks(days, sessions)
  const months = aggregateMonths(weeks, sessions)
  return { days, weeks, months }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function groupSessionsByDay(sessions: readonly LedgerSession[]): Map<string, LedgerSession[]> {
  const m = new Map<string, LedgerSession[]>()
  for (const s of sessions) {
    const day = localDayOf(s.start)
    if (!day) continue
    const list = m.get(day)
    if (list) list.push(s); else m.set(day, [s])
  }
  return m
}

function deltas(xs: readonly number[]): number[] {
  return xs.slice(1).map((x, i) => round1(x - xs[i]))
}

function sum(xs: readonly number[]): number { return xs.reduce((a, b) => a + b, 0) }
function mean(xs: readonly number[]): number { return xs.length ? sum(xs) / xs.length : 0 }
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)) }
function round1(n: number): number { return Math.round(n * 10) / 10 }
