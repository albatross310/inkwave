// ─── §A4 tap-sync ────────────────────────────────────────────────────────────
//
// The two claims that carry this feature are both "a naive version would be confidently wrong":
//   1. The cursor never sweeps across a line end — because a bar cannot span one BY CONSTRUCTION.
//   2. Tapping beats beats entering a BPM — because a real performance breathes.
// Both are proved against the naive model, running here, failing. A cursor graded only against
// itself would score every position it produced as the right one.

import { describe, expect, it } from 'vitest'
import {
  absoluteBeat, barPositionAt, barRegionsFromAnchors, barSpansFromAnchors, cursorAt, loopForBars,
  nextBarIndex, orderedBeats, spanOfBar, timeOfBar,
} from './sync'
import type { BarlineAnchor, BeatMapEntry, Sync } from './types'

// A page: two systems, four bars each. Bars 0-3 on system 0, bars 4-7 on system 1.
const ANCHORS: BarlineAnchor[] = [
  { page: 0, system: 0, x: 0.08, bar_index: 0 },
  { page: 0, system: 0, x: 0.30, bar_index: 1 },
  { page: 0, system: 0, x: 0.52, bar_index: 2 },
  { page: 0, system: 0, x: 0.74, bar_index: 3 },
  { page: 0, system: 0, x: 0.94, bar_index: 4 },   // closes bar 3; opens nothing on this line
  { page: 0, system: 1, x: 0.08, bar_index: 4 },
  { page: 0, system: 1, x: 0.30, bar_index: 5 },
  { page: 0, system: 1, x: 0.52, bar_index: 6 },
  { page: 0, system: 1, x: 0.74, bar_index: 7 },
  { page: 0, system: 1, x: 0.94, bar_index: 8 },
]

/** A steady 4/4 at 120bpm (0.5s per beat, 2s per bar), tapped on every beat for 8 bars. */
function steadyBeats(bars = 8): BeatMapEntry[] {
  const out: BeatMapEntry[] = []
  for (let b = 0; b < bars; b++) {
    for (let beat = 1; beat <= 4; beat++) out.push({ time_sec: b * 2 + (beat - 1) * 0.5, bar_index: b, beat })
  }
  return out
}

const SYNC: Sync = { barline_anchors: ANCHORS, beat_map: steadyBeats() }

// ─── Spatial ─────────────────────────────────────────────────────────────────

