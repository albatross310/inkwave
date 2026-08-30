// THE PHONE-VS-DESKTOP PREDICATE — a leaf, deliberately.
//
// ⚠ IT IMPORTS NOTHING, AND THAT IS THE POINT. This lived in `Scroll.tsx`, which is ~1,900 lines of
// wave choreography, coast/brake animation, hybrid zoom and WAAPI wiring. Seventeen modules import
// it and FOURTEEN of them want nothing else from that file — a page menu, a countdown, a verify
// modal, the PDF panels — so every one of them was pulling the entire load-animation state machine
// into its import graph to ask one media query. `Scroll.tsx` re-exports it, so the three callers
// that legitimately want both are unchanged.
//
// ⚠ DEVICE-BASED, NOT WIDTH-BASED, and do not "improve" it into a breakpoint. It answers "is this a
// touch phone or tablet", which does NOT change when the writer zooms the browser — that is exactly
// why it is the right signal for layout decisions (margins, background, tap targets) and a width
// media query is not. A narrow desktop window is still a desktop.

/** True on touch phones/tablets (coarse pointer, no hover). */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse) and (hover: none)')?.matches === true
}
