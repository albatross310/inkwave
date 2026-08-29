// THE PDF ZOOM ANCHOR — the cheap guard that KEEPS what the browser probe established.
//
// `scripts/pdfzoom-probe/zoomanchor.prove.mjs` is the in-browser truth: it drives a real ctrl+wheel
// zoom over a real PDF and measures, frame by frame, where the content under the cursor goes. It
// found that Peter's "goes towards the cursor then flashes back centrally" was NOT the clamp the
// shipped comment claimed, but a layout CONSTANT — the 180px overscroll gutter plus the scroller's
// own 12px padding — being multiplied by the zoom ratio.
//
// But a browser probe is not a guard (CLAUDE.md: "a proof that ran once and convinced everyone is
// indistinguishable, six weeks later, from a proof that never ran"). This is ~5ms, no browser, and
// it fails if anyone reintroduces the proportional rule.
//
// THE MODEL is the real horizontal layout of the PDF pane, and only the parts that matter:
//     scroller content x=0 ─┬─ 12px scroller padding
//                           ├─ G px overscroll gutter (0 at fit, 180 once zoomed) ← the CONSTANT
//                           └─ the page, W px wide, scaling with the zoom
// A point at page-local offset P sits at content-x = 12 + G + P, and paints at
// (12 + G + P) − scrollLeft. Zooming multiplies P by `ratio`; it multiplies NEITHER 12 NOR G.
import { describe, it, expect } from 'vitest'
import { anchorFraction, anchorScrollDelta, proportionalAnchorScroll } from './PdfViewer'

const SCROLLER_PAD = 12
const GUTTER = 180 // PDF_OVERSCROLL_PX
const PAGE_W = 1686
const PAGE_H = 2183

/** The pane, as a function of zoom and of whether the gutter is in. */
function layout(ratio: number, gutter: number, scrollLeft: number, scrollTop: number) {
  const width = PAGE_W * ratio, height = PAGE_H * ratio
  return {
    left: SCROLLER_PAD + gutter - scrollLeft, // viewport x of the page's left edge (scroller at x=0)
    top: SCROLLER_PAD - scrollTop,
    width, height,
  }
}

/** Where a page-local point (as a fraction) actually paints, given a layout. */
const paintedX = (l: ReturnType<typeof layout>, f: number) => l.left + f * l.width

describe('the shipped rule anchors on the page, so layout constants cancel', () => {
  it('puts the content back under the cursor across every zoom step and gutter change', () => {
    const cursor = { x: 308, y: 450 }
    let scrollLeft = 188, scrollTop = 0
    const before = layout(1, 0, scrollLeft, scrollTop)
    const f = anchorFraction(before, cursor)

    // The exact sequence the real gesture produces: the page grows AND the gutter arrives.
    for (const ratio of [1.1, 1.331, 1.771561, 2.5]) {
      const after = layout(ratio, GUTTER, scrollLeft, scrollTop)
      const d = anchorScrollDelta(after, f, cursor)
      scrollLeft += d.dx
      scrollTop += d.dy
      const settled = layout(ratio, GUTTER, scrollLeft, scrollTop)
      expect(paintedX(settled, f.x)).toBeCloseTo(cursor.x, 9)
      expect(settled.top + f.y * settled.height).toBeCloseTo(cursor.y, 9)
    }
  })

  it('is independent of where the cursor is — including the far edges of the pane', () => {
    for (const cx of [1, 120, 308, 700, 1399]) {
      const cursor = { x: cx, y: 450 }
      const before = layout(1, 0, 188, 0)
      const f = anchorFraction(before, cursor)
      const after = layout(1.771561, GUTTER, 188, 0)
      const d = anchorScrollDelta(after, f, cursor)
      const settled = layout(1.771561, GUTTER, 188 + d.dx, 0)
      expect(paintedX(settled, f.x)).toBeCloseTo(cx, 9)
    }
  })
})

describe('KNOWN-NEGATIVE: the pre-2026-08-30 proportional rule cannot do it', () => {
  // This is the whole finding. If these stop failing, the model no longer contains the constant
  // that caused the bug and the test above proves nothing.
  it('lands the content (12 + GUTTER) − 12*ratio px away from the cursor', () => {
    const cursor = { x: 308, y: 450 }
    const scrollLeft = 188
    const before = layout(1, 0, scrollLeft, 0)
    const f = anchorFraction(before, cursor)

    for (const ratio of [1.1, 1.331, 1.771561, 2.5]) {
      const settled = layout(ratio, GUTTER, proportionalAnchorScroll(scrollLeft, cursor.x, ratio), 0)
      const err = paintedX(settled, f.x) - cursor.x
      // The closed form the browser probe measured: at 1.771561 this is 170.7px, and the real pane
      // reported 170.2px.
      expect(err).toBeCloseTo(SCROLLER_PAD + GUTTER - SCROLLER_PAD * ratio, 6)
      expect(Math.abs(err)).toBeGreaterThan(100) // visible, at every step, not a rounding tail
    }
  })

  it('and the error does NOT move with the cursor — which is why it reads as "flashes back centrally"', () => {
    const errs = [120, 308, 700, 1399].map((cx) => {
      const cursor = { x: cx, y: 450 }
      const f = anchorFraction(layout(1, 0, 188, 0), cursor)
      const settled = layout(1.771561, GUTTER, proportionalAnchorScroll(188, cx, 1.771561), 0)
      return paintedX(settled, f.x) - cursor.x
    })
    for (const e of errs) expect(e).toBeCloseTo(errs[0], 6)
  })

  it('is EXACT when there is no constant to mis-scale — so the bug is the constant, not the formula', () => {
    // With zero scroller padding and no gutter, the proportional rule is right. That is what makes
    // the diagnosis specific: it is not "the old maths was wrong", it is "the layout gained a term".
    const cursor = { x: 308, y: 450 }
    const noPad = (ratio: number, sl: number) => ({ left: -sl, top: 0, width: PAGE_W * ratio, height: PAGE_H * ratio })
    const f = anchorFraction(noPad(1, 188), cursor)
    const sl2 = proportionalAnchorScroll(188, cursor.x, 1.771561)
    expect(paintedX(noPad(1.771561, sl2) as ReturnType<typeof layout>, f.x)).toBeCloseTo(cursor.x, 6)
  })
})

describe('the fraction itself', () => {
  it('degrades to 0 rather than NaN on a zero-sized page', () => {
    const f = anchorFraction({ left: 0, top: 0, width: 0, height: 0 }, { x: 10, y: 10 })
    expect(f.x).toBe(0)
    expect(f.y).toBe(0)
  })
})
