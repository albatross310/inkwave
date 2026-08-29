// THE ⌘/CTRL-WHEEL ZOOM STEP — ONE rule, shared by both readers.
//
// It was written for the PDF viewer and lived inside it. The source reader then asked for "all the
// same zoom settings etc" (Peter, 2026-08-28), and a second copy of this curve is exactly how two
// surfaces that are supposed to feel identical stop feeling identical — the constant gets tuned on
// one and not the other, and nothing detects it. So it lives here and both import it; PdfViewer
// re-exports it so its own tests and callers are byte-unchanged.

/**
 * How much one ctrl/⌘-wheel event zooms.
 *
 * ⚠ IT USED TO IGNORE THE EVENT'S SIZE (Peter, 2026-08-28: "change the zoom sensitivity so that
 * it's much less quick. At the moment it's too sensitive to properly control"). The rule was a flat
 * ×1.1 / ×0.9 PER EVENT, which is right for a mouse — one notch, one step — and wrong for a
 * trackpad, which is where the complaint comes from: a pinch streams ~60 events a second with tiny
 * deltas, and each one took a full 10% bite, so the page shot from fit to maximum in a flick.
 * Now the step is PROPORTIONAL to the delta, which is the thing that actually distinguishes a
 * deliberate notch from a fingertip. The clamp keeps a mouse EXACTLY as it was: a 120px notch
 * saturates at 1.1/0.9, so nothing about the mouse path changes.
 */
const PDF_ZOOM_K = 0.0044 // +75% on the first cut (Peter: "a tad faster, maybe 75%")
export function pdfZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  return Math.min(1.1, Math.max(0.9, Math.exp(-deltaY * PDF_ZOOM_K)))
}
