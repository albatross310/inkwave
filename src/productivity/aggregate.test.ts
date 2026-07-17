import { describe, expect, it } from 'vitest'
import {
  aggregateDays, aggregateLedger, aggregateWeeks, buildWindow, dayAggregate, deepShallowRatio,
  MIN_CORRELATION_N, monthsSpanning, noteDigest, pearson, windowBounds, windowDocs,
} from './aggregate'
import type { SessionRow } from './types'

// MERGED 2026-07-17 (feat/prod-integrate): BOTH lanes' aggregate suites, intact. The prod-ledger
// window-builder tests are first; `feat/prod-graphs`' chart-rollup tests follow verbatim below —
// only their imports moved (its `LedgerSession` mirror is now the real `SessionRow`). Every
// assertion from both lanes still runs: the two rollups answer different questions (see
// aggregate.ts) and neither lane's measured behaviour was rewritten to make the merge pass.

function row(over: Partial<SessionRow> & { start: string }): SessionRow {
  return {
    session_id: `s-${over.start}`,
    doc_id: 'd1',
    end: over.start,
    active_minutes: 30,
    words_start: 0,
    words_end: 100,
    words_added: 100,
    words_deleted: 0,
    net_words: 100,
    edit_events: 200,
    break_before_min: 0,
    pomodoro: false,
    doc_type: 'essay',
    entered: 'timer',
    ...over,
  }
}

describe('deepShallowRatio (§A3.3 — measured, not judged)', () => {
  it('1 = pure drafting, 0 = pure cutting, 0.5 = balanced revision', () => {
    expect(deepShallowRatio([row({ start: 'x', words_added: 100, words_deleted: 0 })])).toBe(1)
    expect(deepShallowRatio([row({ start: 'x', words_added: 0, words_deleted: 100 })])).toBe(0)
    expect(deepShallowRatio([row({ start: 'x', words_added: 50, words_deleted: 50 })])).toBe(0.5)
  })

  it('a day with no churn has NO signal and says 0 rather than inventing a midpoint', () => {
    expect(deepShallowRatio([row({ start: 'x', words_added: 0, words_deleted: 0 })])).toBe(0)
    expect(deepShallowRatio([])).toBe(0)
  })
})

describe('dayAggregate (§A3.3)', () => {
  const rows = [
    row({ start: '2026-07-17T09:00:00.000+10:00', active_minutes: 25, words_added: 300, words_deleted: 20, net_words: 280, edit_events: 500 }),
    row({ start: '2026-07-17T14:00:00.000+10:00', active_minutes: 40, words_added: 100, words_deleted: 80, net_words: 20, edit_events: 300, break_before_min: 45 }),
  ]

  it('sums the day and buckets active minutes by LOCAL start hour', () => {
    const a = dayAggregate('2026-07-17', rows)
    expect(a.session_count).toBe(2)
    expect(a.active_minutes).toBe(65)
    expect(a.words_added).toBe(400)
    expect(a.words_deleted).toBe(100)
    expect(a.net_words).toBe(300)
    expect(a.edit_events).toBe(800)
    expect(a.busiest_hours).toHaveLength(24)
    expect(a.busiest_hours[9]).toBe(25)
    expect(a.busiest_hours[14]).toBe(40)
    expect(a.busiest_hours.reduce((x, y) => x + y, 0)).toBe(65) // nothing invented, nothing lost
  })

  it('counts only REAL breaks — a first session (0) is not a break', () => {
    const a = dayAggregate('2026-07-17', rows)
    expect(a.break_count).toBe(1)
    expect(a.break_total_min).toBe(45)
  })

  it('buckets by the writer\'s local hour, not UTC', () => {
    // 09:00+10:00 is 23:00Z the previous day. Bucketing off UTC would file it under hour 23.
    const a = dayAggregate('2026-07-17', [rows[0]])
    expect(a.busiest_hours[9]).toBe(25)
    expect(a.busiest_hours[23]).toBe(0)
  })
})

