import { describe, expect, it } from 'vitest'
import { buildWindow, dayAggregate, deepShallowRatio, monthsSpanning, noteDigest, windowBounds, windowDocs } from './aggregate'
import type { SessionRow } from './types'

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
