import { describe, it, expect, beforeEach } from 'vitest'
import {
  getMagnify, getUserMagnify, setUserMagnify, setFitContext, subscribe, scaleFor, unscale,
  MIN_MAGNIFY, MAX_MAGNIFY, WATER_MARGIN_PX,
} from './magnify'

// Module is a singleton — put it back to a known state before each test.
beforeEach(() => {
  setFitContext(null)
  setUserMagnify(1)
})

describe('user magnify clamping', () => {
  it('clamps intent into [MIN, MAX]', () => {
    expect(setUserMagnify(0.3)).toBe(MIN_MAGNIFY)
    expect(getUserMagnify()).toBe(MIN_MAGNIFY)
    expect(setUserMagnify(9)).toBe(MAX_MAGNIFY)
    expect(getUserMagnify()).toBe(MAX_MAGNIFY)
  })

  it('rejects junk values back to 1', () => {
    expect(setUserMagnify(NaN)).toBe(1)
    expect(setUserMagnify(-2)).toBe(1)
  })

  it('effective follows intent when no floor binds', () => {
    setUserMagnify(1.8)
    expect(getMagnify()).toBe(1.8)
  })
})

describe('fit-to-width floor', () => {
  it('releases (scale 1) when the page fits at natural size', () => {
    setFitContext(900, 794) // wide window
    expect(getMagnify()).toBe(1)
  })

  it('scales the page down continuously when the window is narrower than the page', () => {
    setFitContext(600, 800)
    expect(getMagnify()).toBeCloseTo(0.75, 4)
    setFitContext(400, 800) // narrower still → smaller, continuously
    expect(getMagnify()).toBeCloseTo(0.5, 4)
  })

  it('the fit wins outright while it binds — a full page is always shown', () => {
    setUserMagnify(1.8)
    setFitContext(600, 800)
    expect(getMagnify()).toBeCloseTo(0.75, 4) // no horizontal cut-off ever from resizing
  })

  it('wheel intent below the floor is clamped up (page never smaller than fit/natural)', () => {
    setFitContext(600, 800)
    setUserMagnify(getMagnify() * 0.926) // wheel-down over the water while pinned
    expect(getUserMagnify()).toBe(MIN_MAGNIFY) // intent floors at 1, never runs away downward
    expect(getMagnify()).toBeCloseTo(0.75, 4)
  })

  it('resizing wider releases the floor back to the persisted intent', () => {
    setUserMagnify(1.8)
    setFitContext(600, 800)
    expect(getMagnify()).toBeCloseTo(0.75, 4)
    setFitContext(2000, 800)
    expect(getMagnify()).toBe(1.8)
  })

  it('never degenerates below the 0.2 safety clamp', () => {
    setFitContext(1, 800)
    expect(getMagnify()).toBe(0.2)
  })

  it('null / bad page width releases the floor', () => {
    setFitContext(600, 800)
    setFitContext(null)
    expect(getMagnify()).toBe(1)
    setFitContext(600, 0)
    expect(getMagnify()).toBe(1)
  })

  it('exports a sane water margin', () => {
    expect(WATER_MARGIN_PX).toBeGreaterThan(0)
  })
})

describe('subscribe', () => {
  it('notifies on effective changes only, and unsubscribes cleanly', () => {
    let n = 0
    const off = subscribe(() => n++)
    setUserMagnify(1.5)
    expect(n).toBe(1)
    setUserMagnify(1.5) // same effective → no notification
    expect(n).toBe(1)
    setFitContext(600, 800) // floor binds → effective changes
    expect(n).toBe(2)
    off()
    setUserMagnify(2)
    expect(n).toBe(2)
  })
})

describe('visual → layout conversion', () => {
  it('unscale divides by the scale', () => {
    expect(unscale(70, 0.7)).toBeCloseTo(100, 6)
    expect(unscale(180, 1.8)).toBeCloseTo(100, 6)
  })

  it('unscale is the identity at 1 and guards degenerate scales', () => {
    expect(unscale(42, 1)).toBe(42)
    expect(unscale(42, 0)).toBe(42)
  })

  it('scaleFor is 1 for null / detached elements', () => {
    setUserMagnify(1.8)
    expect(scaleFor(null)).toBe(1)
    expect(scaleFor(undefined)).toBe(1)
    // An element without an .iw-magnified surface ancestor (e.g. SnapshotView) resolves to 1.
    const fake = { closest: () => null } as unknown as Element
    expect(scaleFor(fake)).toBe(1)
  })

  it('scaleFor returns the effective magnify inside a transformed surface', () => {
    setUserMagnify(1.8)
    const surf = { classList: { contains: (c: string) => c === 'iw-magnified' } }
    const el = { closest: () => surf } as unknown as Element
    expect(scaleFor(el)).toBe(1.8)
  })
})
