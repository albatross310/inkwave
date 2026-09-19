// ─── The ONE font-zoom step lattice (Peter's predictive step cache, 2026-07-09) ───
//
// Every font-zoom input — mouse wheel notches, trackpad fine-deltas, phone pinch — quantizes onto
// the same dense near-geometric lattice, step an integer in [STEP_MIN, STEP_MAX]. A narrow magnetic
// warp pulls the ±1/±2 neighbours toward step 0 (exactly 100%) without changing order or cache keys.
// Inputs
// ACCUMULATE fractionally and COMMIT whole steps (Scroll.tsx), so the editor only ever renders
// lattice zoom values. That is what makes zoom levels cacheable points: PaginationExtension
// precomputes the page-band geometry for the steps around the current one while idle, and applies
// the cached geometry the instant a gesture commits a step — the pages track the zoom live instead
// of waiting for the settle.
//
// The old 1.08 step was visibly discrete. The universal 1.02 lattice makes adjacent reflows
// effectively continuous while keeping cache keys integral and identical across devices. Input
// converts the old 8%-notch distance into ~3.89 dense steps, so the gesture covers the same range
// at the same speed; it simply exposes intermediate layouts instead of jumping over them.

export const ZOOM_STEP_RATIO = 1.02
export const ZOOM_STEP_MIN = -23 // 1.02⁻²³ ≈ 0.634 — the historical lower bound
export const ZOOM_STEP_MAX = 43  // 1.02⁴³  ≈ 2.344 — the historical upper bound
export const ZOOM_STEPS_PER_NOTCH = Math.log(1.08) / Math.log(ZOOM_STEP_RATIO)
export const TEXT_ZOOM_WELL_HALF_STEPS = 4.5
export const TEXT_ZOOM_WELL_STRENGTH = 0.92
export const TEXT_ZOOM_RELEASE_RADIUS_STEPS = 3

export function clampStep(k: number): number {
  return Math.max(ZOOM_STEP_MIN, Math.min(ZOOM_STEP_MAX, Math.round(k)))
}

/** Strictly increasing, compact-support attraction toward the 100% (step-zero) well. */
export function magneticTextStep(k: number): number {
  const u = k / TEXT_ZOOM_WELL_HALF_STEPS
  if (Math.abs(u) >= 1) return k
  const edge = 1 - u * u
  return k - TEXT_ZOOM_WELL_STRENGTH * TEXT_ZOOM_WELL_HALF_STEPS * u * edge * edge
}

const ZOOM_VALUES = Array.from(
  { length: ZOOM_STEP_MAX - ZOOM_STEP_MIN + 1 },
  (_, index) => Number(Math.pow(ZOOM_STEP_RATIO, magneticTextStep(ZOOM_STEP_MIN + index)).toPrecision(12)),
)

/** The magnetic lattice value for a step — the ONLY producer of --iw-editor-zoom values. */
export function stepToZoom(k: number): number {
  return ZOOM_VALUES[clampStep(k) - ZOOM_STEP_MIN]
}

/** Nearest lattice step for an arbitrary zoom (legacy persisted values snap on load). */
export function zoomToStep(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 0
  const target = Math.log(zoom)
  let lo = 0, hi = ZOOM_VALUES.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (Math.log(ZOOM_VALUES[mid]) < target) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return ZOOM_STEP_MIN
  const before = lo - 1
  return ZOOM_STEP_MIN + (target - Math.log(ZOOM_VALUES[before])
    <= Math.log(ZOOM_VALUES[lo]) - target ? before : lo)
}

/** Step-zero is the only text-size well. Its release neighbourhood covers the adjacent ±2 keys. */
export function textZoomSnapTarget(step: number): 0 | null {
  const k = clampStep(step)
  return k !== 0 && Math.abs(k) <= TEXT_ZOOM_RELEASE_RADIUS_STEPS ? 0 : null
}
