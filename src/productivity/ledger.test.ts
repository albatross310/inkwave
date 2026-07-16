// Local-day / local-hour resolution (§A9: store UTC + offset, aggregate in the user's local day).
//
// THESE TESTS MUST NOT DEPEND ON THE MACHINE'S TIME ZONE. A suite that passes only in
// Australia/Brisbane is a check that can't see its own failure — it would go green on Peter's box
// and in CI while silently mis-bucketing every session for anyone else. Every fixture below carries
// an EXPLICIT offset, and the offset-independence test pins that property directly.

import { describe, it, expect } from 'vitest'
import { localDayOf, localHourOf, monthOf, weekStartOf, weekdayOf } from './ledger'

describe('localDayOf', () => {
  it('reads the day from the string’s OWN offset, not the runtime’s', () => {
    // 09:30 on the 6th in Brisbane (+10) is 23:30 on the 5th UTC. The writer's day is the 6th.
    expect(localDayOf('2026-07-06T09:30:00+10:00')).toBe('2026-07-06')
  })

  it('keeps a late-night session on the day the writer experienced it', () => {
    // 23:40 +10:00 → 13:40Z the same date. Still the 6th locally.
    expect(localDayOf('2026-07-06T23:40:00+10:00')).toBe('2026-07-06')
  })

  it('handles an offset that pushes across the UTC date line', () => {
    // 01:00 on the 7th in Brisbane is 15:00 on the 6th UTC — the writer's day is the 7th.
    expect(localDayOf('2026-07-07T01:00:00+10:00')).toBe('2026-07-07')
    // Western hemisphere: 20:00 on the 6th in New York (-04) is 00:00 on the 7th UTC.
    expect(localDayOf('2026-07-06T20:00:00-04:00')).toBe('2026-07-06')
  })

  it('accepts Z and the compact ±HHMM offset form', () => {
    expect(localDayOf('2026-07-06T12:00:00Z')).toBe('2026-07-06')
    expect(localDayOf('2026-07-06T09:30:00+1000')).toBe('2026-07-06')
  })

  it('handles half-hour and negative offsets', () => {
    // Adelaide, +09:30.
    expect(localDayOf('2026-07-06T00:15:00+09:30')).toBe('2026-07-06')
    // 23:30 on the 6th at -03:30 is 03:00 on the 7th UTC — still the 6th for the writer.
    expect(localDayOf('2026-07-06T23:30:00-03:30')).toBe('2026-07-06')
  })

  it('IS INDEPENDENT OF THE RUNTIME TIME ZONE — the property that makes this suite portable', () => {
    // The same instant, written with different offsets, belongs to different LOCAL days — and each
    // answer comes from the string alone. If this function ever fell back to the runtime TZ for
    // offset-bearing input, one of these would follow the machine instead of the data.
    const instant = '2026-07-06T14:00:00Z'
    expect(localDayOf(instant)).toBe('2026-07-06')                    // UTC
    expect(localDayOf('2026-07-07T00:00:00+10:00')).toBe('2026-07-07') // same instant, Brisbane
    expect(localDayOf('2026-07-06T10:00:00-04:00')).toBe('2026-07-06') // same instant, New York
  })

  it('returns empty for unparseable input rather than a wrong day', () => {
    expect(localDayOf('not a date')).toBe('')
  })
})

describe('localHourOf', () => {
  it('reads the writer’s wall-clock hour', () => {
    expect(localHourOf('2026-07-06T09:30:00+10:00')).toBe(9)
    expect(localHourOf('2026-07-06T23:05:00+10:00')).toBe(23)
    expect(localHourOf('2026-07-06T20:00:00-04:00')).toBe(20)
  })

  it('is not the UTC hour', () => {
    // 09:30 +10:00 is 23:30 UTC — the histogram must bucket it at 9am, not 11pm.
    expect(localHourOf('2026-07-06T09:30:00+10:00')).not.toBe(23)
  })
})

describe('week and month keys', () => {
  it('weekdayOf is Monday-indexed', () => {
    expect(weekdayOf('2026-07-06')).toBe(0) // a Monday
    expect(weekdayOf('2026-07-12')).toBe(6) // the Sunday that ends its week
  })

  it('weekStartOf returns the Monday of the ISO week', () => {
    expect(weekStartOf('2026-07-06')).toBe('2026-07-06') // Monday maps to itself
    expect(weekStartOf('2026-07-09')).toBe('2026-07-06') // Thursday
    expect(weekStartOf('2026-07-12')).toBe('2026-07-06') // Sunday belongs to the week that began Mon
    expect(weekStartOf('2026-07-13')).toBe('2026-07-13') // the next Monday starts a new week
  })

  it('weekStartOf crosses a month boundary correctly', () => {
    // Wed 1 July 2026 sits in the week that began Mon 29 June.
    expect(weekStartOf('2026-07-01')).toBe('2026-06-29')
  })

  it('monthOf', () => {
    expect(monthOf('2026-07-06')).toBe('2026-07')
  })
})