describe('bars from tapped barlines', () => {
  it('makes a bar from each consecutive pair on a line — n anchors, n−1 bars', () => {
    const spans = barSpansFromAnchors(ANCHORS)
    expect(spans).toHaveLength(8)                       // 4 per system
    expect(spans.map(s => s.bar_index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(spanOfBar(spans, 0)).toMatchObject({ page: 0, system: 0, x0: 0.08, x1: 0.30 })
    expect(spanOfBar(spans, 4)).toMatchObject({ page: 0, system: 1, x0: 0.08, x1: 0.30 })
  })

  it('NEVER makes a bar that spans two systems', () => {
    // The structural claim. Bar 3 ends at the right edge of system 0; bar 4 starts at the left edge
    // of system 1. No span joins them, so nothing downstream can interpolate between them.
    for (const s of barSpansFromAnchors(ANCHORS)) expect(s.x1).toBeGreaterThan(s.x0)
    const three = spanOfBar(barSpansFromAnchors(ANCHORS), 3)!
    expect(three).toMatchObject({ system: 0, x0: 0.74, x1: 0.94 })
  })

  it('survives taps made out of order — a student goes back for the one they missed', () => {
    const shuffled = [ANCHORS[2], ANCHORS[0], ANCHORS[4], ANCHORS[1], ANCHORS[3]]
    const spans = barSpansFromAnchors(shuffled)
    expect(spans.map(s => s.bar_index)).toEqual([0, 1, 2, 3])
    expect(spanOfBar(spans, 0)).toMatchObject({ x0: 0.08, x1: 0.30 })
  })

  it('a single tap on a line yields NO bar — the structure is unknown, not one giant bar', () => {
    // Same refusal as reflow.ts barsOf. One bogus bar spanning the line looks like a correct answer
    // and mis-anchors everything pinned to it.
    expect(barSpansFromAnchors([{ page: 0, system: 0, x: 0.5, bar_index: 0 }])).toEqual([])
    expect(barSpansFromAnchors([])).toEqual([])
  })

  it('keeps the student’s own numbering — a tapped pickup stays bar 0', () => {
    const withPickup: BarlineAnchor[] = [
      { page: 0, system: 0, x: 0.08, bar_index: 0 },
      { page: 0, system: 0, x: 0.16, bar_index: 1 },
      { page: 0, system: 0, x: 0.40, bar_index: 2 },
    ]
    expect(barSpansFromAnchors(withPickup).map(s => s.bar_index)).toEqual([0, 1])
  })
})

// ─── Temporal ────────────────────────────────────────────────────────────────

describe('absolute beats', () => {
  it('collapses (bar, beat) into one number, decrementing the 1-based count exactly once', () => {
    expect(absoluteBeat({ time_sec: 0, bar_index: 0, beat: 1 }, 4)).toBe(0)
    expect(absoluteBeat({ time_sec: 0, bar_index: 0, beat: 4 }, 4)).toBe(3)
    expect(absoluteBeat({ time_sec: 0, bar_index: 1, beat: 1 }, 4)).toBe(4)
    expect(absoluteBeat({ time_sec: 0, bar_index: 3, beat: 3 }, 3)).toBe(11)   // 3/4 time
  })

  it('drops a tap that goes backwards — the student lost the count and restarted', () => {
    const taps: BeatMapEntry[] = [
      { time_sec: 0, bar_index: 0, beat: 1 },
      { time_sec: 0.5, bar_index: 0, beat: 2 },
      { time_sec: 1.0, bar_index: 0, beat: 1 },   // a re-start: backwards in beat, forwards in time
      { time_sec: 1.5, bar_index: 0, beat: 3 },
    ]
    expect(orderedBeats(taps, 4).map(e => e.beat)).toEqual([1, 2, 3])
  })
})

describe('bar position over time', () => {
  it('advances at the tapped tempo', () => {
    const beats = steadyBeats()
    expect(barPositionAt(beats, 0, 4)!.bar).toBeCloseTo(0, 6)
    expect(barPositionAt(beats, 1, 4)!.bar).toBeCloseTo(0.5, 6)    // half a bar in, at 2s/bar
    expect(barPositionAt(beats, 2, 4)!.bar).toBeCloseTo(1, 6)
    expect(barPositionAt(beats, 5, 4)!.bar).toBeCloseTo(2.5, 6)
  })

  it('is NULL before the first tap — not bar zero', () => {
    // Pinning to 0 would assert the piece had not started, which we do not know.
    expect(barPositionAt(steadyBeats(), -0.1, 4)).toBeNull()
    expect(barPositionAt([], 5, 4)).toBeNull()
  })

  it('extrapolates past the last tap at the last measured rate, and SAYS it is extrapolating', () => {
    const beats = steadyBeats(2)               // taps end at 3.5s (bar 1, beat 4)
    const p = barPositionAt(beats, 5.5, 4)!
    expect(p.extrapolated).toBe(true)
    // The last tap is bar 1 BEAT 4 (t=3.5s) — i.e. bar 1.75, not bar 2. Two seconds on at the
    // measured 2 beats/s is +4 beats: bar 2.75. (Worth spelling out: the first cut of this test
    // asserted 2.5 by reasoning in whole bars from "the taps end after bar 1", and the taps do not
    // end at a bar line. The code was right.)
    expect(p.bar).toBeCloseTo(2.75, 6)
    expect(barPositionAt(beats, 2, 4)!.extrapolated).toBe(false)   // inside the taps: measured
  })

  it('a lone tap gives a position but no tempo', () => {
    const p = barPositionAt([{ time_sec: 0, bar_index: 2, beat: 1 }], 10, 4)!
    expect(p.bar).toBe(2)
    expect(p.extrapolated).toBe(true)
  })

  it('two taps at the same instant do not divide by zero', () => {
    const taps: BeatMapEntry[] = [
      { time_sec: 1, bar_index: 0, beat: 1 },
      { time_sec: 1, bar_index: 0, beat: 2 },
    ]
    expect(Number.isFinite(barPositionAt(taps, 1, 4)!.bar)).toBe(true)
  })
})

// ─── The cursor ──────────────────────────────────────────────────────────────

describe('the cursor', () => {
  it('interpolates across a bar at the tapped tempo', () => {
    expect(cursorAt(SYNC, 0)).toMatchObject({ page: 0, system: 0, bar_index: 0, x: 0.08 })
    // 1s in = halfway through bar 0 (x 0.08 → 0.30).
    expect(cursorAt(SYNC, 1)!.x).toBeCloseTo(0.19, 6)
    expect(cursorAt(SYNC, 2)).toMatchObject({ bar_index: 1, x: 0.30 })
  })

  it('wraps to the next system at a line end', () => {
    // Bar 3 is the last on system 0; bar 4 is the first on system 1.
    const endOfLine = cursorAt(SYNC, 7.9)!               // late in bar 3
    expect(endOfLine).toMatchObject({ system: 0, bar_index: 3 })
    expect(endOfLine.x).toBeGreaterThan(0.9)

    const nextLine = cursorAt(SYNC, 8.1)!                // just into bar 4
    expect(nextLine).toMatchObject({ system: 1, bar_index: 4 })
    expect(nextLine.x).toBeLessThan(0.12)
  })

  // ─── THE KNOWN-NEGATIVE ────────────────────────────────────────────────────
  it('KNOWN-NEGATIVE: the naive "lerp to the next bar\'s anchor" model is order-dependent and flies backwards', () => {
    // The model this design exists to prevent: sort anchors by bar_index and lerp x from bar N's
    // anchor to bar N+1's. It is the obvious implementation, and its defect is that it never looks
    // at `system` — so at a line end it pairs the last bar of one line with the first anchor of the
    // next.
    //
    // WORTH THE DETOUR, because the first cut of this test SCORED IT AS CORRECT: two anchors share
    // bar_index 4 (the closing barline of system 0, and the opening barline of system 1 — see the
    // fixture), and `.find` happened to return the system-0 one, which is the right answer by luck.
    // A known-negative that passes is not a negative. The luck is the ARRAY ORDER, and array order
    // is not a fact about the music: taps merge from another device, or the student tapped the
    // second line first. So the negative is run under BOTH legal orders, and the naive model gives
    // two different answers — which is itself the bug, before you even ask which one is wrong.
    const naiveX = (anchors: BarlineAnchor[], barIndex: number, f: number) => {
      const sorted = [...anchors].sort((a, b) => a.bar_index - b.bar_index)   // NB: ignores `system`
      const a = sorted.find(s => s.bar_index === barIndex)!
      const b = sorted.find(s => s.bar_index === barIndex + 1)!
      return a.x + f * (b.x - a.x)
    }

    const asTapped = ANCHORS
    const asMerged = [...ANCHORS].reverse()      // equally legal: a sync landed them the other way

    // Same music, same taps, two array orders — two different answers.
    expect(naiveX(asTapped, 3, 1)).not.toBeCloseTo(naiveX(asMerged, 3, 1), 6)
    // And under one of them the cursor runs BACKWARD across the whole page during bar 3.
    expect(naiveX(asMerged, 3, 1)).toBeCloseTo(0.08, 6)
    expect(naiveX(asMerged, 3, 1)).toBeLessThan(naiveX(asMerged, 3, 0))

    // The real cursor is order-INDEPENDENT (it groups by system before pairing) and runs forward,
    // staying on its own line.
    for (const order of [asTapped, asMerged]) {
      const sync: Sync = { barline_anchors: order, beat_map: steadyBeats() }
      const start = cursorAt(sync, 6)!, end = cursorAt(sync, 7.99)!
      expect(start.bar_index).toBe(3)
      expect(end.x).toBeGreaterThan(start.x)              // forward
      expect(end.system).toBe(0)                          // still on its own line
      expect(end.x).toBeLessThanOrEqual(0.94)             // never past that line's last barline
    }
  })

  it('is NULL for a bar nobody tapped — no confident line over the wrong music', () => {
    // Only system 0 tapped; the beat map runs on into bars that have no barlines.
    const half: Sync = { barline_anchors: ANCHORS.filter(a => a.system === 0), beat_map: steadyBeats() }
    expect(cursorAt(half, 1)).not.toBeNull()              // bar 0: tapped
    expect(cursorAt(half, 9)).toBeNull()                  // bar 4: never tapped
  })

  it('is NULL before the first tapped beat', () => {
    expect(cursorAt(SYNC, -1)).toBeNull()
  })

  it('honours a 3/4 time signature', () => {
    const waltz: BeatMapEntry[] = []
    for (let b = 0; b < 4; b++) for (let beat = 1; beat <= 3; beat++) {
      waltz.push({ time_sec: b * 1.5 + (beat - 1) * 0.5, bar_index: b, beat })
    }
    const s: Sync = { barline_anchors: ANCHORS, beat_map: waltz }
    expect(cursorAt(s, 1.5, { beatsPerBar: 3 })).toMatchObject({ bar_index: 1, x: 0.30 })
  })
})

// ─── Why tapping, and not a BPM box ──────────────────────────────────────────

describe('the tapped map tracks a performance a single BPM cannot', () => {
  /** A rubato performance: bars 0-3 at 2s, then a ritardando — bars 4-7 stretch to 3s. */
  function rubatoBeats(): BeatMapEntry[] {
    const out: BeatMapEntry[] = []
    let t = 0
    for (let b = 0; b < 8; b++) {
      const barSec = b < 4 ? 2 : 3
      for (let beat = 1; beat <= 4; beat++) out.push({ time_sec: t + (beat - 1) * (barSec / 4), bar_index: b, beat })
      t += barSec
    }
    return out
  }

  it('KNOWN-NEGATIVE: a fixed BPM drifts a whole bar off by the end; the taps do not', () => {
    const beats = rubatoBeats()
    // Truth: bar 6 begins at 8 + 2×3 = 14s.
    const TRUE_BAR = 6
    const t = 14

    // The tapped map: right there.
    expect(barPositionAt(beats, t, 4)!.bar).toBeCloseTo(TRUE_BAR, 6)

    // A single global BPM fitted to the opening (2s/bar) — the "just enter the tempo" model.
    const fixedBpmBar = t / 2
    expect(Math.abs(fixedBpmBar - TRUE_BAR)).toBeGreaterThan(0.9)   // a whole bar wrong, and growing
  })

  it('the rubato fixture is really rubato — not a steady tempo wearing a hard name', () => {
    // Guards the negative above: if the fixture went steady, the BPM model would agree and the
    // test would pass for a reason that has nothing to do with tapping.
    const beats = rubatoBeats()
    const early = beats[4].time_sec - beats[0].time_sec     // bar 0 → bar 1
    const late = beats[24].time_sec - beats[20].time_sec    // bar 5 → bar 6
    expect(late).toBeGreaterThan(early * 1.4)
  })
})

// ─── Seek, and loops ─────────────────────────────────────────────────────────

describe('seek-to-bar', () => {
  it('returns the moment a bar begins', () => {
    expect(timeOfBar(steadyBeats(), 0, {})).toBeCloseTo(0, 6)
    expect(timeOfBar(steadyBeats(), 3, {})).toBeCloseTo(6, 6)
  })

  it('agrees with the cursor — one rule, so a seek lands where the cursor says the bar is', () => {
    for (const bar of [1, 2, 3, 5]) {
      const t = timeOfBar(SYNC.beat_map, bar, {})!
      const c = cursorAt(SYNC, t)!
      expect(c.bar_index).toBe(bar)
      expect(c.x).toBeCloseTo(spanOfBar(barSpansFromAnchors(ANCHORS), bar)!.x0, 6)
    }
  })

  it('REFUSES a bar outside the taps rather than guessing — a seek acts, it does not draw', () => {
    // The cursor may extrapolate (it only paints); a seek moves the student's music.
    expect(timeOfBar(steadyBeats(2), 6, {})).toBeNull()
    expect(timeOfBar([], 0, {})).toBeNull()
  })
})

describe('loop-a-section', () => {
  it('runs from the start of the first bar to the start of the one AFTER the last', () => {
    // A loop over "bars 4 to 6" must PLAY bar 6, so it ends where bar 7 begins.
    expect(loopForBars(steadyBeats(), 4, 6, {})).toEqual({ startSec: 8, endSec: 14 })
  })

  it('normalises a backwards selection', () => {
    expect(loopForBars(steadyBeats(), 6, 4, {})).toEqual({ startSec: 8, endSec: 14 })
  })

  it('refuses when an endpoint is untapped', () => {
    expect(loopForBars(steadyBeats(2), 0, 6, {})).toBeNull()
  })
})

// ─── The payoff: taps give a photo Piece its bar model ───────────────────────

describe('barRegionsFromAnchors — what the heatmap colours', () => {
  const sysRegion = (s: number) => (s === 0 ? { y: 0.1, h: 0.2 } : s === 1 ? { y: 0.5, h: 0.2 } : null)

  it('turns taps into the BarRegions a page carries', () => {
    const regions = barRegionsFromAnchors(ANCHORS, 0, sysRegion)
    expect(regions).toHaveLength(8)
    expect(regions[0]).toMatchObject({ bar_index: 0, system: 0 })
    // `w` is COMPUTED (0.30 − 0.08 = 0.21999999999999997), so it is compared with a tolerance.
    // toEqual on a derived float is a test that fails for a reason nobody learns anything from.
    expect(regions[0].region.x).toBeCloseTo(0.08, 6)
    expect(regions[0].region.y).toBeCloseTo(0.1, 6)
    expect(regions[0].region.w).toBeCloseTo(0.22, 6)
    expect(regions[0].region.h).toBeCloseTo(0.2, 6)
    // Bar 4 is on system 1, so it takes that system's band — the wrap survives the conversion.
    expect(regions[4].region.y).toBe(0.5)
  })

  it('sets NO bar_label — the student tapped a position, not a number', () => {
    for (const r of barRegionsFromAnchors(ANCHORS, 0, sysRegion)) {
      expect(r).not.toHaveProperty('bar_label')
    }
  })

  it('drops a tap on a system the page does not have, rather than guessing a band', () => {
    const stray: BarlineAnchor[] = [
      { page: 0, system: 9, x: 0.1, bar_index: 0 },
      { page: 0, system: 9, x: 0.5, bar_index: 1 },
    ]
    expect(barRegionsFromAnchors(stray, 0, sysRegion)).toEqual([])
  })
})

describe('nextBarIndex', () => {
  it('is one past the highest tapped, so tapping runs along the line', () => {
    expect(nextBarIndex([])).toBe(0)
    expect(nextBarIndex(ANCHORS)).toBe(9)
  })

  it('is DERIVED, so deleting a mis-tap renumbers instead of drifting', () => {
    const after = ANCHORS.filter(a => a.bar_index < 3)
    expect(nextBarIndex(after)).toBe(3)
  })
})
