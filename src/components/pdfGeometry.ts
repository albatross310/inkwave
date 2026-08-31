// PDF GEOMETRY — the zoom, fit and anchor arithmetic, as pure functions.
//
// Extracted from PdfViewer.tsx, verbatim. Everything here is arithmetic over numbers: no React, no
// pdf.js, no DOM (the two `legacy*` probe switches read a `window` flag behind a typeof guard and
// are the only exception — they live here because a rule and its known-negative must not drift
// apart, which is the whole reason the probe can reproduce the bug in the same build).
//
// WHY IT IS ITS OWN FILE. Four test files — pdfZoomAnchor, pdfFit, pdfOutputScale, pdfZoom — existed
// to pin ~30ms of arithmetic and had to import a 2,700-line React component to reach it, dragging
// pdf.js, uuid and the citation store into their module graph. That is the countWords lesson from
// CLAUDE.md in a second place: the cheap guard should not have to load the expensive thing it guards.
//
// NOTHING HERE MAY GROW A DEPENDENCY. If a function in this file ever needs a ref, a DOM node or a
// pdf.js page, it belongs in the component, not here.


/**
 * How many device pixels per CSS pixel to render a PDF page at.
 * FLOOR of 2× regardless of what the display reports — supersampling is what keeps glyphs crisp on
 * a 1× screen, and it is also what makes the viewer immune to browser zoom (Chrome folds zoom into
 * devicePixelRatio, so a window at 67% reports ~1.33 and used to render that soft). Ceilings are
 * unchanged: 3× desktop / 2× touch (iOS's total canvas memory is the scarce resource), and never
 * more than `maxCanvas` px on a side.
 */
export function pdfOutputScale(dpr: number, isTouch: boolean, vw: number, vh: number, maxCanvas = 4096): number {
  const want = Math.max(2, Number.isFinite(dpr) && dpr > 0 ? dpr : 1)
  const ceiling = isTouch ? 2 : 3
  const byMemory = Math.min(vw > 0 ? maxCanvas / vw : Infinity, vh > 0 ? maxCanvas / vh : Infinity)
  return Math.max(1, Math.min(want, ceiling, byMemory))
}

export const ZOOM_MIN = 0.4, ZOOM_MAX = 4

// ── Fit-to-text-width (Peter, 2026-07-10) ────────────────────────────────────────────────────────
// The DEFAULT zoom puts the TEXT's left/right margins at the panel edges (small safety inset), not
// the page's. Extents come from getTextContent — the same items the text layer renders from — so no
// render pass is needed before the fit is known. Pages with no text layer (scans) or an implausibly
// narrow bbox (a lone page number would explode the zoom) return null → caller falls back to
// page-width fit.
export const TEXT_FIT_INSET = 10 // px of safety either side so glyphs never kiss the panel edge

/**
 * FIT THE TEXT TO THE WINDOW — the scale at which the page's TEXT BLOCK spans the panel, with a
 * safety inset so glyphs never kiss the edge. Clamped to [page-fit … 2×page-fit] so a stray text
 * bbox can neither zoom out below whole-page fit nor crop wildly; no text layer ⇒ page fit.
 * ONE definition, used by the initial load, the resize re-fit and the ⤢ button — three places that
 * must agree about what "flush" means or the button would land somewhere the resize then moved.
 */
export function computeTextFit(
  inputs: { pageW: number; ext: { x0: number; x1: number } | null } | null,
  clientWidth: number,
  fallback: number,
  /** Space reserved to the right for notes — the page must fit BESIDE it, not behind it. */
  reservedRight = 0,
): number {
  if (!inputs) return fallback
  const containerW = clientWidth - 24 - reservedRight
  const pageFit = Math.max(ZOOM_MIN, Math.min(3, containerW / inputs.pageW))
  if (!inputs.ext) return pageFit
  const w = inputs.ext.x1 - inputs.ext.x0
  if (!(w > 0)) return pageFit
  return Math.max(pageFit, Math.min(3, 2 * pageFit, (containerW - 2 * TEXT_FIT_INSET) / w))
}

