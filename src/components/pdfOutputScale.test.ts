// KEEPS PDFS CRISP AT ANY ZOOM (2026-08-28). Peter: "is there a way for us to simply fix the PWA to
// 100% — the PDFs seem to be blurry otherwise."
//
// No page can set the browser's zoom, so "fix it to 100%" is not available. What WAS available was
// the reason the blur tracked zoom at all: Chrome folds the zoom factor into devicePixelRatio, and
// the supersample took `min(…, dpr)` — capping the canvas AT the display scale while its own
// comment claimed a ≥2× floor "so PDF text stays crisp even on 1× displays". The comment described
// a feature the code did not have.

import { describe, it, expect } from 'vitest'
import { pdfOutputScale } from './pdfGeometry'

const desktop = (dpr: number) => pdfOutputScale(dpr, false, 800, 1000)
const touch = (dpr: number) => pdfOutputScale(dpr, true, 800, 1000)

describe('pdfOutputScale', () => {
  it('THE BUG: a zoomed-out window no longer renders soft', () => {
    // Retina Mac at 67% browser zoom reports ~1.33; at 80%, 1.6.
    expect(desktop(1.33)).toBe(2)
    expect(desktop(1.6)).toBe(2)
  })

  it('KNOWN-NEGATIVE: the old expression really did drop below 2× there', () => {
    const legacy = (dpr: number) => Math.max(1, Math.min(3, dpr, 4096 / 800, 4096 / 1000))
    expect(legacy(1.33)).toBeCloseTo(1.33, 2)
    expect(legacy(1)).toBe(1)          // a 1× display got NO supersampling at all
  })

  it('honours the ≥2× floor the comment always promised', () => {
    expect(desktop(1)).toBe(2)
    expect(touch(1)).toBe(2)
  })

  it('keeps every ceiling — this must not grow canvas memory on iOS', () => {
    expect(touch(3)).toBe(2)           // iPhones report 3; still capped at 2
    expect(desktop(4)).toBe(3)
  })

  it('still bounds the canvas by its longest side', () => {
    // A page zoomed until 2× would exceed 4096px must come back down.
    expect(pdfOutputScale(2, false, 3000, 3000)).toBeCloseTo(4096 / 3000, 4)
    expect(pdfOutputScale(2, false, 3000, 3000)).toBeLessThan(2)
  })

  it('never returns a nonsense scale for a nonsense dpr', () => {
    expect(pdfOutputScale(0, false, 800, 1000)).toBe(2)
    expect(pdfOutputScale(NaN, false, 800, 1000)).toBe(2)
  })
})
