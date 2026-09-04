import { describe, expect, it } from 'vitest'
import {
  screenAdjustedSurfaceWidth,
  surfaceMinHeight,
  surfaceWidthLimits,
  surfaceWidthScale,
  symmetricSurfaceWidth,
} from './applicationSurfaceResize'

describe('application surface resizing', () => {
  it('mirrors an outward pull on the right around a fixed centre', () => {
    expect(symmetricSurfaceWidth({
      startWidth: 600, pointerDelta: 40, edge: 'right', minWidth: 360, maxWidth: 800,
    })).toBe(680)
  })

  it('mirrors an outward pull on the left around the same fixed centre', () => {
    expect(symmetricSurfaceWidth({
      startWidth: 600, pointerDelta: -40, edge: 'left', minWidth: 360, maxWidth: 800,
    })).toBe(680)
  })

  it('clamps width before the surface can leave its container', () => {
    const limits = surfaceWidthLimits(800)
    expect(limits).toEqual({ min: 360, max: 800 })
    expect(symmetricSurfaceWidth({
      startWidth: 600, pointerDelta: 200, edge: 'right', minWidth: limits.min, maxWidth: limits.max,
    })).toBe(800)
  })

  it('lets the bottom handle grow and shrink within safe limits', () => {
    expect(surfaceMinHeight({ startHeight: 420, pointerDelta: 80, minHeight: 240, maxHeight: 1800 })).toBe(500)
    expect(surfaceMinHeight({ startHeight: 420, pointerDelta: -500, minHeight: 240, maxHeight: 1800 })).toBe(240)
  })

  it('turns the 900px reference into a screen-resolution-adjusted pixel width', () => {
    expect(screenAdjustedSurfaceWidth(1728)).toBe(900)
    expect(screenAdjustedSurfaceWidth(1512)).toBe(788)
    expect(screenAdjustedSurfaceWidth(2560)).toBe(1333)
    expect(screenAdjustedSurfaceWidth(0)).toBe(900)
  })

  it('lets another application provide its own reference width without copying the mechanism', () => {
    const profile = { screenWidthPx: 1920, surfaceWidthPx: 1200 }
    expect(screenAdjustedSurfaceWidth(1440, profile)).toBe(900)
    expect(surfaceWidthScale(990, 1440, profile)).toBe(1.1)
  })

  it('stores a resize relative to the screen baseline rather than the browser window', () => {
    expect(surfaceWidthScale(990, 1728)).toBe(1.1)
    expect(Math.round(screenAdjustedSurfaceWidth(1512) * surfaceWidthScale(990, 1728))).toBe(867)
  })
})
