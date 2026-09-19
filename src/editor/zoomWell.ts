// One tiny piece of release physics shared by text and whole-page zoom.
// A quadratic potential U = ½k(x-target)² with critical damping and zero release velocity has the
// analytic trajectory below. It approaches rapidly without overshoot; callers land the exact final
// value at duration so floating-point tails never become a second settling state.

export const ZOOM_WELL_DURATION_MS = 112
const OMEGA = 7

/** Exact displacement for v(t)=v₀ exp(-t/τ), independent of display refresh or a missed frame. */
export function exponentialCoastOffset(
  velocity: number,
  elapsedMs: number,
  timeConstantMs: number,
  maximumDistance: number,
): number {
  if (![velocity, elapsedMs, timeConstantMs, maximumDistance].every(Number.isFinite)
      || elapsedMs <= 0 || timeConstantMs <= 0 || maximumDistance <= 0) return 0
  const distance = velocity * timeConstantMs * -Math.expm1(-elapsedMs / timeConstantMs)
  return Math.sign(distance) * Math.min(Math.abs(distance), maximumDistance)
}

export function criticallyDampedWellValue(
  from: number,
  target: number,
  elapsedMs: number,
  durationMs = ZOOM_WELL_DURATION_MS,
): number {
  if (![from, target, elapsedMs, durationMs].every(Number.isFinite) || durationMs <= 0) return target
  if (elapsedMs <= 0) return from
  if (elapsedMs >= durationMs) return target
  const t = elapsedMs / durationMs
  const remaining = (1 + OMEGA * t) * Math.exp(-OMEGA * t)
  return target + (from - target) * remaining
}
