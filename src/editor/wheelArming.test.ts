// KEEPS THE PINCH ZOOM OURS (2026-08-28). Peter: "both water and page zoom no longer appear to be
// working with finger drawing closer and farther. It overrides to the native GPU zoom."
//
// A trackpad pinch is wheel{ctrlKey:true} with NO key event, so the arming rule cannot wait to see
// a modifier — by then the browser has already zoomed, and a browser zoom level is not something a
// page can undo. The bug hid behind the magnify term: at a narrow window fit-to-width makes magnify
// ≠ 1, the listener is armed for another reason, and the pinch works; full-screen returns magnify
// to 1 and the same gesture zooms the browser. Window-size-dependent, which reads as random.
//
// The in-browser proof (defaultPrevented on a synthetic ctrl-wheel) is the truth; this is the cheap
// guard that stops the `pointerOver` term being tidied away six weeks from now.

import { describe, it, expect } from 'vitest'
import { shouldArmWheel } from './Scroll'

const S = (o: Partial<Parameters<typeof shouldArmWheel>[0]> = {}) =>
  ({ ctrlHeld: false, pointerOver: false, magnify: 1, ...o })

describe('non-passive wheel arming', () => {
  it('THE BUG: armed with the cursor over the page at magnify 1, before any modifier is seen', () => {
    expect(shouldArmWheel(S({ pointerOver: true }))).toBe(true)
  })

  it('KNOWN-NEGATIVE: without the pointer term this exact state is unarmed', () => {
    // The shipped rule before the fix, restated. If this ever equals the rule above, the guard is
    // measuring nothing.
    const legacy = (s: ReturnType<typeof S>) => s.ctrlHeld || s.magnify !== 1
    expect(legacy(S({ pointerOver: true }))).toBe(false)
  })

  it('the magnify term is why it looked intermittent — narrow windows armed it by accident', () => {
    expect(shouldArmWheel(S({ magnify: 0.57 }))).toBe(true)   // fit-to-width: worked
    expect(shouldArmWheel(S({ magnify: 1 }))).toBe(false)     // full screen: same gesture, native zoom
  })

  it('still unarmed when the cursor is elsewhere at rest — the latency guard survives', () => {
    expect(shouldArmWheel(S())).toBe(false)
  })

  it('a held modifier still arms it (keyboard ctrl+wheel is unchanged)', () => {
    expect(shouldArmWheel(S({ ctrlHeld: true }))).toBe(true)
  })
})
