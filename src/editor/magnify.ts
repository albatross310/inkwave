// ─── Hybrid-zoom magnify — the ONE owner of the transform-magnify scale (Peter, 2026-07-09) ───
//
// The desktop live editor scales the whole parchment with a GPU transform (`--iw-magnify` →
// `transform: scale(...)` on the paper inside its size-compensated `.iw-magnify-box` wrapper, see
// Scroll.tsx + index.css). Two things drive the scale:
//
//   • RESPONSIVE BASELINE + TWO MAGNETIC WELLS — a default track value of 1 still fits a page
//     into a narrow window. GPU zoom is no longer HARD-CAPPED there: a continuous mapping
//     accelerates into a point just beyond the paper edge, returns to ordinary speed, repeats at
//     the current text-area edge, then continues. A tiny centre plateau supplies the deliberate
//     melting/freezing resistance; release inside a narrow neighbourhood settles critically to it.
//   • USER MAGNIFY — Shift+two-finger movement anywhere on the document surface magnifies the whole
//     page (layout untouched — canonical breaks can't move). Intent is persisted separately from
//     the responsive baseline, so widening the window still releases an untouched fitted page.
//
// effectiveMagnify = magneticZoomScale(track, pageFit, textFit)
//
// EVERYTHING reads the scale through this module — no scattered getComputedStyle /
// getPropertyValue('--iw-magnify') anywhere else. Consumers that read getBoundingClientRect on
// (or against) the transformed paper get VISUAL px and must convert rect DIFFERENCES to layout px
// with `unscale(diff, scaleFor(el))` before mixing them with layout values (style px, canvas text
// widths, computed font sizes) or writing them back as inline styles inside the paper.
//
// SnapshotView / phone are never transformed: `scaleFor` keys off the `.iw-magnified` class that
// the one Scroll subscriber toggles on the live fill surface, so those surfaces resolve to 1.

const TRACK_KEY = 'inkwave:magnify-track-v2'
const LEGACY_KEY = 'inkwave:magnify'

export const MIN_MAGNIFY = 0.02  // practical floor only (degenerate-maths guard) — zoom-out is
                                 // otherwise unlimited: a tiny page floating in water is valid
// Numerical/paint safety only. The two user-visible detents are normally below 2×; 64× is
// effectively unbounded beyond them without letting an accidental Infinity poison layout sizes.
export const MAX_MAGNIFY = 64
export const WATER_MARGIN_PX = 12 // minimum water visible either side of every fit-capped surface
export const PAGE_EDGE_SNAP_OUTSET = 1.025
export const TEXT_EDGE_SNAP_OUTSET = 1.015
export const MAGNETIC_LOG_HALF_WIDTH = Math.log(1.13)
export const MAGNETIC_RELEASE_LOG_RADIUS = MAGNETIC_LOG_HALF_WIDTH
// A 0.45%-per-side hidden-track plateau: palpable at the exact detent, crossed by one ordinary
// fine wheel sample, and far too narrow to make the surrounding zoom feel muddy.
export const MAGNETIC_PLATEAU_LOG_HALF_WIDTH = Math.log(1.0045)

/**
 * Width a fitted child may occupy inside a padded scroll surface. `clientWidth` includes
 * padding, and that padding already supplies water; subtracting both padding AND the full water
 * margin double-counts it, while subtracting neither lets the child overflow its content box and
 * collapses auto-centring at the cap.
 */
export function fitAvailableWidth(
  clientWidth: number,
  paddingLeft: number,
  paddingRight: number,
  mirroredScrollbarGutter = 0,
): number {
  const width = Number.isFinite(clientWidth) ? Math.max(0, clientWidth) : 0
  const left = Number.isFinite(paddingLeft) ? Math.max(0, paddingLeft) : 0
  const right = Number.isFinite(paddingRight) ? Math.max(0, paddingRight) : 0
  const gutter = Number.isFinite(mirroredScrollbarGutter) ? Math.max(0, mirroredScrollbarGutter) : 0
  return Math.max(60, width - gutter - Math.max(WATER_MARGIN_PX, left) - Math.max(WATER_MARGIN_PX, right))
}

