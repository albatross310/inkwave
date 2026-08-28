// KEEPS PAGE BREAKS OFF THE MIDDLE OF A LINE (2026-08-28). Peter: "I need lines to stop cutting at
// arbitrary points when you go over the page."
//
// Page breaks are CANONICAL — measured at zoom 1 so the same words land on page N everywhere. At any
// other font zoom the rendered text wraps somewhere else, so a canonical line start is NOT a
// rendered line start, and the display:block gap widget slices the line it lands in. MEASURED in the
// real app (scripts/textrender-probe, editor zoom swept):
//     zoom 1.00 → 0/10 mid-line     1.08 → 7/10     1.26 → 9/10     0.86 → 10/10
// A BLOCK BOUNDARY is a line start in every layout by construction, so that is where the break goes
// when the rendering isn't canonical. This is the predicate; the browser probe is the truth, and
// this is what stops it silently reverting.

import { describe, it, expect } from 'vitest'
import { shouldSnapToBlock } from './extensions/PaginationExtension'

const S = (o: Partial<Parameters<typeof shouldSnapToBlock>[0]> = {}) =>
  shouldSnapToBlock({ liveIsCanonical: false, orphan: 40, blockStart: 500, lastBreakAt: 100, ...o })

describe('shouldSnapToBlock', () => {
  it('THE CANONICAL PATH IS UNTOUCHED — this is the whole safety argument', () => {
    // Default desktop, print and PDF all render canonically. Peter chose the mid-block split in
    // 2026-07-15 ("probably split") and it must survive byte for byte.
    expect(S({ liveIsCanonical: true })).toBe(false)
  })

  it('snaps when the writer is zoomed — the case that cuts lines', () => {
    expect(S({ liveIsCanonical: false })).toBe(true)
  })

  it('a block that STARTS at the break needs no snap', () => {
    // orphan 0 ⇒ blockStart is the break already; snapping would be a no-op dressed as a decision.
    expect(S({ orphan: 0 })).toBe(false)
  })

  it('NEVER snaps back to a position already broken at — the over-tall-block guard', () => {
    // Without this a paragraph taller than a page is pushed whole, overflows again, and snaps to
    // the same boundary forever.
    expect(S({ blockStart: 100, lastBreakAt: 100 })).toBe(false)
    expect(S({ blockStart: 90, lastBreakAt: 100 })).toBe(false)
    expect(S({ blockStart: 101, lastBreakAt: 100 })).toBe(true)
  })

  it('an over-tall block is split on its SECOND encounter, not looped', () => {
    // Page 1: the block started here, push it whole.
    expect(S({ orphan: 300, blockStart: 500, lastBreakAt: 100 })).toBe(true)
    // Page 2: same block, same boundary — now it must split rather than snap again.
    expect(S({ orphan: 900, blockStart: 500, lastBreakAt: 500 })).toBe(false)
  })
})
