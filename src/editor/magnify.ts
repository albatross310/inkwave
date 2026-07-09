// ─── Hybrid-zoom magnify — the ONE owner of the transform-magnify scale (Peter, 2026-07-09) ───
//
// The desktop live editor scales the whole parchment with a GPU transform (`--iw-magnify` →
// `transform: scale(...)` on the paper inside its size-compensated `.iw-magnify-box` wrapper, see
// Scroll.tsx + index.css). Two things drive the scale:
//
//   • FIT-TO-WIDTH CAP — when the window is too narrow to show the canonical page (page width +
//     a small water margin > viewport), the page scales down so the FULL page always fits,
//     continuously as the window shrinks. The user never sees a horizontally cut-off page:
//     zooming IN is capped at the fit scale. Zooming OUT below fit is unlimited (a tiny page
//     floating in water is valid — Peter, 2026-07-09).
//   • USER MAGNIFY — Ctrl/⌘+wheel with the cursor over the WATER (outside the parchment, or in
//     a between-pages gap) magnifies the whole page (layout untouched — canonical breaks can't
//     move). Intent is persisted separately from the cap, so widening the window releases the
//     cap and the user's magnify comes back.
//
// effectiveMagnify = min(clamp(userMagnify, 0.02..2.5), fitCap)
//
// EVERYTHING reads the scale through this module — no scattered getComputedStyle /
// getPropertyValue('--iw-magnify') anywhere else. Consumers that read getBoundingClientRect on
// (or against) the transformed paper get VISUAL px and must convert rect DIFFERENCES to layout px
// with `unscale(diff, scaleFor(el))` before mixing them with layout values (style px, canvas text
// widths, computed font sizes) or writing them back as inline styles inside the paper.
//
// SnapshotView / phone are never transformed: `scaleFor` keys off the `.iw-magnified` class that
// the one Scroll subscriber toggles on the live fill surface, so those surfaces resolve to 1.

const KEY = 'inkwave:magnify'

export const MIN_MAGNIFY = 0.02  // practical floor only (degenerate-maths guard) — zoom-out is
                                 // otherwise unlimited: a tiny page floating in water is valid
export const MAX_MAGNIFY = 2.5
export const WATER_MARGIN_PX = 24 // minimum water visible either side of a fit-capped page

function clampUser(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.min(MAX_MAGNIFY, Math.max(MIN_MAGNIFY, v)) : 1
}

function readPersisted(): number {
  if (typeof localStorage === 'undefined') return 1
  try { return clampUser(parseFloat(localStorage.getItem(KEY) || '') || 1) } catch { return 1 }
}

let userMagnify = readPersisted()         // the persisted INTENT — never the cap-clamped value
let fitCap = Number.POSITIVE_INFINITY     // available/pageWidth — the NEVER-A-PARTIAL-PAGE ceiling
let effective = compute()
const subs = new Set<() => void>()

// The fit scale is an UPPER CAP, not a floor (Peter, 2026-07-09): zooming OUT below fit is always
// allowed (the page just floats smaller in the water); zooming IN past fit would cut the page
// horizontally — never allowed. effective = min(clamp(intent, 0.02…2.5), fitCap).
function compute(): number {
  return +Math.min(clampUser(userMagnify), fitCap).toFixed(4)
}

function refresh(): void {
  const next = compute()
  if (next === effective) return
  effective = next
  subs.forEach((fn) => fn())
}

/** The scale the live editor's paper is (to be) rendered at. */
export function getMagnify(): number { return effective }

/** The persisted user intent — what the wheel adjusts; the fit cap never overwrites it. */
export function getUserMagnify(): number { return userMagnify }

/** Set the user intent (clamped 0.02…2.5). Returns the new EFFECTIVE magnify. */
export function setUserMagnify(v: number): number {
  userMagnify = clampUser(v)
  refresh()
  return effective
}

/** Persist the user intent (called from the wheel path's settle timer, not per frame). */
export function persistMagnify(): void {
  try { localStorage.setItem(KEY, String(userMagnify)) } catch { /* private mode */ }
}

/**
 * Feed the fit cap its inputs: the width available for the page inside the scroll surface
 * (surface clientWidth − 2×WATER_MARGIN_PX) and the canonical page width (pageModel px).
 * The cap is the RAW ratio (may exceed 1 on wide windows — that just means intent up to 2.5 is
 * allowed); when the window is narrower than the page it drops below 1 and squeezes the page down
 * so the full page always fits. `null` releases the cap (no hybrid surface / 'scroll' paper).
 */
export function setFitContext(availablePx: number | null, pageWidthPx?: number): void {
  if (availablePx == null || !pageWidthPx || pageWidthPx <= 0) fitCap = Number.POSITIVE_INFINITY
  else fitCap = Math.max(MIN_MAGNIFY, availablePx / pageWidthPx)
  refresh()
}

/** Notified whenever the effective magnify changes (wheel, window resize, page settings). */
export function subscribe(fn: () => void): () => void {
  subs.add(fn)
  return () => { subs.delete(fn) }
}

// ── Visual → layout conversion (the ONE shared utility) ──────────────────────────────────────
//
// getBoundingClientRect under the transform returns VISUAL px. Layout px (what inline styles,
// canvas text measurement and computed font sizes speak) = visual difference ÷ scale. Only
// DIFFERENCES between two visual coords inside the same scaled subtree may be divided — never
// absolute viewport coords.

/**
 * The transform scale affecting `el`: the effective magnify when el sits inside the live
 * (transformed) editor surface, 1 everywhere else (SnapshotView's in-flow Scroll, phone,
 * fixed-position chrome). Keyed off the `.iw-magnified` class the Scroll subscriber toggles,
 * so it is exactly "is an ancestor actually scaled right now".
 */
export function scaleFor(el: Element | null | undefined): number {
  if (effective === 1 || !el) return 1
  const surf = el.closest?.('.inkwave-editor-surface')
  return surf && surf.classList.contains('iw-magnified') ? effective : 1
}

/** Convert a visual-space px difference/size into layout px. */
export function unscale(visualPx: number, scale: number): number {
  return scale > 0.01 && scale !== 1 ? visualPx / scale : visualPx
}
