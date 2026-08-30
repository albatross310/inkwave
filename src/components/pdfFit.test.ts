// THE PDF PAGE MUST FILL ITS PANEL — the cheap guard that KEEPS what geom.prove.mjs established.
//
// Peter, 2026-08-30: "PDFs no longer change size, and there's a no man's land space of empty
// background between the page and left side — page is a bit narrower than web page viewer."
// (Feature: the PDF reading panel. LIVE, no flag.) The browser probe
// `scripts/pdfzoom-probe/geom.prove.mjs` is the in-browser truth; this is the ~1ms, no-browser
// version, because a proof that ran once is indistinguishable six weeks later from one that never
// ran and the gate says green either way.
//
// `computeTextFit` already refuses to go below whole-page fit. The PERSISTED USER ZOOM was the one
// path around that floor, and `minUserZoom` is what closes it.
import { describe, it, expect } from 'vitest'
import { computeTextFit, minUserZoom } from './PdfViewer'

// The real numbers off Peter's 1440px window with the panel docked right: a 719px scroller, a US
// Letter page (612pt), a text block from 72 to 540.
const PANE = 719
const PAGE_W = 612
const INPUTS = { pageW: PAGE_W, ext: { x0: 72, x1: 540 } }
/** What the pane actually renders: the fit baseline times the reader's zoom. */
const rendered = (pane: number, zoom: number, reserved = 0) => {
  const fit = computeTextFit(INPUTS, pane, 1, reserved)
  const z = Math.max(zoom, minUserZoom(fit, PAGE_W, pane, reserved))
  return { fit, z, pageW: PAGE_W * fit * z, containerW: pane - 24 - reserved }
}

describe('minUserZoom — the page may not be narrower than the panel', () => {
  it('THE BUG: a persisted 0.6 left a wide strip of dead background either side', () => {
    // In the real app, on the probe's fixture PDF, this was measured as a 503px page in a 719px
    // pane — 108px of background to the left of the page. The arithmetic here uses a nominal text
    // block rather than that file's, so it pins the PROPERTY, not that one file's number.
    const fit = computeTextFit(INPUTS, PANE, 1)
    expect(PAGE_W * fit * 0.6).toBeLessThan(PANE - 24 - 150) // >75px of dead background per side
  })

  it('the floor stops exactly at whole-page fit — never wider, never narrower', () => {
    const r = rendered(PANE, 0.6)
    expect(r.pageW).toBeCloseTo(r.containerW, 6)
  })

  it('it moves with the pane, so the page fills every width', () => {
    for (const pane of [340, 420, 570, 719, 900, 1200]) {
      const r = rendered(pane, 0.4)
      expect(r.pageW).toBeCloseTo(r.containerW, 6)
    }
  })

  it('STATED CEILING: past computeTextFit’s own 3× cap the page cannot fill the pane', () => {
    // Pre-existing and NOT this rule's doing — `computeTextFit` clamps every branch to 3, so above
    // a ~1860px container a Letter page simply has no more scale to give. `minUserZoom` correctly
    // answers 1 (it can never ask for more than the fit's own ceiling) and the residual strip is
    // 40px at 1900, not the ~200px Peter reported. Pinned so a future cap change is a DECISION.
    const pane = 1900
    const r = rendered(pane, 0.4)
    expect(r.fit).toBe(3)
    expect(r.z).toBe(1)
    expect(r.containerW - r.pageW).toBeCloseTo(40, 0)
  })

  it('zooming OUT still has real range: text-flush all the way down to page-flush', () => {
    const floor = minUserZoom(computeTextFit(INPUTS, PANE, 1), PAGE_W, PANE)
    expect(floor).toBeLessThan(0.8)   // a useful range, not a floor pinned at 1
    expect(floor).toBeGreaterThan(0.7)
    // …and it is exactly the ratio page-fit : text-fit, which is what "stop at page-flush" means.
    const fit = computeTextFit(INPUTS, PANE, 1)
    expect(floor).toBeCloseTo(((PANE - 24) / PAGE_W) / fit, 10)
  })

  it('a zoom the reader chose ABOVE the floor is untouched', () => {
    expect(rendered(PANE, 1).z).toBe(1)
    expect(rendered(PANE, 2.5).z).toBe(2.5)
    expect(rendered(PANE, 0.9).z).toBe(0.9)
  })

  it('the floor can never exceed 1 — the fit baseline is itself ≥ page fit', () => {
    for (const pane of [200, 340, 719, 3000]) {
      for (const ext of [null, { x0: 72, x1: 540 }, { x0: 300, x1: 320 }]) {
        const inputs = { pageW: PAGE_W, ext }
        expect(minUserZoom(computeTextFit(inputs, pane, 1), PAGE_W, pane)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('the comment margin is space the page must fit BESIDE, so it raises the floor', () => {
    const reserved = 187
    const r = rendered(PANE, 0.5, reserved)
    expect(r.pageW).toBeCloseTo(PANE - 24 - reserved, 6)
    expect(minUserZoom(computeTextFit(INPUTS, PANE, 1, reserved), PAGE_W, PANE, reserved))
      .toBeGreaterThan(minUserZoom(computeTextFit(INPUTS, PANE, 1), PAGE_W, PANE))
  })

  it('a scan with no text layer opens at page fit, where the floor is exactly 1', () => {
    const noText = { pageW: PAGE_W, ext: null }
    const fit = computeTextFit(noText, PANE, 1)
    expect(minUserZoom(fit, PAGE_W, PANE)).toBeCloseTo(1, 10)
  })

  it('degenerate inputs refuse rather than inventing a floor', () => {
    expect(minUserZoom(0, PAGE_W, PANE)).toBe(0.4)      // ZOOM_MIN — no fit yet
    expect(minUserZoom(1, 0, PANE)).toBe(0.4)           // no page dims yet (before load)
    expect(minUserZoom(1, PAGE_W, 0)).toBe(0.4)         // pane not laid out
    expect(minUserZoom(1, PAGE_W, 10)).toBe(0.4)        // container width would go negative
  })

  it('KNOWN-NEGATIVE: the old rule — a flat ZOOM_MIN — leaves the page floating', () => {
    // This is the mutant the fix exists to kill, and it must be seen to misbehave before the tests
    // above can be read as guards (a mutation that does not reproduce the bug tests nothing).
    const legacyFloor = () => 0.4
    const fit = computeTextFit(INPUTS, PANE, 1)
    const zLegacy = Math.max(0.6, legacyFloor())
    expect(PAGE_W * fit * zLegacy).toBeLessThan(PANE - 24 - 150) // ~192px of dead background
    // …and the shipped rule on the identical input does not.
    expect(rendered(PANE, 0.6).pageW).toBeCloseTo(PANE - 24, 6)
  })

  it('THE THIRD SYMPTOM: the page is not narrower than the source reader beside it', () => {
    // The reader's column is the dock minus its own `px-8` padding (32px a side); the PDF page is
    // the dock minus the scroller's 12px. Same dock, so a floored page is always the wider of the two.
    const readerColumn = PANE - 64
    expect(rendered(PANE, 0.6).pageW).toBeGreaterThan(readerColumn)
    // Before the fix it was not: 503 against 655.
    expect(PAGE_W * computeTextFit(INPUTS, PANE, 1) * 0.6).toBeLessThan(readerColumn)
  })
})
