// THE GATE'S HALF OF THE ZOOM WARM. `pnpm prove:zoomcost` is the in-browser truth — it measures a
// real notch on a real 55-gap document and proves the commit drops ~0.33× — but it needs a build, a
// server and a wheel gesture, it is run by hand, and six weeks from now a proof that ran once is
// indistinguishable from one that never ran. These are the assertions a careless edit trips in
// ~10ms with no browser.
//
// EVERY TEST HERE EXISTS BECAUSE THE OPPOSITE MISTAKE IS SILENT. Warm too eagerly and a ~100ms
// hypothetical reflow lands back on the input path — every pixel still correct, the feature simply
// undone. Warm never and the old cost returns, equally invisibly. Neither shows up in a rendering
// test, which is exactly why the decision is a pure function rather than four conditions inline in
// an event handler.
import { describe, it, expect } from 'vitest'
import { planLiveWarm, WARM_COST_MARGIN, type WarmInputs } from './zoomWarm'

// A gesture mid-flow on a desktop: notch 4 arrived 260ms after notch 3, zooming IN.
const base: WarmInputs = {
  enabled: true, placeholders: true, phone: false,
  step: 4, from: 3, gapMs: 260,
  delayMs: 45, lastWarmMs: 120,
  minStep: -8, maxStep: 11, cached: false,
}
const plan = (o: Partial<WarmInputs> = {}) => planLiveWarm({ ...base, ...o })

describe('planLiveWarm — when a zoom step may be warmed between notches', () => {
  it('warms the NEXT step in the direction of travel', () => {
    expect(plan()).toEqual({ warm: true, step: 5 })
    expect(plan({ step: 3, from: 4 })).toEqual({ warm: true, step: 2 }) // zooming out
  })

  it('warms the FIRST notch of a gesture, where there is no cadence yet', () => {
    // gapMs is Infinity there. This is the notch a writer notices most; a rule that only warms once
    // a cadence has been established would leave exactly it cold.
    expect(plan({ gapMs: Infinity, lastWarmMs: 0 })).toEqual({ warm: true, step: 5 })
    expect(plan({ gapMs: Infinity, lastWarmMs: 9999 })).toEqual({ warm: true, step: 5 })
  })

  it('refuses when there is no direction to predict — it does not guess one', () => {
    expect(plan({ from: null })).toEqual({ warm: false, why: 'no-direction' })
    expect(plan({ from: 4 })).toEqual({ warm: false, why: 'no-direction' }) // same step, no movement
  })

  it('refuses OUTSIDE the placeholder regime — liveCache and stepCache must never mix', () => {
    // Warming with the live window down would measure full-layout geometry and file it under the
    // placeholder cache; a later step would then apply squashed panels to a full layout.
    expect(plan({ placeholders: false })).toEqual({ warm: false, why: 'not-live' })
  })

  it('refuses on phone: a pinch commits every frame, so there is no gap to spend', () => {
    expect(plan({ phone: true })).toEqual({ warm: false, why: 'phone' })
  })

  it('refuses past the lattice bounds, and at them', () => {
    expect(plan({ step: 11, from: 10 })).toEqual({ warm: false, why: 'out-of-range' })
    expect(plan({ step: -8, from: -7 })).toEqual({ warm: false, why: 'out-of-range' })
    expect(plan({ step: 10, from: 9 })).toEqual({ warm: true, step: 11 }) // the last reachable one
  })

  it('does not re-measure a step already cached', () => {
    expect(plan({ cached: true })).toEqual({ warm: false, why: 'cached' })
  })

  it('honours the live known-negative the probe uses as its control', () => {
    // Without this the A/B has no control and the probe's ratio means nothing.
    expect(plan({ enabled: false })).toEqual({ warm: false, why: 'disabled' })
  })

  describe('the cadence gate — a warm the next notch waits on is worse than a miss', () => {
    it('refuses when the observed gap cannot fit delay + the warm’s own measured cost', () => {
      // 45ms delay + 120ms × 1.2 margin = 189ms of work; a 150ms cadence cannot absorb it.
      expect(plan({ gapMs: 150 })).toEqual({ warm: false, why: 'too-fast' })
      expect(plan({ gapMs: 16 })).toEqual({ warm: false, why: 'too-fast' }) // a trackpad stream
    })

    it('accepts as soon as the gap does fit', () => {
      expect(plan({ gapMs: base.delayMs + 120 * WARM_COST_MARGIN })).toEqual({ warm: true, step: 5 })
    })

    it('SELF-CALIBRATES to the machine: the same cadence flips on the warm’s measured cost', () => {
      // The whole point of reading `lastWarmMs` rather than hard-coding a threshold. A 200ms cadence
      // is comfortable on a machine where the warm costs 40ms and hopeless where it costs 300ms —
      // and which of those Peter is on is not knowable from here.
      expect(plan({ gapMs: 200, lastWarmMs: 40 })).toEqual({ warm: true, step: 5 })
      expect(plan({ gapMs: 200, lastWarmMs: 300 })).toEqual({ warm: false, why: 'too-fast' })
    })

    it('a never-yet-run warm (cost 0) is allowed to run once and learn its cost', () => {
      // Otherwise `lastWarmMs` stays 0 forever only because nothing ever measured it — a feature
      // that disables itself for want of the number it would produce.
      expect(plan({ gapMs: 60, lastWarmMs: 0 })).toEqual({ warm: true, step: 5 })
    })
  })

  it('the refusals are ORDERED so the reason names the real cause', () => {
    // A phone pinch with no direction is refused for being a phone; a disabled feature is refused
    // for being disabled even when everything else would also refuse. The `why` is read by a human
    // diagnosing "the warm never fires", so it has to name the first thing to fix.
    expect(plan({ enabled: false, phone: true, from: null })).toEqual({ warm: false, why: 'disabled' })
    expect(plan({ placeholders: false, phone: true })).toEqual({ warm: false, why: 'not-live' })
  })
})
