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
  it('clamps intent into [MIN, MAX] — zoom-out is (practically) unlimited', () => {
    expect(MIN_MAGNIFY).toBe(0.02) // degenerate-maths guard only, not a UX floor
    expect(setUserMagnify(0.005)).toBe(MIN_MAGNIFY)
    expect(getUserMagnify()).toBe(MIN_MAGNIFY)
    expect(setUserMagnify(9)).toBe(MAX_MAGNIFY)
    expect(getUserMagnify()).toBe(MAX_MAGNIFY)
  })

  it('a tiny page floating in water is valid: intent well below 1 sticks', () => {
    expect(setUserMagnify(0.1)).toBe(0.1)
    expect(getMagnify()).toBe(0.1)
  })

  it('rejects junk values back to 1', () => {
    expect(setUserMagnify(NaN)).toBe(1)
    expect(setUserMagnify(-2)).toBe(1)
  })

  it('effective follows intent when no cap binds', () => {
    setUserMagnify(1.8)
    expect(getMagnify()).toBe(1.8)
  })
})

describe('fit-to-width cap (never a partial page)', () => {
  it('caps zoom-IN at the fit scale on a narrow window', () => {
    setUserMagnify(1.8)
    setFitContext(600, 800)
    expect(getMagnify()).toBeCloseTo(0.75, 4) // full page always fits
  })

  it('never caps zoom-OUT: intent below the fit scale wins', () => {
    setUserMagnify(0.3)
    setFitContext(600, 800) // fit would be 0.75; the user wants smaller — allowed
    expect(getMagnify()).toBe(0.3)
    setUserMagnify(0.05)
    expect(getMagnify()).toBe(0.05)
  })

  it('shrinking the window squeezes a fitted page down continuously', () => {
    setFitContext(600, 800)
    expect(getMagnify()).toBeCloseTo(0.75, 4)
    setFitContext(400, 800)
    expect(getMagnify()).toBeCloseTo(0.5, 4)
  })

  it('caps zoom-IN on a WIDE window too (past fit would cut the page)', () => {
    setUserMagnify(2.5)
    setFitContext(1200, 800) // ratio 1.5 — page fills the window at 1.5
    expect(getMagnify()).toBeCloseTo(1.5, 4)
  })

  it('resizing wider releases the cap back to the persisted intent', () => {
    setUserMagnify(1.8)
    setFitContext(600, 800)
    expect(getMagnify()).toBeCloseTo(0.75, 4)
    setFitContext(2000, 800)
    expect(getMagnify()).toBe(1.8)
  })

  it('degenerate windows clamp the cap at MIN_MAGNIFY', () => {
    setFitContext(1, 800)
    expect(getMagnify()).toBe(MIN_MAGNIFY)
  })

  it('null / bad page width releases the cap', () => {
    setUserMagnify(2)
    setFitContext(600, 800)
    setFitContext(null)
    expect(getMagnify()).toBe(2)
    setFitContext(600, 0)
    expect(getMagnify()).toBe(2)
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
    setFitContext(600, 800) // cap binds → effective changes
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
    expect(unscale(10, 0.1)).toBeCloseTo(100, 6) // stays exact at deep zoom-out
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
