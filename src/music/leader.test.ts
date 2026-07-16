// ─── Smart leader-line routing (§A2) ─────────────────────────────────────────
//
// The claim under test is "smart": that the router picks a route AROUND the music where a naive one
// goes through it. That claim is only meaningful against a comparator, so `naiveRoute` is here as the
// known-negative and is shown to FAIL on the same input the router passes. A router graded only
// against itself would score every route it returns as the right one.

import { describe, expect, it } from 'vitest'
import { countCrossings, naiveRoute, ownerOfGapMark, routeLeader, type Obstacle } from './leader'

// A page laid out by the reflow: two systems with a writing gap between and below them.
const SYSTEMS: Obstacle[] = [
  { y0: 0.05, y1: 0.25 },   // system 0
  { y0: 0.45, y1: 0.65 },   // system 1
]

describe('routing around the music', () => {
  it('reaches a target inside a system without crossing any other system', () => {
    const r = routeLeader({
      from: { x: 0.2, y: 0.35 },        // the note, in the gap between the systems
      to: { x: 0.6, y: 0.5 },           // a bar inside system 1
      obstacles: SYSTEMS,
    })
    expect(r.crossings).toBe(0)
    expect(r.approach).toBe('above')    // it comes down into system 1 from the gap above it
    expect(r.path.startsWith('M 0.2 0.35 C')).toBe(true)
  })

  it('KNOWN-NEGATIVE: the naive straight line ploughs through a note the router goes around', () => {
    // The realistic congestion (§A2): the gap is where EVERYTHING the student writes ends up, so the
    // thing in the way is usually another sticky note, not a stave.
    //
    // The first cut of this test used a full-width SYSTEM as the thing to avoid and it could not
    // pass — correctly. A system spans the page, so a leader from below it to above it must cross it
    // whatever curve you draw: smart and naive both scored 2 and the "smart" claim was untestable in
    // that geometry. The router's real avoidance skill is local obstacles, so that is what this
    // measures. (`routeLeader`'s doc records the limit.)
    const sticky: Obstacle = { y0: 0.3, y1: 0.42, x0: 0.35, x1: 0.55 }  // another note in the gap
    const from = { x: 0.2, y: 0.35 }
    const to = { x: 0.6, y: 0.5 }                                        // a bar in system 1

    const obstacles = [...SYSTEMS, sticky]
    const naive = naiveRoute(from, to, obstacles)
    const smart = routeLeader({ from, to, obstacles })

    expect(naive.crossings).toBeGreaterThan(0)          // the bug: straight through the other note
    expect(smart.crossings).toBe(0)                     // the router dips below it instead
    expect(smart.crossings).toBeLessThan(naive.crossings)
  })

  it('picks the approach side by clearance, not by a fixed rule', () => {
    // Same target, two note positions. The side chosen must follow where the note actually is.
    const to = { x: 0.5, y: 0.55 }                       // inside system 1
    const above = routeLeader({ from: { x: 0.3, y: 0.35 }, to, obstacles: SYSTEMS })
    const below = routeLeader({ from: { x: 0.3, y: 0.8 }, to, obstacles: SYSTEMS })
    expect(above.approach).toBe('above')
    expect(below.approach).toBe('below')
  })

  it('honours an explicit override even when it is the worse route', () => {
    // The student dragged the line themselves — their call wins over the scorer's.
    const r = routeLeader({
      from: { x: 0.2, y: 0.35 }, to: { x: 0.6, y: 0.5 }, obstacles: SYSTEMS, side: 'below',
    })
    expect(r.approach).toBe('below')
  })

  it('leaves the label sideways even when the target is directly below it', () => {
    // dx ≈ 0 would otherwise collapse the curve into a vertical spike out of the note.
    const r = routeLeader({ from: { x: 0.5, y: 0.35 }, to: { x: 0.5, y: 0.5 }, obstacles: SYSTEMS })
    const maxDeviation = Math.max(...r.points.map(p => Math.abs(p.x - 0.5)))
    expect(maxDeviation).toBeGreaterThan(0.01)
  })

  it('ends exactly on the target — a leader that misses its bar is a wrong leader', () => {
    const to = { x: 0.62, y: 0.51 }
    const r = routeLeader({ from: { x: 0.2, y: 0.35 }, to, obstacles: SYSTEMS })
    const end = r.points[r.points.length - 1]
    expect(end.x).toBeCloseTo(to.x, 6)
    expect(end.y).toBeCloseTo(to.y, 6)
  })
})

describe('countCrossings', () => {
  it('counts a band entered once, however many samples sit inside it', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: 0.5, y: 0.1 + i * 0.001 }))
    expect(countCrossings([...pts, { x: 0.5, y: 0.9 }], SYSTEMS)).toBe(1)
  })

  it('does not count the target itself as a crossing', () => {
    // The target is normally ON the music; arriving at it is the point, not a violation.
    const r = routeLeader({ from: { x: 0.2, y: 0.35 }, to: { x: 0.5, y: 0.5 }, obstacles: SYSTEMS })
    expect(r.crossings).toBe(0)
  })

  it('respects an obstacle\'s x-extent', () => {
    const barScoped: Obstacle[] = [{ y0: 0.45, y1: 0.65, x0: 0.8, x1: 0.9 }]
    const r = routeLeader({ from: { x: 0.1, y: 0.35 }, to: { x: 0.3, y: 0.55 }, obstacles: barScoped })
    expect(r.crossings).toBe(0)   // it passes well left of the obstacle's columns
  })
})

describe('the §A2 midline rule', () => {
  it('a mark above the gap midline belongs to the stave below it', () => {
    expect(ownerOfGapMark(0.31, 0.3, 0.4)).toBe('below')
  })

  it('a mark below the midline belongs to the stave above it', () => {
    expect(ownerOfGapMark(0.39, 0.3, 0.4)).toBe('above')
  })
})