/**
 * THE SMALLEST ZOOM WORTH ALLOWING — the one at which the page still fills the panel's width.
 *
 * ⚠ MEASURED, 2026-08-30 (Peter: "PDFs no longer change size, and there's a no man's land space of
 * empty background between the page and left side — page is a bit narrower than web page viewer").
 * `zoom` is a MULTIPLIER on the fit baseline and it is PERSISTED, so one ctrl+wheel — a trackpad
 * pinch will do it — leaves a value like 0.6 in localStorage for every PDF, for ever. At 1440px in
 * a right-hand dock that renders the page 503px wide inside a 719px pane: a 108px strip of dead
 * background either side, and the page narrower than the source reader's 655px column beside it.
 * `computeTextFit` already refuses to go below whole-page fit (`Math.max(pageFit, …)`); the user
 * multiplier was the one path around that floor. This closes it.
 *
 * Zooming OUT still runs the whole useful range — text-flush down to page-flush, ~0.76× here — it
 * simply stops where the page stops filling the width. The floor is a function of the PANE, so it
 * moves with the window; that is why it is computed rather than a constant, and why it can never
 * exceed 1 (the fit baseline is itself ≥ page fit).
 *
 * It clamps the ZOOM VALUE, not the render: clamping only the render would leave `zoom` sitting
 * below the floor, so the first few notches back IN would change nothing on screen — "zoom does
 * nothing", which is the complaint this exists to fix, reintroduced one layer down.
 */
export function minUserZoom(
  fit: number,
  pageW: number,
  clientWidth: number,
  reservedRight = 0,
): number {
  if (!(fit > 0) || !(pageW > 0) || !(clientWidth > 0)) return ZOOM_MIN
  const containerW = clientWidth - 24 - reservedRight
  if (!(containerW > 0)) return ZOOM_MIN
  return Math.min(1, containerW / (pageW * fit))
}

// The zoom-anchor known-negative. `window.__iwPdfZoomAnchor = 'legacy'` restores the pre-2026-08-30
// rule — the proportional scroll formula AND the live-zoom overscroll gutter — so
// scripts/pdfzoom-probe/zoomanchor.prove.mjs can reproduce Peter's snap-back in the SAME build it
// verifies the fix in. It exists FOR that probe; if the probe goes, this goes.
export const legacyZoomAnchor = (): boolean =>
  typeof window !== 'undefined' && (window as { __iwPdfZoomAnchor?: string }).__iwPdfZoomAnchor === 'legacy'

// The FIT known-negative, same contract as the one above. `window.__iwPdfFitRule = 'legacy'`
// restores BOTH halves of the pre-2026-08-30 behaviour — a manual zoom skips every re-fit, and
// there is no pane-derived zoom floor — so scripts/pdfzoom-probe/geom.prove.mjs can reproduce
// Peter's "PDFs no longer change size / no man's land of empty background" in the SAME build it
// verifies the fix in. It exists FOR that probe; if the probe goes, this goes.
export const legacyFitRule = (): boolean =>
  typeof window !== 'undefined' && (window as { __iwPdfFitRule?: string }).__iwPdfFitRule === 'legacy'

// ── ZOOM ANCHORING: the two rules, as pure functions, so the gate can keep them apart ────────────
// A browser probe proves this once; a unit test keeps it true. See pdfZoomAnchor.test.ts.
export interface AnchorBox { left: number; top: number; width: number; height: number }

/** Where the cursor sits inside its page, as a fraction of that page's box. */
export function anchorFraction(page: AnchorBox, cursor: { x: number; y: number }): { x: number; y: number } {
  return {
    x: page.width ? (cursor.x - page.left) / page.width : 0,
    y: page.height ? (cursor.y - page.top) / page.height : 0,
  }
}

/**
 * THE SHIPPED RULE. How far to scroll so that the same fraction of the same page is back under the
 * cursor — a DELTA read off the page's real box after the re-render. Constants in the layout
 * (scroller padding, page margins, the overscroll gutter) cancel, because they are already inside
 * `page.left`; nothing here can mis-scale them.
 */
export function anchorScrollDelta(page: AnchorBox, f: { x: number; y: number }, cursor: { x: number; y: number }): { dx: number; dy: number } {
  return {
    dx: (page.left + f.x * page.width) - cursor.x,
    dy: (page.top + f.y * page.height) - cursor.y,
  }
}

/**
 * THE PRE-2026-08-30 RULE, kept as the known-negative. "Every offset scales with the zoom" — which
 * is false for every constant in the layout, and is what put the words in the wrong place.
 */
export function proportionalAnchorScroll(scroll: number, axis: number, ratio: number): number {
  return Math.max(0, (scroll + axis) * ratio - axis)
}

// ⚠ THE FIT RULE HAS ONE MORE CALLER THAN ITS DOCSTRING CLAIMS. `computeTextFit` says "ONE
// definition, used by the initial load, the resize re-fit and the ⤤ button" — but the initial load
// (the `[data, citekey]` effect) still computes `pageFit` and the text fit inline, and its
// `containerW` omits `reservedRight`. So a PDF opened with the comment margin ON is fitted wide and
// then re-fitted by the `[commentMargin, status]` effect once status is 'ready'. Consolidating the
// two would CHANGE that first paint, so it is named here rather than done quietly.
