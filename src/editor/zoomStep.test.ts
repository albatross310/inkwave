import { describe, expect, it } from 'vitest'
import {
  stepToZoom,
  magneticTextStep,
  textZoomSnapTarget,
  zoomToStep,
  ZOOM_STEP_MAX,
  ZOOM_STEP_MIN,
  ZOOM_STEPS_PER_NOTCH,
} from './zoomStep'

describe('the dense text-reflow lattice', () => {
  it('keeps exact 100% and pulls its nearby layouts into a wider sharp well', () => {
    expect(stepToZoom(0)).toBe(1)
    expect(stepToZoom(1)).toBeGreaterThan(1)
    expect(stepToZoom(1)).toBeLessThan(1.02)
    expect(stepToZoom(-1)).toBeLessThan(1)
    expect(stepToZoom(-1)).toBeGreaterThan(1 / 1.02)
    expect(stepToZoom(2)).toBeGreaterThan(1)
    expect(stepToZoom(2)).toBeLessThan(1.02 ** 2)
    expect(magneticTextStep(-1)).toBeLessThan(0)
    expect(magneticTextStep(1)).toBeGreaterThan(0)
  })

  it('keeps one physical notch at the former eight-percent travel', () => {
    expect(Math.pow(1.02, ZOOM_STEPS_PER_NOTCH)).toBeCloseTo(1.08, 8)
  })

  it('preserves the established useful range and round-trips every cache key', () => {
    expect(stepToZoom(ZOOM_STEP_MIN)).toBeGreaterThanOrEqual(0.62)
    expect(stepToZoom(ZOOM_STEP_MAX)).toBeLessThanOrEqual(2.4)
    for (let step = ZOOM_STEP_MIN; step <= ZOOM_STEP_MAX; step++) {
      expect(zoomToStep(stepToZoom(step))).toBe(step)
    }
  })

  it('is strictly ordered and offers a release target only beside 100%', () => {
    for (let step = ZOOM_STEP_MIN + 1; step <= ZOOM_STEP_MAX; step++) {
      expect(stepToZoom(step)).toBeGreaterThan(stepToZoom(step - 1))
    }
    expect(textZoomSnapTarget(-1)).toBe(0)
    expect(textZoomSnapTarget(1)).toBe(0)
    expect(textZoomSnapTarget(0)).toBeNull()
    expect(textZoomSnapTarget(2)).toBe(0)
    expect(textZoomSnapTarget(-2)).toBe(0)
    expect(textZoomSnapTarget(3)).toBe(0)
    expect(textZoomSnapTarget(-3)).toBe(0)
    expect(textZoomSnapTarget(4)).toBeNull()
    expect(textZoomSnapTarget(-4)).toBeNull()
  })
})
