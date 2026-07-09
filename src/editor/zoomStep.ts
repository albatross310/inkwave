// ─── The ONE font-zoom step lattice (Peter's predictive step cache, 2026-07-09) ───
//
// Every font-zoom input — mouse wheel notches, trackpad fine-deltas, phone pinch — quantizes onto
// the same geometric lattice: zoom = 1.08^step, step an integer in [STEP_MIN, STEP_MAX]. Inputs
// ACCUMULATE fractionally and COMMIT whole steps (Scroll.tsx), so the editor only ever renders
// lattice zoom values. That is what makes zoom levels cacheable points: PaginationExtension
// precomputes the page-band geometry for the steps around the current one while idle, and applies
// the cached geometry the instant a gesture commits a step — the pages track the zoom live instead
// of waiting for the settle.
//
// The lattice replaces the old multiplicative drift (zoom' = clamp(zoom·1.08^n) from an arbitrary
// float) — same 8%-per-notch feel, but every reachable level is one of the 18 lattice points.

export const ZOOM_STEP_RATIO = 1.08
// Lattice bounds inside the historical clamp [0.6, 2.5]: 1.08⁻⁶ ≈ 0.630 … 1.08¹¹ ≈ 2.332.
export const ZOOM_STEP_MIN = -6
export const ZOOM_STEP_MAX = 11

export function clampStep(k: number): number {
  return Math.max(ZOOM_STEP_MIN, Math.min(ZOOM_STEP_MAX, Math.round(k)))
}

/** The lattice zoom value for a step — the ONLY producer of --iw-editor-zoom values. */
export function stepToZoom(k: number): number {
  return +Math.pow(ZOOM_STEP_RATIO, clampStep(k)).toFixed(4)
}

/** Nearest lattice step for an arbitrary zoom (legacy persisted values snap on load). */
export function zoomToStep(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 0
  return clampStep(Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_RATIO)))
}
