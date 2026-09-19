import { describe, expect, it } from 'vitest'
import { resolveWaveCoast } from './waveCoast'

describe('loading-wave coast anchor', () => {
  it('resolves from the still-running drift at a future compositor time', () => {
    const coast = resolveWaveCoast({
      driftStartTime: 100,
      now: 1100,
      coastMs: 2500,
      devicePixelRatio: 2,
    })!

    expect(coast.t0).toBe(1250)
    expect(coast.end * 2).toBe(Math.round(coast.end * 2))
    expect(coast.d).toBeGreaterThan(89.5)
    expect(coast.d).toBeLessThan(90.6)
  })

  it('keeps the resolved drift endpoint algebraically identical to the snapped rest pose', () => {
    const coast = resolveWaveCoast({
      driftStartTime: 425.25,
      now: 1820.75,
      coastMs: 2000,
      devicePixelRatio: 3,
    })!
    const elapsed = ((coast.t0 - 425.25) % 1944 + 1944) % 1944
    const driftAtAnchor = -140 * elapsed / 1944

    expect(driftAtAnchor - coast.d).toBeCloseTo(coast.end, 10)
  })

  it('refuses invalid timing instead of manufacturing a rest pose', () => {
    expect(resolveWaveCoast({
      driftStartTime: Number.NaN,
      now: 100,
      coastMs: 2500,
      devicePixelRatio: 2,
    })).toBeNull()
  })
})