/** Shared fixed-layout fit ratio used by document paper and isolated application surfaces. */
export function fitScaleForWidth(availablePx: number, contentWidthPx: number): number {
  if (!Number.isFinite(contentWidthPx) || contentWidthPx <= 0) return Number.POSITIVE_INFINITY
  return Math.max(MIN_MAGNIFY, availablePx / contentWidthPx)
}

function clampScale(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.min(MAX_MAGNIFY, Math.max(MIN_MAGNIFY, v)) : 1
}

function readNumber(key: string): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const value = parseFloat(localStorage.getItem(key) || '')
    return Number.isFinite(value) && value > 0 ? value : null
  } catch { return null }
}

type Detent = { centre: number; halfWidth: number }

function detentsFor(pageFit: number, textFit: number): Detent[] {
  if (!Number.isFinite(pageFit) || pageFit <= 0) return []
  const scales = [pageFit * PAGE_EDGE_SNAP_OUTSET]
  const textEdge = textFit * TEXT_EDGE_SNAP_OUTSET
  if (Number.isFinite(textEdge) && textEdge > scales[0] * 1.035) scales.push(textEdge)
  const centres = scales.map((scale) => Math.log(clampScale(scale)))
  return centres.map((centre, index) => {
    const previous = index > 0 ? centre - centres[index - 1] : Number.POSITIVE_INFINITY
    const next = index + 1 < centres.length ? centres[index + 1] - centre : Number.POSITIVE_INFINITY
    const nearest = Math.min(previous, next)
    return {
      centre,
      // Neighbouring wells may approach one another but never overlap. Dividing their separation
      // by just over two makes the attraction occupy most of the interval while preserving a
      // small ordinary-speed channel between them.
      halfWidth: Math.max(0.012, Math.min(MAGNETIC_LOG_HALF_WIDTH, nearest / 2.08)),
    }
  })
}

export interface MagnifyDetentScales { page: number | null; text: number | null }

/** Public visual positions of the page-edge and inner/text-edge wells. */
export function magnifyDetentScales(pageFit: number, textFit: number): MagnifyDetentScales {
  const detents = detentsFor(pageFit, textFit)
  return {
    page: detents[0] ? clampScale(Math.exp(detents[0].centre)) : null,
    text: detents[1] ? clampScale(Math.exp(detents[1].centre)) : null,
  }
}

/** Horizontal mode boundary: centred through the inner well, cursor-focused from that point on. */
export function magnifyHorizontalFocus(
  scale: number,
  pageDetent: number | null,
  textDetent: number | null,
): number {
  if (![scale, pageDetent, textDetent].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
      || pageDetent! >= textDetent!) return 0
  return scale >= textDetent! ? 1 : 0
}

/**
 * Compact-support magnetic detent with a tiny centre plateau in log space.
 * Outside the plateau, a monotone cubic potential maps every point closer to the centre while
 * returning to ordinary unit slope at the support edge. Inside it, output is exactly the detent—the
 * latent track movement is the heat-capacity-like distance a scroll must cross before zoom resumes.
 */
export function magneticDetentLog(value: number, centre: number, halfWidth: number): number {
  if (!(halfWidth > 0)) return value
  const delta = value - centre
  const distance = Math.abs(delta)
  if (distance >= halfWidth) return value
  const plateau = Math.min(MAGNETIC_PLATEAU_LOG_HALF_WIDTH, halfWidth / 3)
  if (distance <= plateau) return centre
  const u = (distance - plateau) / (halfWidth - plateau)
  const edgeSlope = (halfWidth - plateau) / halfWidth
  const attracted = halfWidth * ((edgeSlope - 2) * u * u * u + (3 - edgeSlope) * u * u)
  return centre + Math.sign(delta) * attracted
}

