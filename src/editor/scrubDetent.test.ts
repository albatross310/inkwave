// KEEPS THE ONE-STEP SCRUB (2026-08-28). Peter: "make the scroll scrub in versions mode have a
// small buffer after the first step so you can do one step at a time. And maybe take 40% off the
// net scroll speed for trackpad/phone."
//
// These are unit assertions on a pure rule precisely because the browser proof is the expensive
// one: a probe that ran once is not a guard, and the whole value of this change is a NUMBER OF
// STEPS, which is exactly what a pure function can be asked for in 10ms.

import { describe, it, expect } from 'vitest'
import {
  stepDetent, newDetent, resetDetent, trimmed, SCRUB_SPEED_TRIM,
  TRACKPAD_DETENT, TOUCH_DETENT, type DetentConfig,
} from './scrubDetent'

/** Feed a gesture as a stream of small deltas (what a trackpad actually sends) and total the steps. */
function swipe(px: number, cfg: DetentConfig, perEvent = 6): number {
  const s = newDetent()
  let n = 0
  for (let sent = 0; sent < px; sent += perEvent) n += stepDetent(s, Math.min(perEvent, px - sent), cfg)
  return n
}

describe('the buffer after the first step', () => {
  it('a short deliberate swipe is EXACTLY one version', () => {
    // This is the complaint, stated as a number: before the buffer, 60px of trackpad travel was
    // 1 + floor(26/7) = 4 versions.
    expect(swipe(60, TRACKPAD_DETENT)).toBe(1)
    expect(swipe(60, TOUCH_DETENT)).toBe(1)
  })

  it('the whole dead zone is one version, right up to its edge', () => {
    const { first, buffer } = TRACKPAD_DETENT
    for (let px = first; px < first + buffer; px += 3) expect(swipe(px, TRACKPAD_DETENT)).toBe(1)
  })

  it('below the arming distance nothing moves at all', () => {
    expect(swipe(TRACKPAD_DETENT.first - 1, TRACKPAD_DETENT)).toBe(0)
  })

  it('a committed drag still scrubs freely past the buffer', () => {
    // The buffer must not turn the scrubber into a ratchet — a long drag is still continuous.
    const { first, buffer, rest } = TRACKPAD_DETENT
    const px = first + buffer + rest * 20
    expect(swipe(px, TRACKPAD_DETENT)).toBe(21)
  })

  it('KNOWN-NEGATIVE: with no buffer the same short swipe over-steps', () => {
    // Without this the "exactly one" assertions above could be true for the wrong reason (e.g. a
    // rest so large nothing ever steps twice). Same rule, buffer 0 = the shipped behaviour before.
    const noBuffer = { ...TRACKPAD_DETENT, buffer: 0 }
    expect(swipe(60, noBuffer)).toBeGreaterThan(1)
  })
})

describe('the 40% speed trim', () => {
  it('is applied to the per-step cadence', () => {
    expect(SCRUB_SPEED_TRIM).toBe(0.6)
    expect(TRACKPAD_DETENT.rest).toBe(trimmed(7))   // 7 → 12
    expect(TOUCH_DETENT.rest).toBe(trimmed(9))      // 9 → 15
    expect(TRACKPAD_DETENT.rest).toBeGreaterThan(7)
    expect(TOUCH_DETENT.rest).toBeGreaterThan(9)
  })

  it('is NOT applied to the arming distance — starting the scrub is no harder', () => {
    expect(TRACKPAD_DETENT.first).toBe(34)
    expect(TOUCH_DETENT.first).toBe(38)
  })

  it('a long drag delivers ~40% fewer versions than the old cadence', () => {
    const old = { ...TRACKPAD_DETENT, rest: 7, buffer: 0 }
    const longPx = 1000
    const before = swipe(longPx, old), after = swipe(longPx, TRACKPAD_DETENT)
    expect(after).toBeLessThan(before)
    expect(after / before).toBeGreaterThan(0.5)
    expect(after / before).toBeLessThan(0.68)
  })
})

describe('gesture state', () => {
  it('direction is carried through in the delta’s own sign', () => {
    const s = newDetent()
    expect(stepDetent(s, -TRACKPAD_DETENT.first, TRACKPAD_DETENT)).toBe(-1)
  })

  it('reset re-arms the detent, so the next swipe starts from scratch', () => {
    const s = newDetent()
    stepDetent(s, 500, TRACKPAD_DETENT)
    resetDetent(s)
    expect(s).toEqual({ accum: 0, started: false, buffered: false })
    expect(stepDetent(s, 20, TRACKPAD_DETENT)).toBe(0) // 20px is inside `first` again
  })

  it('a reversal inside the dead zone still costs the full buffer to leave it', () => {
    const s = newDetent()
    expect(stepDetent(s, 40, TRACKPAD_DETENT)).toBe(1)  // armed, 6px into the buffer
    expect(stepDetent(s, -6, TRACKPAD_DETENT)).toBe(0)  // back to 0
    expect(stepDetent(s, 60, TRACKPAD_DETENT)).toBe(0)  // 60 < buffer 68
    expect(stepDetent(s, 20, TRACKPAD_DETENT)).toBe(1)  // crosses it, then one rest
  })
})
