// KEEPS THE DOCUMENT OFF THE REFERENCES PAGE (2026-08-28). Peter: "sometimes the doc keeps jumping
// down to the bottom and I don't know why" → "It keeps jumping down to the references page."
//
// The zoom's no-anchor fallback holds your relative position across a font-reflow. Its divisor
// floors at 1 so it is safe to divide by — and that defensive floor silently became a MEASUREMENT:
// with the document fitting its viewport there is no range, any scrollTop over 1 reads as a ratio
// ≥ 1, and the next frame multiplies it by a real range. Same family as the archive guards, where
// a defensive default answered a question it had not been asked.
//
// Reachable only when no content anchor could be picked — i.e. pinching over the WATER, which was
// itself unreachable until the wheel-arming fix landed the same day.

import { describe, it, expect } from 'vitest'
import { scrollRatioOf } from './Scroll'

describe('scrollRatioOf', () => {
  it('THE BUG: a degenerate range never reports "you are at the bottom"', () => {
    // scrollRange() floors at 1, so this is the exact shape the fallback saw.
    expect(scrollRatioOf(240, 1)).toBe(0)
    expect(scrollRatioOf(1, 1)).toBe(0)
    expect(scrollRatioOf(0, 1)).toBe(0)
  })

  it('KNOWN-NEGATIVE: the unclamped expression really does send you to the end', () => {
    // Without this, "returns 0" could be true for a reason unrelated to the bug.
    const legacy = (top: number, range: number) => top / range
    expect(legacy(240, 1)).toBeGreaterThan(1)          // ⇒ ratio * realRange = past the bottom
    expect(legacy(240, 1) * 20000).toBeGreaterThan(20000)
  })

  it('a real range is preserved exactly — this must not change ordinary zooming', () => {
    expect(scrollRatioOf(5000, 20000)).toBe(0.25)
    expect(scrollRatioOf(0, 20000)).toBe(0)
    expect(scrollRatioOf(20000, 20000)).toBe(1)
  })

  it('clamps a transiently over-range scrollTop rather than overshooting', () => {
    // A stale scrollHeight during the magnify wrapper's synchronous resize can hand it this.
    expect(scrollRatioOf(30000, 20000)).toBe(1)
    expect(scrollRatioOf(-50, 20000)).toBe(0)
  })

  it('refuses NaN instead of propagating it into a scroll write', () => {
    expect(scrollRatioOf(NaN, 20000)).toBe(0)
    expect(scrollRatioOf(100, NaN)).toBe(0)
  })
})