function warpLog(value: number, pageFit: number, textFit: number): number {
  return detentsFor(pageFit, textFit).reduce(
    (result, detent) => magneticDetentLog(result, detent.centre, detent.halfWidth),
    value,
  )
}

function inverseWarpLog(target: number, pageFit: number, textFit: number): number {
  // A snapped detent must resolve to the CENTRE of its hidden plateau. Choosing either inverse edge
  // would make the next gesture resist in only one direction—the one-sided snap Peter observed.
  const exact = detentsFor(pageFit, textFit).find((detent) => Math.abs(target - detent.centre) < 1e-12)
  if (exact) return exact.centre
  // Else use the monotone mapping's unique non-plateau inverse.
  let lo = target - 2
  let hi = target + 2
  for (let index = 0; index < 60; index++) {
    const mid = (lo + hi) / 2
    if (warpLog(mid, pageFit, textFit) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function responsiveAnchor(pageFit: number): number {
  return Number.isFinite(pageFit) ? clampScale(Math.min(1, pageFit)) : 1
}

/** Continuous, monotone track→visual mapping with page-edge and text-edge plateaus. */
export function magneticZoomScale(track: number, pageFit: number, textFit: number): number {
  const safeTrack = Number.isFinite(track) && track > 0 ? track : 1
  const anchorLog = inverseWarpLog(Math.log(responsiveAnchor(pageFit)), pageFit, textFit)
  const visualLog = warpLog(Math.log(safeTrack) + anchorLog, pageFit, textFit)
  // Shed inverse/log round-off (e.g. direct 0.1 becoming 0.09999999999999998) without the old
  // four-decimal quantisation that could flatten genuinely tiny track movements at a detent.
  return Number(clampScale(Math.exp(visualLog)).toPrecision(14))
}

/**
 * Horizontal scroll position that keeps an over-wide visual page centred in the usable viewport.
 * Below the page-fit point ordinary auto margins centre the wrapper and scrollLeft remains zero;
 * above it the browser collapses those margins, so half the overflow must be carried explicitly.
 */
export function centredMagnifyScrollLeft(
  scale: number,
  pageWidthPx: number,
  availableWidthPx: number,
): number {
  if (![scale, pageWidthPx, availableWidthPx].every(Number.isFinite)
      || scale <= 0 || pageWidthPx <= 0 || availableWidthPx <= 0) return 0
  return Math.max(0, (pageWidthPx * scale - availableWidthPx) / 2)
}

/** Exact inverse used by direct setters and migration; detent values choose the plateau centre. */
export function magnifyTrackForScale(scale: number, pageFit: number, textFit: number): number {
  const targetLog = Math.log(clampScale(scale))
  const anchorLog = inverseWarpLog(Math.log(responsiveAnchor(pageFit)), pageFit, textFit)
  return Math.exp(inverseWarpLog(targetLog, pageFit, textFit) - anchorLog)
}

/** Exact release target inside a narrow page/text-edge neighbourhood; null outside both wells. */
export function magneticMagnifySnapTarget(
  scale: number,
  fitPage: number,
  fitText: number,
): number | null {
  if (!Number.isFinite(scale) || scale <= 0) return null
  const value = Math.log(scale)
  let nearest: Detent | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const detent of detentsFor(fitPage, fitText)) {
    const d = Math.abs(value - detent.centre)
    if (d < distance) { nearest = detent; distance = d }
  }
  return nearest && distance <= Math.min(MAGNETIC_RELEASE_LOG_RADIUS, nearest.halfWidth)
    ? clampScale(Math.exp(nearest.centre))
    : null
}

const storedTrack = readNumber(TRACK_KEY)
let legacyIntent: number | null = storedTrack == null ? clampScale(readNumber(LEGACY_KEY) ?? 1) : null
let userTrack = storedTrack ?? 1
let pageFit = Number.POSITIVE_INFINITY
let textFit = Number.POSITIVE_INFINITY
let effective = storedTrack == null ? legacyIntent! : magneticZoomScale(userTrack, pageFit, textFit)
export type MagnifyChange = 'input' | 'restore'
const subs = new Set<(change: MagnifyChange) => void>()

/** Current release target for the live GPU zoom context. */
export function getMagnifySnapTarget(): number | null {
  return magneticMagnifySnapTarget(effective, pageFit, textFit)
}

export function getMagnifyDetentScales(): MagnifyDetentScales {
  return magnifyDetentScales(pageFit, textFit)
}

function compute(): number {
  return magneticZoomScale(userTrack, pageFit, textFit)
}

function refresh(change: MagnifyChange = 'input'): void {
  const next = compute()
  // A restore also cancels a prior view's pending gesture settle, even at the same exact scale.
  if (next === effective && change !== 'restore') return
  effective = next
  subs.forEach((fn) => fn(change))
}

/** The scale the live editor's paper is (to be) rendered at. */
export function getMagnify(): number { return effective }

/** Current visual intent. Kept for settings/tests; wheel input advances the underlying track. */
export function getUserMagnify(): number { return effective }

/** Set an exact visual scale, centring the hidden track when the value is a detent. */
export function setUserMagnify(v: number): number {
  legacyIntent = null
  userTrack = magnifyTrackForScale(clampScale(v), pageFit, textFit)
  refresh()
  return effective
}

/** Restore a remembered panel pose without starting gesture physics or a deferred zoom remeasure. */
export function restoreUserMagnify(v: number): number {
  legacyIntent = null
  userTrack = magnifyTrackForScale(clampScale(v), pageFit, textFit)
  refresh('restore')
  return effective
}

/** Advance the input track multiplicatively; detent plateaus deliberately consume a tiny distance. */
export function advanceUserMagnify(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return effective
  legacyIntent = null
  userTrack = Math.min(1e6, Math.max(1e-6, userTrack * factor))
  refresh()
  return effective
}

/** Persist the track (and a legacy visual value for older builds) only at gesture settle. */
export function persistMagnify(): void {
  try {
    localStorage.setItem(TRACK_KEY, String(userTrack))
    localStorage.setItem(LEGACY_KEY, String(effective))
  } catch { /* private mode */ }
}

/**
 * Feed the responsive/magnetic mapping its inputs: width available inside the scroll surface,
 * (`fitAvailableWidth(surface.clientWidth, paddingLeft, paddingRight, mirroredGutter)`) and the
 * canonical page width plus the current text-area width (page width minus its two side margins).
 * `null` releases both detents (no hybrid surface / 'scroll' paper).
 */
export function setFitContext(availablePx: number | null, pageWidthPx?: number, textWidthPx?: number): void {
  if (availablePx == null || !pageWidthPx || pageWidthPx <= 0) {
    pageFit = Number.POSITIVE_INFINITY
    textFit = Number.POSITIVE_INFINITY
  } else {
    pageFit = fitScaleForWidth(availablePx, pageWidthPx)
    textFit = fitScaleForWidth(availablePx, textWidthPx && textWidthPx > 0 ? textWidthPx : pageWidthPx)
  }
  if (legacyIntent != null) {
    // Old builds persisted a visual intent and hard-capped it at the paper edge. Preserve exactly
    // what that writer last saw, then continue on the new unbounded track from there.
    const oldVisual = Number.isFinite(pageFit) ? Math.min(legacyIntent, pageFit) : legacyIntent
    userTrack = magnifyTrackForScale(oldVisual, pageFit, textFit)
    legacyIntent = null
  }
  refresh()
}

/** Notified whenever the effective magnify changes (wheel, window resize, page settings). */
export function subscribe(fn: (change: MagnifyChange) => void): () => void {
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
