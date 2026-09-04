export type ApplicationSurfaceResizeEdge = 'left' | 'right'

export const REFERENCE_SCREEN_WIDTH_PX = 1728
export const REFERENCE_SURFACE_WIDTH_PX = 900

export interface ApplicationSurfaceWidthProfile {
  screenWidthPx: number
  surfaceWidthPx: number
}

export const DEFAULT_APPLICATION_SURFACE_WIDTH_PROFILE: ApplicationSurfaceWidthProfile = {
  screenWidthPx: REFERENCE_SCREEN_WIDTH_PX,
  surfaceWidthPx: REFERENCE_SURFACE_WIDTH_PX,
}

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

/**
 * Browser APIs do not expose trustworthy physical screen inches/PPI. `screen.width` is the stable
 * logical-resolution proxy: calibrate 900px to a 1728px-wide 16-inch-class display, then preserve
 * the same screen proportion on other displays without tying it to the browser window.
 */
export function screenAdjustedSurfaceWidth(
  screenWidth: number,
  profile: ApplicationSurfaceWidthProfile = DEFAULT_APPLICATION_SURFACE_WIDTH_PROFILE,
): number {
  const referenceScreen = Number.isFinite(profile.screenWidthPx) && profile.screenWidthPx > 0
    ? profile.screenWidthPx
    : REFERENCE_SCREEN_WIDTH_PX
  const referenceSurface = Number.isFinite(profile.surfaceWidthPx) && profile.surfaceWidthPx > 0
    ? profile.surfaceWidthPx
    : REFERENCE_SURFACE_WIDTH_PX
  const width = Number.isFinite(screenWidth) && screenWidth > 0 ? screenWidth : referenceScreen
  return Math.round(referenceSurface * width / referenceScreen)
}

export function surfaceWidthScale(
  width: number,
  screenWidth: number,
  profile: ApplicationSurfaceWidthProfile = DEFAULT_APPLICATION_SURFACE_WIDTH_PROFILE,
): number {
  return width / screenAdjustedSurfaceWidth(screenWidth, profile)
}
