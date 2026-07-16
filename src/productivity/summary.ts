// The descriptive recap copy — build-spec §A5, §C3.
//
// "The tone must be KIND and REFLECTIVE, never shaming. A low-output day should read as
// understanding ('lighter day — you did X focused minutes on Y'), never as a scolding or a red
// 'productivity down' alert. Productivity-guilt tooling gets deleted and is bad for users; this is a
// hard constraint, not a nicety."
//
// So the copy lives HERE, as pure functions, rather than as strings scattered through JSX — because
// a hard constraint you can't test is a hope. summary.test.ts asserts the tone properties directly
// (no shaming vocabulary, no target comparisons, no output-only verdicts) across the whole range
// from an empty day to a huge one.
//
// THE RULES THIS MODULE OBEYS:
//  1. Never compare the writer to a target, a goal, a streak, or their own past. A number is
//     reported; it is not scored. (§A1 non-goals: no imposed "productivity score".)
//  2. Never use diminishing words — "only", "just", "merely" — before a quantity.
//  3. A light day is described in terms of what WAS done, never what wasn't.
//  4. Deleting words is writing. Cutting is never framed as loss or damage.
//  5. Daily says what happened. It never says what it means (§A6.2 — that's a pattern claim).

import type { ChartDayAggregate as DayAggregate } from './aggregate'

/** "1h 20m" / "45m" / "0m" — never a bare decimal, never a percentage of anything. */
export function formatMinutes(mins: number): string {
  const m = Math.round(mins)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

/** The day's headline. Descriptive, warm, and never a verdict. */
export function dayHeadline(d: DayAggregate): string {
  if (d.sessionCount === 0 || d.activeMinutes === 0) {
    // A day away from the desk is a legitimate day. It is not a failure to be flagged.
    return 'No writing recorded today — rest counts too.'
  }
  const time = formatMinutes(d.activeMinutes)
  const sessions = d.sessionCount === 1 ? 'one session' : `${d.sessionCount} sessions`

  // "Lighter day" is the spec's own phrasing for a small day: it names the shape of the day without
  // implying a shortfall. The threshold is a description, not a target — nothing is measured against it.
  if (d.activeMinutes < 30) return `A lighter day — ${time} of focused writing.`
  return `${time} of focused writing across ${sessions}.`
}

/**
 * The supporting line: what the time went into. Words are reported as work done, in both directions
 * — added AND cut — because a session spent cutting 300 words is a session's work, not a setback.
 */
export function dayDetail(d: DayAggregate): string[] {
  if (d.sessionCount === 0) return []
  const out: string[] = []

  if (d.wordsAdded > 0 || d.wordsDeleted > 0) {
    const parts: string[] = []
    if (d.wordsAdded > 0) parts.push(`${d.wordsAdded.toLocaleString()} words written`)
    // Deliberately "shaped" / "cut", never "lost" or "destroyed".
    if (d.wordsDeleted > 0) parts.push(`${d.wordsDeleted.toLocaleString()} cut while shaping it`)
    out.push(parts.join(', '))
  }

  // Doc-type split — the §B2.1 "40m on email" read.
  const types = Object.entries(d.minutesByDocType).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1])
  if (types.length > 1) {
    out.push(types.map(([t, m]) => `${formatMinutes(m)} on ${t}`).join(' · '))
  }

  if (d.breaks.count > 0) {
    const b = d.breaks.count === 1 ? 'one break' : `${d.breaks.count} breaks`
    out.push(`${b}, ${formatMinutes(d.breaks.totalMinutes)} away from the desk`)
  }

  if (d.pomodoroSessions > 0) {
    out.push(`${d.pomodoroSessions} timed ${d.pomodoroSessions === 1 ? 'block' : 'blocks'}`)
  }

  return out
}

/**
 * The daily window's standing caveat (§A6.2). Rendered on the daily view, always — it is the thing
 * that stops a reader inferring a pattern from a single day, and it is why the daily view carries no
 * causal claim of any kind.
 */
export const DAILY_CAVEAT = 'This is a recap of one day — too little to show a pattern. The weekly view is where trends start to mean something.'

/** The weekly/monthly framing for the descriptive break-vs-output stat. Never causal. */
export function describeCorrelation(r: number, n: number): string {
  const strength = Math.abs(r) < 0.3 ? 'little visible' : Math.abs(r) < 0.6 ? 'a loose' : 'a clear'
  const direction = r > 0 ? 'more' : 'fewer'
  if (Math.abs(r) < 0.3) {
    return `Across these ${n} days there's ${strength} relationship between break time and words written.`
  }
  // Note the phrasing: "went with", never "led to" / "caused" / "because". This is an association in
  // one window, and the sentence must not be readable as advice.
  return `Across these ${n} days, more break time went with ${direction} words written — ${strength} association in this window only, not a cause.`
}
