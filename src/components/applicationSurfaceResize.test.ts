import { describe, expect, it } from 'vitest'
import { surfaceMinHeight, surfaceWidthLimits, symmetricSurfaceWidth } from './applicationSurfaceResize'

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
})
