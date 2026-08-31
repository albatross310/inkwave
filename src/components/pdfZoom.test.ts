import { describe, it, expect } from 'vitest'
import { pdfZoomFactor } from './zoomGesture'

describe('pdfZoomFactor', () => {
  it('THE MOUSE IS UNCHANGED — a 120px notch still zooms exactly 10%', () => {
    // The clamp exists precisely so this fix cannot alter the path nobody complained about.
    expect(pdfZoomFactor(-120)).toBeCloseTo(1.1, 6)
    expect(pdfZoomFactor(120)).toBeCloseTo(0.9, 6)
  })

  it('a trackpad’s tiny deltas take small bites — the complaint', () => {
    // A pinch streams ~60 events/second. Each used to take a FULL 10%; now it is proportional.
    // The bound tracks PDF_ZOOM_K, which Peter has moved once already ("a tad faster, maybe 75%") —
    // so this asserts the PROPERTY (a fingertip is a fraction of a notch), not the constant.
    expect(pdfZoomFactor(-4)).toBeLessThan(1.03)
    expect(pdfZoomFactor(-4)).toBeGreaterThan(1.0)
    expect(pdfZoomFactor(4)).toBeGreaterThan(0.97)
    expect(pdfZoomFactor(4)).toBeLessThan(1.0)
    // The real invariant: one fingertip event must never be worth a whole mouse notch.
    expect(pdfZoomFactor(-4) - 1).toBeLessThan((pdfZoomFactor(-120) - 1) / 3)
  })

  it('KNOWN-NEGATIVE: the old rule took the same bite whatever the delta', () => {
    const legacy = (d: number) => (d < 0 ? 1.1 : 0.9)
    expect(legacy(-4)).toBeCloseTo(1.1, 6)          // a fingertip, treated as a full notch
    expect(legacy(-120)).toBeCloseTo(1.1, 6)
  })

  it('a whole pinch of small events is far gentler than it was', () => {
    // 30 events of deltaY -4: was 1.1^30 ≈ 17×. Now under 2×, i.e. an order of magnitude gentler.
    const now = Array.from({ length: 30 }).reduce<number>((z) => z * pdfZoomFactor(-4), 1)
    expect(now).toBeLessThan(2)
    expect(1.1 ** 30).toBeGreaterThan(15)
    expect(now).toBeLessThan((1.1 ** 30) / 8)
  })

  it('direction is preserved and a zero delta does nothing', () => {
    expect(pdfZoomFactor(-1)).toBeGreaterThan(1)
    expect(pdfZoomFactor(1)).toBeLessThan(1)
    expect(pdfZoomFactor(0)).toBe(1)
    expect(pdfZoomFactor(NaN)).toBe(1)
  })
})
