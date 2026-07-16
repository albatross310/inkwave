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
import { localDayOf, localMonthOf } from './sessionLogic'
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
