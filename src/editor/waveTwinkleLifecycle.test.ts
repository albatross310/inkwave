import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { monisticTransformTrack, pendingTwinkleMountDecision } from './waveTwinkle'

const live = {
  requested: true,
  tokenMatches: true,
  alreadyMounted: false,
  connected: true,
  sameDefinitions: true,
} as const

describe('late twinkle mount at the coast-to-rest boundary', () => {
  it('discards a sparkle set whose decode finishes after rest stopped requesting it', () => {
    expect(pendingTwinkleMountDecision({ ...live, requested: false, mode: 'off' })).toBe('discard')
  })

  it('attaches a still-requested desktop dash set statically after rest', () => {
    expect(pendingTwinkleMountDecision({ ...live, mode: 'off' })).toBe('attach-static')
  })

  it('keeps compositor playback only while load or coast still owns the water', () => {
    expect(pendingTwinkleMountDecision({ ...live, mode: 'anim' })).toBe('attach-animated')
    expect(pendingTwinkleMountDecision({ ...live, mode: 'coast' })).toBe('attach-animated')
  })

  it('discards every other stale continuation independently of the current mode', () => {
    for (const stale of [
      { tokenMatches: false },
      { alreadyMounted: true },
      { connected: false },
      { sameDefinitions: false },
    ]) {
      expect(pendingTwinkleMountDecision({ ...live, ...stale, mode: 'anim' })).toBe('discard')
    }
  })
})

describe('monistic load marks', () => {
  it('uses one straight, tile-exact drift instead of moving an object between blink slots', () => {
    expect(monisticTransformTrack('a')).toEqual([
      { offset: 0, transform: 'translate3d(0px, 0px, 0)' },
      { offset: 1, transform: 'translate3d(-1680.00px, 0px, 0)' },
    ])
    expect(monisticTransformTrack('b')[1]).toEqual({
      offset: 1,
      transform: 'translate3d(1680.00px, 0px, 0)',
    })
  })

  it('contains no per-envelope slot or rest-time respawn mechanism', () => {
    const source = readFileSync(resolve(__dirname, 'waveTwinkle.ts'), 'utf8')
    expect(source).not.toContain('memPickLight')
    expect(source).not.toContain('respawnDashes')
    expect(source).not.toMatch(/slots\??:/)
    expect(source).toContain('trackAnims.set(el, [ao])')
    expect(source).toContain('blinkDrift.set(wrap, a)')
    expect(source).not.toContain('trackAnims.set(el, [ao, at])')
    expect(source).toContain('void a.ready.then(apply)')
  })
})
