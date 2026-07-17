// THE SHARED LINE PREDICATE — and the two constants that must never drift between the editor and
// the /snapshot pane.
//
// WHY THIS FILE EXISTS, and it is not a nicety. When `isLineRect`/`MAX_LINE_H`/`SAME_LINE_PX` were
// hoisted out of the two collectors into lineRects.ts, they were MUTATION-PROVED against every
// existing suite and **two mutants survived**:
//   · `MAX_LINE_H` 80 → 60   — 28 tests, all green.
//   · `isLineRect` with the tall-box cut DELETED entirely — 28 tests, all green.
// The one test that names the cut (`collectLines.container.test.ts`: "a 3-line item's box was
// dropped by the 80px cut") passes under both mutants by accident: with the cut gone the 87.328px
// box is admitted, and then the 3px dedup eats the very text rect it displaced, so the returned
// LENGTH is 1 either way. It asserts the count, and the count telescopes — the same blindness, one
// level down, that let the container bug live in three copies.
//
// Hoisting a constant into one place makes ONE edit break TWO surfaces. That is the point of the
// hoist, and it is only safe if something varies the constant. CLAUDE.md's rule: a test only sees a
// rule it VARIES.
//
// Every number below is a REAL measurement from the canonical 18px grid (panerect.mjs / rectdiag.mjs
// against the live DOM), not an invented one.
import { describe, it, expect } from 'vitest'
import { isLineRect, sameLine, MAX_LINE_H, SAME_LINE_PX } from './lineRects'

const R = (height: number, width = 500) => ({ width, height })

describe('isLineRect — the tall-box cut, VARIED', () => {
  it('a real text rect (23px at the canonical 18px grid) is a line', () => {
    expect(isLineRect(R(23))).toBe(true)
  })

  it('a one-line container box (29.109px) is NOT excluded by the cut — the cut cannot see it', () => {
    // The load-bearing admission. This is why the cut was never a container rule and why
    // staticLineRects/textblockEls had to exist: a 1-line `<li>`'s box passes this predicate, and
    // must. Only the CONTAINER rule keeps it from ever being offered.
    expect(isLineRect(R(29.109))).toBe(true)
  })

  it('a 2-line <li> border box (58.219px) PASSES the cut — the bug\'s exact shape', () => {
    expect(isLineRect(R(58.219))).toBe(true)
  })

  it('a 3-line <li> border box (87.328px) is cut — which is why only ~2-line items broke', () => {
    expect(isLineRect(R(87.328))).toBe(false)
  })

  it('the cut is EXACTLY at MAX_LINE_H — the boundary, both sides', () => {
    // Varies the constant itself: 80 and 60 must give different answers here, or the constant is
    // free to drift between the two collectors that now share it.
    expect(isLineRect(R(MAX_LINE_H))).toBe(true)
    expect(isLineRect(R(MAX_LINE_H + 0.001))).toBe(false)
    expect(MAX_LINE_H).toBe(80)
    // …and it really sits between the shapes it must separate. If MAX_LINE_H ever moved to 60 or to
    // 100, one of these fails: 58.219 must pass and 87.328 must not.
    expect(58.219).toBeLessThan(MAX_LINE_H)
    expect(87.328).toBeGreaterThan(MAX_LINE_H)
  })

  it('scales with the magnify factor — the editor measures in SCREEN px', () => {
    expect(isLineRect(R(120), 1)).toBe(false)
    expect(isLineRect(R(120), 2)).toBe(true) // 120 <= 80 * 2
    expect(isLineRect(R(161), 2)).toBe(false)
  })

  it('degenerate rects are not lines', () => {
    expect(isLineRect(R(23, 0.5))).toBe(false) // zero-width fragment
    expect(isLineRect(R(0.5))).toBe(false)     // zero-height
  })
})

describe('sameLine — the 3px dedup, VARIED', () => {
  it('a container box 3.000px above its own first text rect reads as the SAME line', () => {
    // THE MEASUREMENT AT THE HEART OF THE BUG (panerect.mjs, real DocView DOM): li box top 725.188,
    // its first text rect 728.188. Exactly 3.000 — the half-leading, (29.109 − 23) / 2 = 3.05.
    // So the dedup DELETED the real line and kept the container's box, 3px too high.
    expect(sameLine(728.188, 725.188)).toBe(true)
  })

  it('two consecutive real lines (29.109px apart) are NOT the same line', () => {
    expect(sameLine(757.297, 728.188)).toBe(false)
  })

  it('the threshold is EXACTLY SAME_LINE_PX — the boundary, both sides', () => {
    expect(sameLine(100 + SAME_LINE_PX, 100)).toBe(true)
    expect(sameLine(100 + SAME_LINE_PX + 0.001, 100)).toBe(false)
    expect(SAME_LINE_PX).toBe(3)
    // …and it must stay strictly under a real line's advance, or the dedup eats real lines.
    expect(SAME_LINE_PX).toBeLessThan(29.109)
  })
})
