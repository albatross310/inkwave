// The post-hoc manual add (Peter: "a manual add for if you forget to use the timer. But then it's
// flagged post-hoc").
//
// THE CLAIM UNDER TEST IS §A6.1's: post-hoc time MUST NEVER MERGE INTO THE MEASURED BARS. The report
// has to be able to say "3h40m measured, plus 45m you added from memory"; silently totalling them is
// the lie. Every guard below is mutation-proved to FIRE — an assertion that a number is 92 passes
// just as happily against a broken split if the fixture never contains a post-hoc row, which is
// exactly the tautology `phase.variants.test.ts` (F1) was caught in.

import { describe, expect, it } from 'vitest'
import { aggregateDays, dayAggregate, isPostHoc, splitByEntry, windowDocs } from './aggregate'
import { POSTHOC_MAX_MINUTES, buildPostHocRow } from './sessionLogic'
import type { SessionRow } from './types'

const AT = Date.parse('2026-07-17T14:00:00+10:00')
const OFF = 600

/** A measured row. Defaults are deliberate: 60 minutes so a merge is obvious in any total. */
function timed(over: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: `t-${Math.random().toString(36).slice(2, 8)}`,
    doc_id: 'doc-1',
    doc_label: 'Seminar paper',
    start: '2026-07-17T09:00:00+10:00',
    end: '2026-07-17T10:00:00+10:00',
    active_minutes: 60,
    words_start: 100, words_end: 400, words_added: 320, words_deleted: 20, net_words: 300,
    edit_events: 250, break_before_min: 0, pomodoro: true, doc_type: 'essay',
    entered: 'timer',
    ...over,
  }
}

describe('buildPostHocRow — rough duration, rough category, and nothing else demanded', () => {
  const row = buildPostHocRow({ minutes: 45, docType: 'reading' }, { sessionId: 'p-1', at: AT, offsetMin: OFF })

  it('flags the row as testimony — explicitly, never by absence', () => {
    expect(row.entered).toBe('post-hoc')
  })

  it('derives the span from the duration he said, ending when he told us', () => {
    expect(row.end).toBe('2026-07-17T14:00:00.000+10:00')
    expect(row.start).toBe('2026-07-17T13:15:00.000+10:00')
    expect(row.active_minutes).toBe(45)
  })

  it('lands in the local day he is standing in (§A9)', () => {
    expect(row.start.slice(0, 10)).toBe('2026-07-17')
  })

  it('EVERY MEASURED FIELD IS ZERO — the true value, not missing data', () => {
    // We did not see him type, so `words_added: 0` is exactly right. The minutes are kept out of the
    // measured bars by `entered`, never by being blank.
    expect(row.words_added).toBe(0)
    expect(row.words_deleted).toBe(0)
    expect(row.net_words).toBe(0)
    expect(row.edit_events).toBe(0)
    expect(row.pomodoro).toBe(false)
    expect(row.break_before_min).toBe(0)
  })

  it('carries his category verbatim — never our guess', () => {
    expect(row.doc_type).toBe('reading')
    expect(buildPostHocRow({ minutes: 10, docType: 'email' }, { sessionId: 'p', at: AT, offsetMin: OFF }).doc_type).toBe('email')
  })

  it('is not attributed to whatever document happened to be open', () => {
    // The work he forgot to time may not have been in Inkwave at all (a printed article).
    expect(row.doc_id).toBe('post-hoc')
    expect(row.doc_label).toBeUndefined()
  })

  it('omits a skipped note entirely — a skipped note is not a failure', () => {
    expect(row.note).toBeUndefined()
    expect('note' in row).toBe(false)
    expect(buildPostHocRow({ minutes: 5, docType: 'note', note: '   ' }, { sessionId: 'p', at: AT, offsetMin: OFF }).note).toBeUndefined()
  })

  it('keeps his note when he writes one', () => {
    const r = buildPostHocRow({ minutes: 5, docType: 'note', note: '  Read the printed  chapter ' }, { sessionId: 'p', at: AT, offsetMin: OFF })
    expect(r.note).toBe('Read the printed chapter')
  })

  it('clamps a nonsense duration rather than recording it', () => {
    expect(buildPostHocRow({ minutes: 99_999, docType: 'essay' }, { sessionId: 'p', at: AT, offsetMin: OFF }).active_minutes).toBe(POSTHOC_MAX_MINUTES)
    expect(buildPostHocRow({ minutes: -5, docType: 'essay' }, { sessionId: 'p', at: AT, offsetMin: OFF }).active_minutes).toBe(0)
  })
})