describe('windowBounds / monthsSpanning', () => {
  it('daily is one day; weekly is the last 7 inclusive; monthly is the month to date', () => {
    expect(windowBounds('daily', '2026-07-17')).toEqual({ from: '2026-07-17', to: '2026-07-17' })
    expect(windowBounds('weekly', '2026-07-17')).toEqual({ from: '2026-07-11', to: '2026-07-17' })
    expect(windowBounds('monthly', '2026-07-17')).toEqual({ from: '2026-07-01', to: '2026-07-17' })
  })

  it('a week straddling a month boundary reads BOTH ledgers', () => {
    const b = windowBounds('weekly', '2026-08-03')
    expect(b.from).toBe('2026-07-28')
    expect(monthsSpanning(b.from, b.to)).toEqual(['2026-07', '2026-08'])
  })

  it('spans a year boundary', () => {
    expect(monthsSpanning('2026-12-28', '2027-01-03')).toEqual(['2026-12', '2027-01'])
  })
})

describe('buildWindow (§A6.4 — one copy of the measured numbers)', () => {
  const rows = [
    row({ start: '2026-07-16T09:00:00.000+10:00', note: 'ploughed through the lit review', place: 'library' }),
    row({ start: '2026-07-17T09:00:00.000+10:00', doc_id: 'd2', doc_label: 'Essay two', note: 'thin day, mostly thinking', place: 'home' }),
    row({ start: '2026-07-10T09:00:00.000+10:00' }), // outside the weekly window
  ]

  it('DAILY carries session rows (its judged rows are per-session)', () => {
    const w = buildWindow('daily', '2026-07-17', rows)
    expect(w.days.map((d) => d.day)).toEqual(['2026-07-17'])
    expect(w.sessions).toHaveLength(1)
  })

  it('WEEKLY/MONTHLY carry NO session rows — the day rollups are the only copy', () => {
    for (const win of ['weekly', 'monthly'] as const) {
      const w = buildWindow(win, '2026-07-17', rows)
      expect(w.sessions).toEqual([])
      // ...and the writer's opted-in words still travel, via the digest.
      expect(w.note_digest?.flatMap((d) => d.notes)).toContain('thin day, mostly thinking')
    }
  })

  it('excludes rows outside the window', () => {
    const w = buildWindow('weekly', '2026-07-17', rows)
    expect(w.from).toBe('2026-07-11')
    expect(w.days.map((d) => d.day)).toEqual(['2026-07-16', '2026-07-17'])
  })

  it('note_digest is ABSENT when the writer wrote nothing — not a list of blanks', () => {
    const w = buildWindow('weekly', '2026-07-17', [row({ start: '2026-07-17T09:00:00.000+10:00' })])
    expect(w.note_digest).toBeUndefined()
  })

  it('windowDocs totals per document, heaviest first, and carries no prose', () => {
    const docs = windowDocs(rows)
    expect(docs.map((d) => d.doc_id).sort()).toEqual(['d1', 'd2'])
    const d1 = docs.find((d) => d.doc_id === 'd1')!
    expect(d1.session_count).toBe(2)
    expect(d1.active_minutes).toBe(60)
    expect(JSON.stringify(docs)).not.toContain('lit review')
  })
})

describe('noteDigest (§A7.3 tier 2 — the writer\'s words, nothing measured)', () => {
  it('groups notes and distinct places by local day', () => {
    const d = noteDigest([
      row({ start: '2026-07-17T09:00:00.000+10:00', note: 'first', place: 'library' }),
      row({ start: '2026-07-17T14:00:00.000+10:00', note: 'second', place: 'library' }),
      row({ start: '2026-07-18T09:00:00.000+10:00', place: 'home' }),
    ])
    expect(d).toEqual([
      { day: '2026-07-17', notes: ['first', 'second'], places: ['library'] }, // deduped
      { day: '2026-07-18', notes: [], places: ['home'] },
    ])
  })

  it('carries NO measured field — it is the writer\'s prose and nothing else', () => {
    const d = noteDigest([row({ start: '2026-07-17T09:00:00.000+10:00', note: 'a note', words_added: 12345 })])
    expect(JSON.stringify(d)).not.toContain('12345')
    expect(Object.keys(d[0]).sort()).toEqual(['day', 'notes', 'places'])
  })
})


// ═══ `feat/prod-graphs`' chart-rollup suite (verbatim; imports re-pointed) ═════════════════════

// The client-side aggregates (§A3.3). These numbers are ground truth (§A6.4) — they are graphed
// exactly as computed here and never round-tripped through a model — so they are tested by hand
// against sessions whose answers can be worked out on paper, not just for self-consistency.



import { makeSessionRows } from './fixtures'

