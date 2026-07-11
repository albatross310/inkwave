// Pure-logic tests for the scrub raster layer (round 3): cache keys, nearest-bitmap fallback,
// and byte-budget eviction planning. The DOM capture path is exercised by browser probes.
import { describe, it, expect } from 'vitest'
import { rasterKey, pickNearest, planEviction } from './scrubRaster'

describe('rasterKey', () => {
  it('buckets by pane size, zoom and dpr', () => {
    expect(rasterKey('doc', 's1', 800.4, 600, 1, 2)).toBe('doc|s1|800x600|z1.000|d2.00')
    expect(rasterKey('diff', 's1', 800, 600, 1.25, 1)).toBe('diff|s1|800x600|z1.250|d1.00')
  })
  it('same snapshot at a different zoom is a different entry', () => {
    expect(rasterKey('doc', 's1', 800, 600, 1, 1)).not.toBe(rasterKey('doc', 's1', 800, 600, 1.1, 1))
  })
})

describe('pickNearest', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f']
  it('exact hit wins', () => {
    expect(pickNearest(order, ['a', 'c', 'f'], 'c')).toBe('c')
  })
  it('falls back to the nearest cached snapshot by order distance', () => {
    expect(pickNearest(order, ['a', 'f'], 'e')).toBe('f')
    expect(pickNearest(order, ['a', 'f'], 'b')).toBe('a')
  })
  it('unknown target never shows an arbitrary version', () => {
    expect(pickNearest(order, ['a', 'b'], 'zz')).toBeNull()
  })
  it('no candidates → null', () => {
    expect(pickNearest(order, [], 'c')).toBeNull()
  })
  it('candidates outside the order are ignored', () => {
    expect(pickNearest(order, ['ghost', 'd'], 'b')).toBe('d')
  })
})

describe('planEviction', () => {
  const item = (key: string, bytes: number, lastUsed: number, prot = false) =>
    ({ key, bytes, lastUsed, protected: prot })
  it('nothing over budget → nothing evicted', () => {
    expect(planEviction([item('a', 100, 1)], 0)).toEqual([])
    expect(planEviction([item('a', 100, 1)], -5)).toEqual([])
  })
  it('evicts least-recently-used first, only as much as needed', () => {
    const plan = planEviction([item('old', 100, 1), item('mid', 100, 2), item('new', 100, 3)], 150)
    expect(plan).toEqual(['old', 'mid'])
  })
  it('protected entries (scrub window) go last', () => {
    const plan = planEviction([item('win', 100, 1, true), item('far', 100, 2)], 100)
    expect(plan).toEqual(['far'])
  })
  it('takes protected entries only when unprotected cannot cover the deficit', () => {
    const plan = planEviction([item('win', 100, 1, true), item('far', 100, 2)], 200)
    expect(plan).toEqual(['far', 'win'])
  })
})