describe('isPostHoc — the ONE place `entered` is read, and it asks the POSITIVE question', () => {
  it('is true only when the row SAYS post-hoc', () => {
    expect(isPostHoc(buildPostHocRow({ minutes: 5, docType: 'essay' }, { sessionId: 'p', at: AT, offsetMin: OFF }))).toBe(true)
    expect(isPostHoc(timed())).toBe(false)
  })

  it('treats a LEGACY row (written before the field existed) as timer-entered', () => {
    // Those rows predate the manual add entirely, so every one of them was timer-entered — a fact
    // about history, not a default that classifies anything.
    const legacy = { ...timed() } as Partial<SessionRow>
    delete legacy.entered
    expect(isPostHoc(legacy as SessionRow)).toBe(false)
  })
})

describe('§A6.1 — post-hoc time NEVER merges into the measured bars', () => {
  const rows = [
    timed({ active_minutes: 60 }),
    timed({ active_minutes: 40, start: '2026-07-17T11:00:00+10:00', end: '2026-07-17T11:40:00+10:00' }),
    buildPostHocRow({ minutes: 45, docType: 'reading' }, { sessionId: 'p-1', at: AT, offsetMin: OFF }),
  ]

  it('splitByEntry separates the populations', () => {
    const { measured, postHoc } = splitByEntry(rows)
    expect(measured).toHaveLength(2)
    expect(postHoc).toHaveLength(1)
  })

  it('dayAggregate: active_minutes counts ONLY what the timer watched', () => {
    const agg = dayAggregate('2026-07-17', rows)
    expect(agg.active_minutes).toBe(100)     // 60 + 40 — NOT 145
    expect(agg.session_count).toBe(2)        // NOT 3
  })

  it('dayAggregate: the remembered time is present, in its own column', () => {
    const agg = dayAggregate('2026-07-17', rows)
    expect(agg.posthoc_minutes).toBe(45)
    expect(agg.posthoc_session_count).toBe(1)
  })

  it('THE TWO NUMBERS ARE BOTH READABLE — "3h40m measured, plus 45m from memory"', () => {
    // The point is not that post-hoc time is hidden; it is that it is a DIFFERENT COLUMN. Losing it
    // would be its own dishonesty.
    const agg = dayAggregate('2026-07-17', rows)
    expect(agg.active_minutes).toBe(100)
    expect(agg.posthoc_minutes).toBe(45)
  })

  it('post-hoc rows contribute to no measured field at all', () => {
    // A post-hoc row is all zeros, so a leaked one is invisible in the word columns — which is
    // exactly why the minutes and the session COUNT are what this asserts.
    const withOnlyPostHoc = dayAggregate('2026-07-17', [rows[2]])
    expect(withOnlyPostHoc.active_minutes).toBe(0)
    expect(withOnlyPostHoc.session_count).toBe(0)
    expect(withOnlyPostHoc.posthoc_minutes).toBe(45)
  })

  it('aggregateDays (the CHARTS view model) splits the same way — no bar is part-remembered', () => {
    const [day] = aggregateDays(rows)
    expect(day.activeMinutes).toBe(100)
    expect(day.sessionCount).toBe(2)
    expect(day.postHocMinutes).toBe(45)
    expect(day.postHocSessions).toBe(1)
  })

  it('minutesByDocType cannot report remembered minutes as measured ("40m on email")', () => {
    const [day] = aggregateDays([...rows, buildPostHocRow({ minutes: 30, docType: 'email' }, { sessionId: 'p-2', at: AT, offsetMin: OFF })])
    expect(day.minutesByDocType.essay).toBe(100)
    expect(day.minutesByDocType.email).toBeUndefined() // he SAID 30m email; we never measured any
    expect(day.minutesByDocType.reading).toBeUndefined()
  })

  it('windowDocs excludes post-hoc — it has no document and no text to offer (§A7.3)', () => {
    const docs = windowDocs(rows)
    expect(docs.map((d) => d.doc_id)).toEqual(['doc-1'])
    expect(docs[0].active_minutes).toBe(100)
  })

  it('THE NEGATIVE FIRES: a merged rule gives DIFFERENT answers on this exact fixture', () => {
    // Mutation, in-line: the aggregate as it would be WITHOUT the split — i.e. the bug this guards.
    // If the fixture couldn't tell the two rules apart, every assertion above would be a property of
    // the data rather than of the code (the F1 tautology). It can: 145 ≠ 100, 3 ≠ 2.
    const merged = rows.reduce((a, r) => a + r.active_minutes, 0)
    expect(merged).toBe(145)
    expect(dayAggregate('2026-07-17', rows).active_minutes).toBe(100)
    expect(merged).not.toBe(dayAggregate('2026-07-17', rows).active_minutes)

    const mergedCount = rows.length
    expect(mergedCount).toBe(3)
    expect(dayAggregate('2026-07-17', rows).session_count).toBe(2)
  })
})