/** A session builder with sane defaults, so each test states only what it cares about. */
function S(over: Partial<SessionRow> = {}): SessionRow {
  const added = over.words_added ?? 100
  const deleted = over.words_deleted ?? 20
  return {
    session_id: over.session_id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
    doc_id: 'doc-1',
    start: '2026-07-06T09:00:00+10:00',
    end: '2026-07-06T10:00:00+10:00',
    active_minutes: 45,
    words_start: 1000,
    words_end: 1000 + (added - deleted),
    words_added: added,
    words_deleted: deleted,
    net_words: added - deleted,
    edit_events: 300,
    break_before_min: 0,
    pomodoro: false,
    doc_type: 'essay',
    entered: 'timer',
    ...over,
  }
}

describe('aggregateDays', () => {
  it('groups by the writer’s LOCAL day, not the UTC day', () => {
    // 09:00 +10:00 on the 6th = 23:00Z on the 5th. Both sessions are the writer's 6th of July.
    const days = aggregateDays([
      S({ start: '2026-07-06T09:00:00+10:00', end: '2026-07-06T09:45:00+10:00' }),
      S({ start: '2026-07-06T21:00:00+10:00', end: '2026-07-06T21:45:00+10:00' }),
    ])
    expect(days).toHaveLength(1)
    expect(days[0].day).toBe('2026-07-06')
    expect(days[0].sessionCount).toBe(2)
  })

  it('sums the measured fields exactly', () => {
    const days = aggregateDays([
      S({ active_minutes: 30, words_added: 200, words_deleted: 50, net_words: 150, edit_events: 400 }),
      S({ active_minutes: 20, words_added: 100, words_deleted: 80, net_words: 20, edit_events: 250 }),
    ])
    const d = days[0]
    expect(d.activeMinutes).toBe(50)
    expect(d.wordsAdded).toBe(300)
    expect(d.wordsDeleted).toBe(130)
    expect(d.netWords).toBe(170)
    expect(d.editEvents).toBe(650)
  })

  it('carries a NEGATIVE net through — a cutting day is not a failure to be clamped away', () => {
    const days = aggregateDays([S({ words_added: 40, words_deleted: 300, net_words: -260 })])
    expect(days[0].netWords).toBe(-260)
  })

  it('returns days in ascending order', () => {
    const days = aggregateDays([
      S({ start: '2026-07-08T09:00:00+10:00', end: '2026-07-08T10:00:00+10:00' }),
      S({ start: '2026-07-06T09:00:00+10:00', end: '2026-07-06T10:00:00+10:00' }),
    ])
    expect(days.map(d => d.day)).toEqual(['2026-07-06', '2026-07-08'])
  })

  it('is empty-safe', () => {
    expect(aggregateDays([])).toEqual([])
  })

  it('counts distinct docs and splits minutes by doc_type (so "40m on email" can be read off)', () => {
    const days = aggregateDays([
      S({ doc_id: 'essay-1', doc_type: 'essay', active_minutes: 60 }),
      S({ doc_id: 'mail-1', doc_type: 'email', active_minutes: 25, start: '2026-07-06T11:00:00+10:00', end: '2026-07-06T11:30:00+10:00' }),
      S({ doc_id: 'mail-2', doc_type: 'email', active_minutes: 15, start: '2026-07-06T13:00:00+10:00', end: '2026-07-06T13:20:00+10:00' }),
    ])
    expect(days[0].docCount).toBe(3)
    expect(days[0].minutesByDocType).toEqual({ essay: 60, email: 40 })
  })
})

describe('breaks', () => {
  it('counts only the gaps BETWEEN the day’s sessions — never the overnight gap before the first', () => {
    // The first session's break_before_min reaches back to yesterday (640 min). Counting it would
    // swamp the stat and tell the writer they "took a 10-hour break" in the middle of their day.
    const days = aggregateDays([
      S({ start: '2026-07-06T09:00:00+10:00', end: '2026-07-06T10:00:00+10:00', break_before_min: 640 }),
      S({ start: '2026-07-06T11:00:00+10:00', end: '2026-07-06T12:00:00+10:00', break_before_min: 60 }),
      S({ start: '2026-07-06T14:00:00+10:00', end: '2026-07-06T15:00:00+10:00', break_before_min: 120 }),
    ])
    expect(days[0].breaks.count).toBe(2)
    expect(days[0].breaks.totalMinutes).toBe(180)
    expect(days[0].breaks.longestMinutes).toBe(120)
    expect(days[0].breaks.medianMinutes).toBe(90)
  })

  it('a single-session day has no breaks, not a zero-minute break', () => {
    const days = aggregateDays([S({ break_before_min: 700 })])
    expect(days[0].breaks).toEqual({ count: 0, totalMinutes: 0, medianMinutes: 0, longestMinutes: 0 })
  })

  it('uses session ORDER, not array order, to pair gaps', () => {
    const days = aggregateDays([
      S({ start: '2026-07-06T14:00:00+10:00', end: '2026-07-06T15:00:00+10:00', break_before_min: 120 }),
      S({ start: '2026-07-06T09:00:00+10:00', end: '2026-07-06T10:00:00+10:00', break_before_min: 640 }),
    ])
    // Chronologically the 09:00 session is first, so only the 120 gap counts.
    expect(days[0].breaks.count).toBe(1)
    expect(days[0].breaks.totalMinutes).toBe(120)
  })
})

