import { describe, it, expect } from 'vitest'
import {
  emptyScasState,
  normalizeScasState,
  buildLookup,
  isColoured,
  isSuppressedFromSuggestions,
  DEFAULT_SET_SIZE,
} from './state'
import type { ScasState } from '../types/document'

function state(overrides: Partial<ScasState> = {}): ScasState {
  return { ...emptyScasState(), ...overrides }
}

describe('emptyScasState', () => {
  it('returns zeroed state', () => {
    const s = emptyScasState()
    expect(s.version).toBe(0)
    expect(s.locked).toEqual([])
    expect(s.satisfied).toEqual([])
    expect(s.liveKicks).toEqual([])
    expect(s.kickTimes).toEqual({})
  })
})

describe('normalizeScasState', () => {
  it('returns empty state for null/undefined input', () => {
    expect(normalizeScasState(null)).toEqual(emptyScasState())
    expect(normalizeScasState(undefined)).toEqual(emptyScasState())
  })

  it('coerces version to 0 when non-finite', () => {
    expect(normalizeScasState({ version: NaN as unknown as number }).version).toBe(0)
    expect(normalizeScasState({ version: Infinity as unknown as number }).version).toBe(0)
  })

  it('deduplicates locked and liveKicks', () => {
    const s = normalizeScasState({ locked: ['cat', 'cat', 'dog'], liveKicks: ['a', 'a'] })
    expect(s.locked).toEqual(['cat', 'dog'])
    expect(s.liveKicks).toEqual(['a'])
  })

  it('filters invalid satisfied entries', () => {
    const s = normalizeScasState({
      satisfied: [
        { lemma: 'work', satisfiedAtVersion: 1 },
        null as unknown as { lemma: string; satisfiedAtVersion: number },
        { lemma: 123 as unknown as string, satisfiedAtVersion: 2 },
      ],
    })
    expect(s.satisfied).toHaveLength(1)
    expect(s.satisfied[0].lemma).toBe('work')
  })

  it('copies kickTimes when present', () => {
    const s = normalizeScasState({ kickTimes: { cat: 1234567890 } })
    expect(s.kickTimes).toEqual({ cat: 1234567890 })
  })

  it('preserves valid version', () => {
    expect(normalizeScasState({ version: 7 }).version).toBe(7)
  })
})

describe('buildLookup', () => {
  it('includes immune lemmas that are satisfied at the CURRENT version', () => {
    const s = state({
      version: 3,
      satisfied: [
        { lemma: 'work', satisfiedAtVersion: 3 },   // current
        { lemma: 'think', satisfiedAtVersion: 2 },  // stale — NOT immune
      ],
    })
    const lookup = buildLookup(s)
    expect(lookup.immune.has('work')).toBe(true)
    expect(lookup.immune.has('think')).toBe(false)
  })

  it('builds locked and liveKicks Sets', () => {
    const s = state({ locked: ['cat', 'dog'], liveKicks: ['fish'] })
    const lookup = buildLookup(s)
    expect(lookup.locked.has('cat')).toBe(true)
    expect(lookup.locked.has('fish')).toBe(false)
    expect(lookup.liveKicks.has('fish')).toBe(true)
    expect(lookup.version).toBe(0)
  })

  it('returns empty Sets for an empty state', () => {
    const lookup = buildLookup(emptyScasState())
    expect(lookup.locked.size).toBe(0)
    expect(lookup.liveKicks.size).toBe(0)
    expect(lookup.immune.size).toBe(0)
  })
})

describe('isColoured', () => {
  it('returns true for a locked lemma', () => {
    const lookup = buildLookup(state({ locked: ['cat'] }))
    expect(isColoured(lookup, 'cat')).toBe(true)
  })

  it('returns true for a liveKick lemma', () => {
    const lookup = buildLookup(state({ liveKicks: ['dog'] }))
    expect(isColoured(lookup, 'dog')).toBe(true)
  })

  it('returns false for an ordinary word', () => {
    const lookup = buildLookup(state())
    expect(isColoured(lookup, 'cat')).toBe(false)
  })

  it('returns false for a word that is immune but not locked/liveKick', () => {
    const s = state({ version: 1, satisfied: [{ lemma: 'work', satisfiedAtVersion: 1 }] })
    const lookup = buildLookup(s)
    expect(isColoured(lookup, 'work')).toBe(false) // immune, not coloured
  })
})

describe('isSuppressedFromSuggestions', () => {
  it('suppresses locked lemmas', () => {
    expect(isSuppressedFromSuggestions(state({ locked: ['cat'] }), 'cat')).toBe(true)
  })

  it('does not suppress liveKick lemmas (only locked)', () => {
    expect(isSuppressedFromSuggestions(state({ liveKicks: ['dog'] }), 'dog')).toBe(false)
  })

  it('does not suppress ordinary words', () => {
    expect(isSuppressedFromSuggestions(state(), 'cat')).toBe(false)
  })
})

describe('DEFAULT_SET_SIZE', () => {
  it('is 300 (v4 spec §4.2 starting value)', () => {
    expect(DEFAULT_SET_SIZE).toBe(300)
  })
})
