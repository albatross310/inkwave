// ─── Hybrid-zoom magnify — the ONE owner of the transform-magnify scale (Peter, 2026-07-09) ───
//
// The desktop live editor scales the whole parchment with a GPU transform (`--iw-magnify` →
// `transform: scale(...)` on the paper inside its size-compensated `.iw-magnify-box` wrapper, see
// Scroll.tsx + index.css). Two things drive the scale:
//
//   • FIT-TO-WIDTH FLOOR — when the window is too narrow to show the canonical page (page width +
//     a small water margin > viewport), the page scales down so the FULL page always fits,
//     continuously as the window shrinks. The user never sees a horizontally cut-off page.
//     While the floor binds, the fit scale wins outright (wheel intent can't push past it).
//   • USER MAGNIFY — Ctrl/⌘+wheel with the cursor over the WATER (outside the parchment)
//     magnifies the whole page (layout untouched — canonical breaks can't move). Intent is
//     persisted separately from the floor, so widening the window releases the floor and the
//     user's magnify comes back.
//
// effectiveMagnify = fitScale < 1 ? fitScale : clamp(userMagnify, 1..2.5)
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

export const MIN_MAGNIFY = 1     // user intent can't shrink the page below fit/natural size
export const MAX_MAGNIFY = 2.5
export const WATER_MARGIN_PX = 24 // minimum water visible either side of a fit-floored page

function clampUser(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.min(MAX_MAGNIFY, Math.max(MIN_MAGNIFY, v)) : 1
}

function readPersisted(): number {
  if (typeof localStorage === 'undefined') return 1
  try { return clampUser(parseFloat(localStorage.getItem(KEY) || '') || 1) } catch { return 1 }
}

let userMagnify = readPersisted() // the persisted INTENT — never the floor-clamped value
let fitScale = 1                  // min(1, available/pageWidth); < 1 only when the page can't fit
let effective = compute()
const subs = new Set<() => void>()

function compute(): number {
  return +(fitScale < 1 ? fitScale : clampUser(userMagnify)).toFixed(4)
}

function refresh(): void {
  const next = compute()
  if (next === effective) return
  effective = next
  subs.forEach((fn) => fn())
}

/** The scale the live editor's paper is (to be) rendered at. */
export function getMagnify(): number { return effective }

/** The persisted user intent (≥ 1) — what the wheel adjusts; the floor never overwrites it. */
export function getUserMagnify(): number { return userMagnify }

/** Set the user intent (clamped 1…2.5). Returns the new EFFECTIVE magnify. */
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
 * Feed the fit floor its inputs: the width available for the page inside the scroll surface
 * (surface clientWidth − 2×WATER_MARGIN_PX) and the canonical page width (pageModel px).
 * `null` releases the floor entirely (no hybrid surface mounted / 'scroll' paper).
 */
export function setFitContext(availablePx: number | null, pageWidthPx?: number): void {
  if (availablePx == null || !pageWidthPx || pageWidthPx <= 0) fitScale = 1
  else fitScale = Math.min(1, Math.max(0.2, availablePx / pageWidthPx))
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