describe('the busiest-hours histogram', () => {
  it('has 24 buckets and puts a contained session in its own local hour', () => {
    const days = aggregateDays([
      S({ start: '2026-07-06T09:05:00+10:00', end: '2026-07-06T09:45:00+10:00', active_minutes: 40 }),
    ])
    const h = days[0].hourHistogram
    expect(h).toHaveLength(24)
    expect(h[9]).toBe(40)
    expect(h.reduce((a, b) => a + b, 0)).toBe(40)
  })

  it('apportions a session that straddles hours, conserving total active minutes', () => {
    // 09:30 → 11:30 wall clock (120 min span), 60 active minutes ⇒ density 0.5.
    // 30 min in the 9 o'clock hour → 15; 60 in the 10 → 30; 30 in the 11 → 15.
    const days = aggregateDays([
      S({ start: '2026-07-06T09:30:00+10:00', end: '2026-07-06T11:30:00+10:00', active_minutes: 60 }),
    ])
    const h = days[0].hourHistogram
    expect(h[9]).toBeCloseTo(15, 5)
    expect(h[10]).toBeCloseTo(30, 5)
    expect(h[11]).toBeCloseTo(15, 5)
    expect(h.reduce((a, b) => a + b, 0)).toBeCloseTo(60, 5)
  })

  it('buckets by LOCAL hour — a Brisbane morning is not a UTC late night', () => {
    const days = aggregateDays([
      S({ start: '2026-07-06T09:05:00+10:00', end: '2026-07-06T09:45:00+10:00', active_minutes: 40 }),
    ])
    expect(days[0].hourHistogram[9]).toBe(40)
    expect(days[0].hourHistogram[23]).toBe(0) // the UTC hour, which must NOT be used
  })

  it('never loses minutes across a midnight-crossing session', () => {
    const days = aggregateDays([
      S({ start: '2026-07-06T23:30:00+10:00', end: '2026-07-07T00:30:00+10:00', active_minutes: 60 }),
    ])
    const total = days[0].hourHistogram.reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(60, 5)
    expect(days[0].hourHistogram[23]).toBeCloseTo(30, 5)
    expect(days[0].hourHistogram[0]).toBeCloseTo(30, 5)
  })
})

