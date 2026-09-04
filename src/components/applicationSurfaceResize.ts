export type ApplicationSurfaceResizeEdge = 'left' | 'right'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Side handles move around a fixed centre, so one pointer pixel changes total width by two. */
export function symmetricSurfaceWidth({
  startWidth,
  pointerDelta,
  edge,
  minWidth,
  maxWidth,
}: {
  startWidth: number
  pointerDelta: number
  edge: ApplicationSurfaceResizeEdge
  minWidth: number
  maxWidth: number
}): number {
  const outwardDelta = edge === 'right' ? pointerDelta : -pointerDelta
  return clamp(startWidth + outwardDelta * 2, minWidth, maxWidth)
}

export function surfaceMinHeight({
  startHeight,
  pointerDelta,
  minHeight,
  maxHeight,
}: {
  startHeight: number
  pointerDelta: number
  minHeight: number
  maxHeight: number
}): number {
  return clamp(startHeight + pointerDelta, minHeight, maxHeight)
}

export function surfaceWidthLimits(containerWidth: number): { min: number; max: number } {
  const max = Math.max(1, containerWidth)
  return { min: Math.min(max, Math.max(320, max * 0.45)), max }
}
