// THE LIVE-VIEW ZOOM GEOMETRY, KEPT IN THE GATE.
//
// `prove:reader` measures the painted pixels in a real browser and is the truth; it is not a guard
// (CLAUDE.md: a proof that ran once is indistinguishable, six weeks later, from one that never ran,
// and the gate says green either way). This runs in ~10ms with no browser.
import { describe, it, expect } from 'vitest'
import {
  clampLiveZoom, liveFrameGeom, liveZoomStep, LIVE_ZOOM_MAX, LIVE_ZOOM_MIN, panAfterZoom,
  viewportWidthFor, ZOOM_STEP_FACTOR,
} from './liveFrameZoom'

const HOST = { hostW: 800, hostH: 600 }

describe('the zoom floor is 1 — the page may never be narrower than the panel', () => {
  // The PDF's `minUserZoom` argument, in a pane where it collapses to a constant. Zooming out below
  // fit is the "no man's land of empty background" Peter reported there, reachable in one gesture
  // and then PERSISTED for every source for ever.
  it('refuses a value below fit, at the VALUE not at the render', () => {
    expect(clampLiveZoom(0.5)).toBe(1)
    expect(clampLiveZoom(0.999)).toBe(1)
    expect(liveZoomStep(1, -1)).toBe(1)
    // …so a press of − at fit changes nothing, and the very next press of + must still move.
    expect(liveZoomStep(liveZoomStep(1, -1), 1)).toBeCloseTo(ZOOM_STEP_FACTOR, 10)
  })
  it('at the floor the page fills the host exactly and nothing is pannable', () => {
    for (const pageWidth of ['auto', 'narrow', 'wide'] as const) {
      const g = liveFrameGeom({ ...HOST, pageWidth, zoom: 1 })
      expect(g.paintedW, pageWidth).toBeCloseTo(HOST.hostW, 6)
      expect(g.paintedH, pageWidth).toBeCloseTo(HOST.hostH, 6)
      expect(g.pannable, pageWidth).toBe(false)
    }
  })
  it('clamps the ceiling and survives rubbish', () => {
    expect(clampLiveZoom(99)).toBe(LIVE_ZOOM_MAX)
    // A non-finite value is nonsense, not "as big as possible": a corrupt localStorage entry must
    // return the writer to fit, not pin them at 4×.
    expect(clampLiveZoom(NaN)).toBe(1)
    expect(clampLiveZoom(Infinity)).toBe(1)
    expect(LIVE_ZOOM_MIN).toBe(1)
  })
})

describe('one scale, never two', () => {
  // Two independent transforms on one element is how the page-width fit and the user zoom start
  // disagreeing about where the page is.
  it('the total scale is the page-width base TIMES the zoom', () => {
    // narrow: the site lays out at 520 and is scaled to fill 800 → base 800/520.
    const base = liveFrameGeom({ ...HOST, pageWidth: 'narrow', zoom: 1 }).scale
    expect(base).toBeCloseTo(800 / 520, 10)
    for (const z of [1, 1.15, 2, 3.7]) {
      expect(liveFrameGeom({ ...HOST, pageWidth: 'narrow', zoom: z }).scale).toBeCloseTo(base * z, 10)
    }
  })
  it('the CSS viewport is what the SITE lays out for, and zoom does not change it', () => {
    expect(viewportWidthFor('narrow', 800)).toBe(520)
    expect(viewportWidthFor('wide', 800)).toBe(1400)
    expect(viewportWidthFor('auto', 800)).toBe(800)
    // Zoom is MAGNIFICATION of the chosen layout, not a re-layout — otherwise it would silently do
    // `pageWidth`'s job and the two controls would fight.
    for (const z of [1, 2, 3]) {
      expect(liveFrameGeom({ ...HOST, pageWidth: 'wide', zoom: z }).w).toBe(1400)
    }
  })
})

describe('the painted box is what the host must scroll over', () => {
  it('grows horizontally with zoom and becomes pannable', () => {
    const g = liveFrameGeom({ ...HOST, pageWidth: 'auto', zoom: 2 })
    expect(g.paintedW).toBeCloseTo(1600, 6)
    expect(g.pannable).toBe(true)
  })
  it('NEVER grows vertically — the frame always fills the host, so the SITE keeps its own scroll', () => {
    // A taller-than-host frame would put a second vertical scrollbar around the site's own, and
    // a site's fixed header would scroll off the top of a viewport it thinks it still owns.
    for (const z of [1, 1.5, 2, 4]) {
      const g = liveFrameGeom({ ...HOST, pageWidth: 'auto', zoom: z })
      expect(g.paintedH, `zoom ${z}`).toBeCloseTo(HOST.hostH, 6)
      // …which it achieves by SHORTENING the CSS viewport, not by overflowing.
      expect(g.h * g.scale, `zoom ${z}`).toBeCloseTo(HOST.hostH, 6)
    }
  })
  it('a hair of floating-point overflow does not paint a scrollbar over a page that fits', () => {
    const g = liveFrameGeom({ hostW: 900.0000001, hostH: 600, pageWidth: 'wide', zoom: 1 })
    expect(g.pannable).toBe(false)
  })
  it('an unmeasured host falls back rather than dividing by zero', () => {
    const g = liveFrameGeom({ hostW: 0, hostH: 0, pageWidth: 'narrow', zoom: 1 })
    expect(Number.isFinite(g.scale)).toBe(true)
    expect(g.scale).toBeGreaterThan(0)
    expect(Number.isFinite(g.paintedW)).toBe(true)
  })
})

describe('the pan holds the middle of the view across a zoom step', () => {
  it('what was under the centre stays under the centre', () => {
    // Host 800 wide, painted 1600, scrolled to 400 ⇒ content x 800 is centred. Zoom ×2 ⇒ that
    // content is now at 1600, so scrollLeft must be 1600 − 400 = 1200.
    expect(panAfterZoom(400, 800, 2, 10_000)).toBeCloseTo(1200, 6)
  })
  it('clamps to the new range rather than leaving the page off screen', () => {
    expect(panAfterZoom(400, 800, 2, 500)).toBe(500)
    expect(panAfterZoom(0, 800, 0.5, 10_000)).toBe(0)   // never negative
  })
  it('a nonsense ratio leaves the pan alone rather than teleporting it', () => {
    expect(panAfterZoom(400, 800, 0, 10_000)).toBe(400)
    expect(panAfterZoom(400, 800, NaN, 10_000)).toBe(400)
  })
})
