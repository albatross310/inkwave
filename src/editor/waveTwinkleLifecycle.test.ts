import { describe, expect, it } from 'vitest'
import { pendingTwinkleMountDecision } from './waveTwinkle'

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
