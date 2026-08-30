// ZOOM AND PAN FOR A PAGE WE ARE NOT ALLOWED TO TOUCH — the live (`<iframe>`) view of the source
// reader. Peter, 2026-08-30: "need zoom and left right two finger scroll to work on the windowed
// browser."
//
// ⚠ THE CONSTRAINT IS THE DESIGN, and it was MEASURED before a line was written (chromium, a real
// cross-origin frame inside a real `overflow-x: auto` host):
//
//     gesture over the frame        host scroller      our wheel handler
//     horizontal two-finger         scrolled 360px     0 calls
//     vertical                      frame keeps it     0 calls
//     ctrl+wheel (a trackpad pinch) —                  0 calls
//     …with pointer-events:none     —                  1 call
//
// So: a wheel over a cross-origin frame is delivered to THAT document and never surfaces here. No
// listener we install can see it, and `preventDefault` is not available to us — that is a browser
// boundary, not something to route around. Two consequences, both load-bearing:
//   • PANNING NEEDS NO JAVASCRIPT. The browser's own scroll CHAINING carries a horizontal gesture
//     out of the frame into the nearest scrollable ancestor once the frame has no horizontal scroll
//     of its own — which is exactly the case, because we hand the site a viewport it fits. Make the
//     host a horizontal scroller and Peter's two-finger pan works natively.
//   • ZOOM CANNOT BE A GESTURE HERE. ⌘/ctrl+wheel is invisible to us, and the only way to see it
//     would be `pointer-events: none` on the frame — which also kills every click, i.e. it stops
//     being a browser. So zoom is BUTTONS, and the reader's ⌘-wheel curve is deliberately NOT wired
//     to this pane rather than wired to something that can never fire.
//
// Everything here is pure so the geometry can be pinned without a browser.

/** One −/+ press, shared by both of this panel's zooms so they cannot drift apart. */
export const ZOOM_STEP_FACTOR = 1.15

/**
 * ⚠ THE FLOOR IS 1, AND IT IS THE PDF's `minUserZoom` ARGUMENT IN A PANE WHERE IT COLLAPSES TO A
 * CONSTANT. There, the floor is "the zoom at which the page still fills the panel's width" and has
 * to be computed from the pane. Here the BASE scale already makes the frame exactly fill the host
 * (that is what `pageWidth` does), so `zoom < 1` means precisely "leave a strip of dead background
 * either side" — the no-man's-land Peter reported on the PDF, reachable in one gesture and then
 * PERSISTED for every source for ever. Zooming out below fit buys nothing a narrower `pageWidth`
 * does not do better, so it is refused at the VALUE, not at the render: clamping only the render
 * leaves the number below the floor and the first presses back in change nothing on screen, which
 * is "zoom does nothing" reintroduced one layer down.
 */
export const LIVE_ZOOM_MIN = 1
export const LIVE_ZOOM_MAX = 4

export function clampLiveZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(LIVE_ZOOM_MAX, Math.max(LIVE_ZOOM_MIN, z))
}

export function liveZoomStep(z: number, dir: 1 | -1): number {
  return clampLiveZoom(z * (dir === 1 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR))
}

export type PageWidth = 'auto' | 'narrow' | 'wide'

/** The CSS viewport width we hand the site — i.e. the layout it will choose for itself. */
export function viewportWidthFor(pageWidth: PageWidth, hostW: number): number {
  if (pageWidth === 'narrow') return 520
  if (pageWidth === 'wide') return 1400
  return hostW
}

export interface FrameGeom {
  /** The iframe element's own CSS width — the viewport the site lays out for. */
  w: number
  /** …and its CSS height. Chosen so the PAINTED height is exactly the host's: the frame always
   *  fills the host vertically, so vertical scrolling stays the site's own and never becomes a
   *  second scrollbar wrapped round the first. */
  h: number
  /** The total transform applied to that box — the page-width base scale TIMES the user's zoom.
   *  ONE scale, never two: a second independent transform on the same element is how the fit and
   *  the zoom start disagreeing about where the page is. */
  scale: number
  /** Painted size = what the host must be able to scroll over. A transform does not change layout,
   *  so the host is given a spacer of exactly this size and the frame is drawn inside it. */
  paintedW: number
  paintedH: number
  /** True once the painted page is wider than the host — the only state in which panning means
   *  anything, and the only state in which the host may show a horizontal scrollbar. */
  pannable: boolean
}

/**
 * `hostW`/`hostH` are the host's client box. `zoom` is the writer's multiplier on top of the
 * page-width fit. Falls back to a plausible box before the ResizeObserver has measured, so the
 * first paint is never a division by zero.
 */
export function liveFrameGeom(opts: {
  hostW: number
  hostH: number
  pageWidth: PageWidth
  zoom: number
}): FrameGeom {
  const hostW = opts.hostW > 0 ? opts.hostW : 900
  const hostH = opts.hostH > 0 ? opts.hostH : 600
  const vw = viewportWidthFor(opts.pageWidth, hostW)
  const base = vw > 0 ? hostW / vw : 1
  const scale = base * clampLiveZoom(opts.zoom)
  const w = vw
  const h = scale > 0 ? hostH / scale : hostH
  const paintedW = w * scale
  const paintedH = hostH
  // Sub-pixel: a fit that lands at 900.0000001 must not paint a scrollbar over a page that fits.
  return { w, h, scale, paintedW, paintedH, pannable: paintedW - hostW > 1 }
}

/**
 * Keep the middle of the view still across a zoom step.
 *
 * ⚠ THIS IS THE SIMPLE FORM ON PURPOSE, AND THE PDF'S ZOOM-ANCHOR BUG IS WHY IT IS ALLOWED TO BE.
 * There the arithmetic scaled a scroller padding and a 180px overscroll gutter as though they were
 * content, and the error was independent of the cursor (`pdfZoomAnchor.test.ts`). Here the host has
 * NO padding, NO gutter and the content starts at scroll origin 0, so `scrollLeft` and content x
 * are the same number and the ratio applies cleanly. If this host ever gains padding or a gutter,
 * this function is wrong and must move to the page-box-fraction rule the PDF uses.
 */
export function panAfterZoom(scrollLeft: number, hostW: number, ratio: number, maxScroll: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return scrollLeft
  const centre = scrollLeft + hostW / 2
  return Math.max(0, Math.min(maxScroll, centre * ratio - hostW / 2))
}
