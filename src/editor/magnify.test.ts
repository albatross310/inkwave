import { describe, it, expect, beforeEach } from 'vitest'
import {
  advanceUserMagnify, getMagnify, getUserMagnify, setUserMagnify, restoreUserMagnify, setFitContext, subscribe, scaleFor, unscale,
  fitAvailableWidth, fitScaleForWidth, magneticDetentLog, magneticZoomScale, magnifyTrackForScale,
  centredMagnifyScrollLeft, magneticMagnifySnapTarget, magnifyDetentScales, magnifyHorizontalFocus,
  MIN_MAGNIFY, MAX_MAGNIFY, WATER_MARGIN_PX, PAGE_EDGE_SNAP_OUTSET, TEXT_EDGE_SNAP_OUTSET,
} from './magnify'

// Module is a singleton — put it back to a known state before each test.
beforeEach(() => {
  setFitContext(null)
  setUserMagnify(1)
})

describe('user magnify safety bounds', () => {
  it('distinguishes remembered pose restoration from gesture input, including an unchanged scale', () => {
    const changes: string[] = []
    const off = subscribe((change) => changes.push(change))
    setUserMagnify(1.27)
    restoreUserMagnify(1.27)
    restoreUserMagnify(0.93)
    off()
    expect(changes).toEqual(['input', 'restore', 'restore'])
    expect(getMagnify()).toBe(0.93)
  })
  it('keeps only distant numerical guards, not a page/text-edge UX bound', () => {
    expect(MIN_MAGNIFY).toBe(0.02) // degenerate-maths guard only, not a UX floor
    expect(setUserMagnify(0.005)).toBe(MIN_MAGNIFY)
    expect(getUserMagnify()).toBe(MIN_MAGNIFY)
    expect(MAX_MAGNIFY).toBeGreaterThan(10)
    expect(setUserMagnify(1000)).toBe(MAX_MAGNIFY)
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

describe('responsive fit and magnetic page/text-edge detents', () => {
  it('counts existing surface padding as the water margin exactly once', () => {
    expect(fitAvailableWidth(1440, 16, 16)).toBe(1408)
    expect(fitAvailableWidth(720, 4, 8)).toBe(696)
    expect(fitAvailableWidth(1427, 16, 16, 13)).toBe(1382)
    expect(fitAvailableWidth(20, 16, 16)).toBe(60)
  })

  it('shares the continuous fixed-layout fit ratio with application surfaces', () => {
    expect(fitScaleForWidth(600, 800)).toBe(0.75)
    expect(fitScaleForWidth(400, 800)).toBe(0.5)
    expect(fitScaleForWidth(1, 800)).toBe(MIN_MAGNIFY)
  })

  it('keeps track 1 at fit-to-width on a narrow window', () => {
    expect(magneticZoomScale(1, 0.75, 1)).toBeCloseTo(0.75, 4)
  })

  it('passes beyond both paper and text bounds instead of sticking', () => {
    setFitContext(600, 800, 600) // paper fit .75; text fit 1
    expect(getMagnify()).toBeCloseTo(0.75, 4)
    for (let index = 0; index < 24; index++) advanceUserMagnify(1.08)
    expect(getMagnify()).toBeGreaterThan(1 * TEXT_EDGE_SNAP_OUTSET)
  })

  it('is monotone across both detents and contains only their narrow plateaus', () => {
    const values = Array.from({ length: 241 }, (_, index) =>
      magneticZoomScale(Math.exp(-1.2 + index * 0.01), 0.75, 1),
    )
    for (let index = 1; index < values.length; index++) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1])
    }
  })

  it('has exact forward/reverse correspondence', () => {
    for (const scale of [0.2, 0.75, 0.9, 1, 1.2, 2.5, 8]) {
      const track = magnifyTrackForScale(scale, 0.75, 1)
      expect(magneticZoomScale(track, 0.75, 1)).toBeCloseTo(scale, 3)
    }
  })

  it('attracts symmetrically into a true centre plateau, then returns to ordinary speed', () => {
    const centre = Math.log(0.75 * PAGE_EDGE_SNAP_OUTSET)
    const width = Math.log(1.085)
    const h = 0.002
    expect(magneticDetentLog(centre - width / 2, centre, width)).toBeGreaterThan(centre - width / 2)
    expect(magneticDetentLog(centre + width / 2, centre, width)).toBeLessThan(centre + width / 2)
    expect(Math.abs(magneticDetentLog(centre + width * 0.7, centre, width) - centre)).toBeLessThan(width * 0.7)
    const approach = magneticDetentLog(centre - width * 0.7 + h, centre, width)
      - magneticDetentLog(centre - width * 0.7, centre, width)
    const atSnap = magneticDetentLog(centre + h, centre, width)
      - magneticDetentLog(centre, centre, width)
    const farAfter = magneticDetentLog(centre + width * 1.2 + h, centre, width)
      - magneticDetentLog(centre + width * 1.2, centre, width)
    expect(approach).toBeGreaterThan(h)
    expect(atSnap).toBe(0)
    expect(magneticDetentLog(centre - h, centre, width)).toBe(centre)
    expect(farAfter).toBeCloseTo(h, 8)
  })

  it('offers exact release snaps in broad non-overlapping neighbourhoods around both detents', () => {
    const page = 0.75 * PAGE_EDGE_SNAP_OUTSET
    const text = 1 * TEXT_EDGE_SNAP_OUTSET
    expect(magneticMagnifySnapTarget(page * 0.97, 0.75, 1)).toBeCloseTo(page, 8)
    expect(magneticMagnifySnapTarget(page * 1.03, 0.75, 1)).toBeCloseTo(page, 8)
    expect(magneticMagnifySnapTarget(text * 0.97, 0.75, 1)).toBeCloseTo(text, 8)
    expect(magneticMagnifySnapTarget(text * 1.03, 0.75, 1)).toBeCloseTo(text, 8)
    expect(magneticMagnifySnapTarget(page * 0.82, 0.75, 1)).toBeNull()
    expect(magneticMagnifySnapTarget(Math.sqrt(page * text), 0.75, 1)).toBeNull()
  })

  it('stays centred until the inner well, then switches to cursor focus', () => {
    const detents = magnifyDetentScales(0.75, 1)
    expect(detents.page).toBeCloseTo(0.75 * PAGE_EDGE_SNAP_OUTSET, 8)
    expect(detents.text).toBeCloseTo(TEXT_EDGE_SNAP_OUTSET, 8)
    expect(magnifyHorizontalFocus(detents.page!, detents.page, detents.text)).toBe(0)
    expect(magnifyHorizontalFocus(Math.sqrt(detents.page! * detents.text!), detents.page, detents.text)).toBe(0)
    expect(magnifyHorizontalFocus(detents.text!, detents.page, detents.text)).toBe(1)
    expect(magnifyHorizontalFocus(detents.text! * 2, detents.page, detents.text)).toBe(1)
  })

  it('centres the page after auto margins stop working at the fit boundary', () => {
    expect(centredMagnifyScrollLeft(0.75, 800, 600)).toBe(0)
    expect(centredMagnifyScrollLeft(1, 800, 600)).toBe(100)
    expect(centredMagnifyScrollLeft(2, 800, 600)).toBe(500)
    expect(centredMagnifyScrollLeft(2, 800, 0)).toBe(0)
  })

  it('shrinking and widening the window moves an untouched responsive baseline', () => {
    setFitContext(600, 800, 600)
    expect(getMagnify()).toBeCloseTo(0.75, 4)
    setFitContext(400, 800, 600)
    expect(getMagnify()).toBeCloseTo(0.5, 4)
    setFitContext(1200, 800, 600)
    expect(getMagnify()).toBeCloseTo(1, 4)
  })

  it('null / bad page width releases the responsive mapping', () => {
    setUserMagnify(2)
    setFitContext(600, 800, 600)
    setFitContext(null)
    expect(getMagnify()).toBeGreaterThan(1)
    setFitContext(600, 0)
    expect(getMagnify()).toBeGreaterThan(1)
  })

  it('keeps the shared fit boundary and two small outside snap offsets', () => {
    expect(WATER_MARGIN_PX).toBe(12)
    expect(PAGE_EDGE_SNAP_OUTSET).toBeGreaterThan(1)
    expect(TEXT_EDGE_SNAP_OUTSET).toBeGreaterThan(1)
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
    setFitContext(600, 800, 600) // responsive mapping changes → effective changes
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
