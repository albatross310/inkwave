// The pure chart helpers. Small, but both exist because a rendered chart was wrong.

import { describe, it, expect } from 'vitest'
import { niceMax } from './Charts'

describe('niceMax', () => {
  it('rounds an axis maximum up to a readable number', () => {
    // The real values that produced "214.3m" and "1982" axis labels before this existed.
    expect(niceMax(214.3)).toBe(250)   // ticks 0 / 125 / 250
    expect(niceMax(1982)).toBe(2000)   // ticks 0 / 1000 / 2000
    expect(niceMax(112.1)).toBe(150)   // ticks 0 / 75 / 150
  })

  it('never rounds DOWN — the tallest bar must always fit the plot', () => {
    // If it did, a bar would overflow its axis and the chart would silently lie about scale.
    for (const v of [1, 1.1, 7, 42, 99, 100, 101, 250.4, 999, 1000, 1001, 12345]) {
      expect(niceMax(v), `niceMax(${v})`).toBeGreaterThanOrEqual(v)
    }
  })

  it('stays close — it rounds up, but not absurdly', () => {
    for (const v of [7, 42, 99, 250.4, 999, 12345]) {
      expect(niceMax(v) / v, `niceMax(${v})=${niceMax(v)}`).toBeLessThan(2)
    }
  })

  it('does not waste the plot on a value just over a power of ten', () => {
    // The real regression: a 580-minute week rounded to a 1000-minute axis, leaving the trend line
    // flat across the middle of an empty chart. The ladder must land tighter than that.
    expect(niceMax(580)).toBe(600)
    expect(niceMax(5500)).toBe(6000)
    for (const v of [580, 5500, 1.1, 11, 110]) {
      expect(niceMax(v) / v, `niceMax(${v})=${niceMax(v)}`).toBeLessThan(1.45)
    }
  })

  it('handles degenerate input without producing a zero or negative axis', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(-5)).toBe(1)
    expect(niceMax(NaN)).toBe(1)
  })

  it('produces halves that are readable too (the mid gridline)', () => {
    // The charts label 0 / max/2 / max, so max/2 must not reintroduce ugly decimals.
    for (const v of [214.3, 1982, 112.1]) {
      const half = niceMax(v) / 2
      expect(Number.isInteger(half), `half of niceMax(${v}) = ${half}`).toBe(true)
    }
  })
})