describe('pearson — the descriptive correlation (§A3.3 DESCRIPTIVE ONLY)', () => {
  it('refuses to report below the minimum sample size', () => {
    const c = pearson([1, 2, 3], [1, 2, 3])
    expect(c.reportable).toBe(false)
    expect(c.n).toBe(3)
  })

  it('reports a perfect positive relationship at n >= the minimum', () => {
    const c = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])
    expect(c.reportable).toBe(true)
    expect(c.r).toBeCloseTo(1, 6)
    expect(c.n).toBe(MIN_CORRELATION_N)
  })

  it('reports a perfect negative relationship', () => {
    expect(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]).r).toBeCloseTo(-1, 6)
  })

  it('is UNREPORTABLE when a variable never varies — r is undefined, not zero', () => {
    // A flat series has no correlation to speak of. Reporting r=0 would be inventing a finding
    // ("no relationship") out of an absence of data.
    const c = pearson([5, 5, 5, 5, 5], [1, 2, 3, 4, 5])
    expect(c.reportable).toBe(false)
    expect(c.r).toBe(0)
  })

  // ─── THE NON-DEGENERATE CASE — the only fixture here that can tell Pearson's r from an impostor ──
  //
  // WHY THIS ASSERTS A VALUE AND NOT A RANGE. This test used to read:
  //     expect(c.r).toBeGreaterThanOrEqual(-1); expect(c.r).toBeLessThanOrEqual(1)
  // — which `clamp(_, -1, 1)` GUARANTEES BY CONSTRUCTION. It could not fail. An external audit
  // mutated the denominator `sqrt(dx2*dy2)` → `sqrt(dx2*dx2)`, DROPPING THE Y SPREAD ENTIRELY, and
  // the whole 1054-test repo stayed green (reproduced here before fixing). Every other fixture is
  // degenerate: on the perfect-positive case the mutant computes r=2 and the clamp launders it back
  // to exactly the 1 the test expects. So the defensive clamp was hiding the bug the range check was
  // too weak to catch — two pieces of careful-looking engineering combining into a blind spot.
  //
  // This is user-facing: pearson feeds `breakVsOutput`, shown to the writer. The mutant reports
  // r=1.0 — "your breaks predict your output" — where the truth is 0.696. That is vibes-as-numbers
  // presented as MEASURED, the exact failure §A6.1 exists to prevent.
  //
  // Hand-computable: x=1..6 (mean 3.5), y=[3,1,4,1,5,9] (mean 23/6); Σdxdy=19.5, Σdx²=17.5,
  // Σdy²=44.833 ⇒ r = 19.5/√(17.5·44.833) = 0.6962…
  it('computes the TRUE r on a non-degenerate sample — not merely something inside [-1, 1]', () => {
    const c = pearson([1, 2, 3, 4, 5, 6], [3, 1, 4, 1, 5, 9])
    expect(c.r).toBeCloseTo(0.696, 3)
    expect(c.reportable).toBe(true)
  })

  it('is symmetric in its arguments — r(x,y) === r(y,x)', () => {
    // A denominator that drops one axis is asymmetric by construction, so this catches the same
    // class from the other side without needing a hand-computed constant.
    const xs = [1, 2, 3, 4, 5, 6], ys = [3, 1, 4, 1, 5, 9]
    expect(pearson(xs, ys).r).toBeCloseTo(pearson(ys, xs).r, 12)
  })

  it('is invariant to SCALING either axis — the property that pins the denominator', () => {
    // Pearson's r is scale-free. Multiplying Y by 10 inflates both `num` and `dy2` by 10, so a
    // correct denominator cancels it exactly; any denominator that ignores dy2 cannot.
    const xs = [1, 2, 3, 4, 5, 6], ys = [3, 1, 4, 1, 5, 9]
    const base = pearson(xs, ys).r
    expect(pearson(xs, ys.map(y => y * 10)).r).toBeCloseTo(base, 12)
    expect(pearson(xs.map(x => x * 4), ys).r).toBeCloseTo(base, 12)
  })

  // ─── F3: the `n` truncation had never been exercised ──────────────────────
  //
  // Every fixture above passes equal-length arrays, so `Math.min(xs.length, ys.length)` and the
  // `mean(xs.slice(0, n))` truncation were dead weight no test could distinguish from `mean(xs)`.
  it('truncates BOTH axes to the shorter one — including the means', () => {
    // The trailing 999 must be ignored ENTIRELY: not just skipped in the sum (the loop stops at n
    // anyway), but excluded from x's mean. If `mean` saw it, r would not match the clean pair.
    const clean = pearson([1, 2, 3, 4, 5, 6], [3, 1, 4, 1, 5, 9])
    const ragged = pearson([1, 2, 3, 4, 5, 6, 999], [3, 1, 4, 1, 5, 9])
    expect(ragged.n).toBe(6)
    expect(ragged.r).toBeCloseTo(clean.r, 12)
  })

  it('truncates when the SHORTER array is x', () => {
    const clean = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])
    const ragged = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10, 777, 888])
    expect(ragged.n).toBe(5)
    expect(ragged.r).toBeCloseTo(clean.r, 12)
  })

  it('applies the minimum-sample gate to the TRUNCATED length, not the longer array', () => {
    // 20 xs against 4 ys is a 4-point sample wearing a long coat. It must not be reportable.
    const c = pearson(Array.from({ length: 20 }, (_, i) => i), [1, 5, 2, 8])
    expect(c.n).toBe(4)
    expect(c.reportable).toBe(false)
  })
})

