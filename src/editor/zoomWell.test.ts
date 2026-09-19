import { describe, expect, it } from 'vitest'
import { criticallyDampedWellValue, exponentialCoastOffset, ZOOM_WELL_DURATION_MS } from './zoomWell'

describe('critically damped zoom potential well', () => {
  it('moves monotonically to the exact minimum without overshoot', () => {
    const values = Array.from({ length: 13 }, (_, index) =>
      criticallyDampedWellValue(2, 1, index * ZOOM_WELL_DURATION_MS / 12),
    )
    expect(values[0]).toBe(2)
    expect(values[values.length - 1]).toBe(1)
    for (let index = 1; index < values.length; index++) {
      expect(values[index]).toBeLessThan(values[index - 1])
      expect(values[index]).toBeGreaterThanOrEqual(1)
    }
  })

  it('is direction-symmetric and rejects bad timing safely', () => {
    const down = criticallyDampedWellValue(2, 1, 40)
    const up = criticallyDampedWellValue(0, 1, 40)
    expect(down - 1).toBeCloseTo(1 - up, 12)
    expect(criticallyDampedWellValue(2, 1, 40, 0)).toBe(1)
  })
})

describe('bounded release coast', () => {
  it('travels the same distance at 30, 60, and 120Hz and after a stalled frame', () => {
    const distances = [1000 / 30, 1000 / 60, 1000 / 120, 112].map((interval) => {
      let previous = 0
      let travelled = 0
      for (let time = interval; time < 112; time += interval) {
        const offset = exponentialCoastOffset(0.004, time, 44, 0.34)
        travelled += offset - previous
        previous = offset
      }
      travelled += exponentialCoastOffset(0.004, 112, 44, 0.34) - previous
      return travelled
    })
    for (const distance of distances) expect(distance).toBeCloseTo(distances[0], 12)
    expect(distances[0]).toBeGreaterThan(0.1)
    expect(distances[0]).toBeLessThan(0.34)
  })

  it('bounds both directions and stays at the release pose for invalid time', () => {
    expect(exponentialCoastOffset(0.018, 112, 44, 0.34)).toBe(0.34)
    expect(exponentialCoastOffset(-0.018, 112, 44, 0.34)).toBe(-0.34)
    expect(exponentialCoastOffset(0.01, -1, 44, 0.34)).toBe(0)
    expect(exponentialCoastOffset(0.01, 112, 0, 0.34)).toBe(0)
  })
})
