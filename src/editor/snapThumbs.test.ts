import { describe, it, expect } from 'vitest'
import { thumbKey, thumbHash, planThumbEviction } from './snapThumbs'

describe('snapThumbs pure helpers', () => {
  it('thumbKey separates snapshot / pane / signature', () => {
    expect(thumbKey('snap-1', 'doc', 'w900|d1|day')).toBe('snap-1|doc|w900|d1|day')
    // same snapshot, different pane → distinct entries
    expect(thumbKey('snap-1', 'doc', 's')).not.toBe(thumbKey('snap-1', 'map', 's'))
    // different signature (theme/width/font change) → distinct entries (lazy re-bake territory)
    expect(thumbKey('snap-1', 'doc', 'day')).not.toBe(thumbKey('snap-1', 'doc', 'night'))
  })

  it('thumbHash is stable and hex', () => {
    expect(thumbHash('abc')).toBe(thumbHash('abc'))
    expect(thumbHash('abc')).toMatch(/^[0-9a-f]+$/)
    expect(thumbHash('abc')).not.toBe(thumbHash('abd'))
  })

  it('planThumbEviction drops least-recently-used first until the deficit is covered', () => {
    const items = [
      { key: 'a', bytes: 10, used: 1 }, // oldest
      { key: 'b', bytes: 10, used: 5 },
      { key: 'c', bytes: 10, used: 9 }, // newest
    ]
    expect(planThumbEviction(items, 0)).toEqual([])
    expect(planThumbEviction(items, 5)).toEqual(['a'])        // one covers it
    expect(planThumbEviction(items, 15)).toEqual(['a', 'b'])  // LRU order
    expect(planThumbEviction(items, 999)).toEqual(['a', 'b', 'c'])
  })
})
