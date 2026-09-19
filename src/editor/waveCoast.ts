export interface ResolvedWaveCoast {
  /** Shared future animation start on the document timeline. */
  t0: number
  /** Distance the continuing drift must travel before reaching the snapped resting pose. */
  d: number
  /** Resting left-wave translate, snapped to a physical device pixel. */
  end: number
}

/**
 * Resolve the loading-wave brake while the original drift animation still owns the element.
 * Publishing these values before the coast class mounts prevents WebKit from briefly presenting
 * a provisional keyframe set and then replacing it on the following frame.
 */
export function resolveWaveCoast(input: {
  driftStartTime: number
  now: number
  coastMs: number
  devicePixelRatio: number
  anchorSlackMs?: number
  loopMs?: number
  tilePx?: number
}): ResolvedWaveCoast | null {
  const {
    driftStartTime,
    now,
    coastMs,
    devicePixelRatio,
    anchorSlackMs = 150,
    loopMs = 1944,
    tilePx = 140,
  } = input
  if (![driftStartTime, now, coastMs, devicePixelRatio, anchorSlackMs, loopMs, tilePx].every(Number.isFinite)
    || coastMs <= 0 || devicePixelRatio <= 0 || loopMs <= 0 || tilePx <= 0) return null

  const t0 = now + Math.max(0, anchorSlackMs)
  const elapsed = ((t0 - driftStartTime) % loopMs + loopMs) % loopMs
  const driftX = -tilePx * elapsed / loopMs
  const nominalDistance = (tilePx / (loopMs / 1000)) * (coastMs / 1000) / 2
  const end = Math.round((driftX - nominalDistance) * devicePixelRatio) / devicePixelRatio
  return { t0, d: driftX - end, end }
}
