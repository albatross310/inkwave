import { describe, it, expect } from 'vitest'
import { POOL, POOL_SET, POOL_INDEX, POOL_ID, POOL_SIZE } from './pool'

describe('POOL', () => {
  it('has exactly POOL_SIZE entries', () => {
    expect(POOL.length).toBe(POOL_SIZE)
  })

  it('contains only lowercase alphabetic words of length ≥ 3', () => {
    for (const w of POOL) {
      expect(/^[a-z]+$/.test(w), `"${w}" not lowercase alpha`).toBe(true)
      expect(w.length, `"${w}" too short`).toBeGreaterThanOrEqual(3)
    }
  })

  it('excludes function words', () => {
    const functionWords = ['the', 'and', 'in', 'is', 'of', 'to', 'it', 'you', 'but']
    for (const fw of functionWords) {
      expect(POOL_SET.has(fw), `function word "${fw}" should not be in POOL`).toBe(false)
    }
  })

  it('contains common content words', () => {
    // These are high-frequency content words that should survive the filter.
    const expected = ['write', 'think', 'work', 'time', 'life', 'world']
    for (const w of expected) {
      expect(POOL_SET.has(w), `"${w}" should be in POOL`).toBe(true)
    }
  })

  it('has no duplicates', () => {
    expect(POOL.length).toBe(new Set(POOL).size)
  })
})

describe('POOL_SET', () => {
  it('has the same entries as POOL', () => {
    expect(POOL_SET.size).toBe(POOL.length)
    for (const w of POOL) expect(POOL_SET.has(w)).toBe(true)
  })
})

describe('POOL_INDEX', () => {
  it('maps every pool word to its 0-based index', () => {
    for (let i = 0; i < POOL.length; i++) {
      expect(POOL_INDEX.get(POOL[i])).toBe(i)
    }
  })

  it('does not contain words outside the pool', () => {
    expect(POOL_INDEX.has('the')).toBe(false)
    expect(POOL_INDEX.has('zzznotaword')).toBe(false)
  })
})

describe('POOL_ID', () => {
  it('is a stable deterministic string in the expected format', () => {
    expect(POOL_ID).toMatch(/^inkwave-pool-norvig-v1:\d+:[0-9a-f]{8}$/)
  })

  it('embeds the pool length', () => {
    expect(POOL_ID).toContain(`:${POOL.length}:`)
  })
})