describe('aggregateWeeks', () => {
  const week = () => {
    const sessions = [
      // Mon
      S({ start: '2026-07-06T09:00:00+10:00', end: '2026-07-06T10:00:00+10:00', active_minutes: 60, words_added: 400 }),
      // Wed
      S({ start: '2026-07-08T09:00:00+10:00', end: '2026-07-08T10:00:00+10:00', active_minutes: 30, words_added: 150 }),
      // Sun (same ISO week)
      S({ start: '2026-07-12T09:00:00+10:00', end: '2026-07-12T09:30:00+10:00', active_minutes: 25, words_added: 90 }),
    ]
    return aggregateWeeks(aggregateDays(sessions), sessions)
  }

  it('keys the week to its Monday and rolls the days up', () => {
    const w = week()[0]
    expect(w.weekStart).toBe('2026-07-06')
    expect(w.days).toHaveLength(3)
    expect(w.activeMinutes).toBe(115)
    expect(w.wordsAdded).toBe(640)
  })

  it('places weekday minutes Monday-first and leaves absent days at zero — gaps are not fabricated', () => {
    const w = week()[0]
    expect(w.weekdayMinutes[0]).toBe(60) // Monday
    expect(w.weekdayMinutes[1]).toBe(0)  // Tuesday — no writing, and none invented
    expect(w.weekdayMinutes[2]).toBe(30) // Wednesday
    expect(w.weekdayMinutes[6]).toBe(25) // Sunday
    expect(w.daysWritten).toBe(3)
  })

  it('does not report a correlation from three days', () => {
    // §A6.2 in numbers: three points cannot support a break-vs-output claim.
    expect(week()[0].breakVsOutput.reportable).toBe(false)
  })
})

describe('aggregateLedger over a realistic synthetic month', () => {
  const sessions = makeSessionRows({ seed: 20260716 })
  const agg = aggregateLedger(sessions)

  it('conserves every session across day → week → month', () => {
    const dayTotal = agg.days.reduce((a, d) => a + d.sessionCount, 0)
    const weekTotal = agg.weeks.reduce((a, w) => a + w.sessionCount, 0)
    const monthTotal = agg.months.reduce((a, m) => a + m.sessionCount, 0)
    expect(dayTotal).toBe(sessions.length)
    expect(weekTotal).toBe(sessions.length)
    expect(monthTotal).toBe(sessions.length)
  })

  it('conserves active minutes and words up the hierarchy', () => {
    const dayMin = agg.days.reduce((a, d) => a + d.activeMinutes, 0)
    const weekMin = agg.weeks.reduce((a, w) => a + w.activeMinutes, 0)
    expect(weekMin).toBeCloseTo(dayMin, 0)
    const dayWords = agg.days.reduce((a, d) => a + d.wordsAdded, 0)
    expect(agg.months.reduce((a, m) => a + m.wordsAdded, 0)).toBe(dayWords)
  })

  it('never double-counts a week that straddles two months', () => {
    const seen = new Set<string>()
    for (const m of agg.months) for (const w of m.weeks) {
      expect(seen.has(w.weekStart)).toBe(false)
      seen.add(w.weekStart)
    }
  })

  it('produces week-over-week deltas one shorter than the week list', () => {
    const m = agg.months[0]
    expect(m.weekOverWeekMinutes).toHaveLength(m.weeks.length - 1)
    expect(m.weekOverWeekWords).toHaveLength(m.weeks.length - 1)
  })

  it('week-over-week deltas are the actual differences', () => {
    const m = agg.months[0]
    for (let i = 0; i < m.weekOverWeekWords.length; i++) {
      expect(m.weekOverWeekWords[i]).toBe(m.weeks[i + 1].wordsAdded - m.weeks[i].wordsAdded)
    }
  })

  it('CAN report a break-vs-output correlation at the weekly window', () => {
    // The known-positive for the gate: with a full week of days, the descriptive stat is available.
    // (If this never fired, the reportable flag would be untestable dead weight.)
    const reportable = agg.weeks.filter(w => w.breakVsOutput.reportable)
    expect(reportable.length).toBeGreaterThan(0)
    for (const w of reportable) expect(w.breakVsOutput.n).toBeGreaterThanOrEqual(MIN_CORRELATION_N)
  })

  it('is deterministic — same seed, same numbers', () => {
    const again = aggregateLedger(makeSessionRows({ seed: 20260716 }))
    expect(again.days.map(d => d.activeMinutes)).toEqual(agg.days.map(d => d.activeMinutes))
  })

  it('the fixture month actually contains gaps — days with no writing (§A9)', () => {
    // Guards the fixture itself: if it silently became an unbroken run, the aggregates would never
    // be tested against a real month's shape.
    const first = agg.days[0].day, last = agg.days[agg.days.length - 1].day
    const span = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000 + 1
    expect(agg.days.length).toBeLessThan(span)
  })
})
