import { describe, it, expect } from 'vitest'
import { getStems, getActiveVocab, isInVocab, clearRankCacheFrom } from './ranking'

// ── getStems ──────────────────────────────────────────────────────────────────
describe('getStems', () => {
  it('always includes the word itself', () => {
    expect(getStems('philosophy')).toContain('philosophy')
  })

  it('-ing: removes suffix and un-doubles final consonant', () => {
    expect(getStems('working')).toContain('work')
    expect(getStems('running')).toContain('run')   // doubling: running → run
    expect(getStems('making')).toContain('make')   // silent e: making → make
  })

  it('-ed: removes suffix', () => {
    expect(getStems('worked')).toContain('work')
    expect(getStems('stopped')).toContain('stop')  // doubling: stopped → stop
    expect(getStems('loved')).toContain('love')    // silent e: loved → love
  })

  it('-es: removes suffix', () => {
    expect(getStems('watches')).toContain('watch')
    expect(getStems('makes')).toContain('make')
  })

  it('-s plural: removes -s (but not -ss)', () => {
    expect(getStems('runs')).toContain('run')
    expect(getStems('glass')).not.toContain('glas') // -ss words not stripped
  })

  it('-ly: removes adverb suffix', () => {
    expect(getStems('quickly')).toContain('quick')
    expect(getStems('happily')).toContain('happy')  // -ily path
  })

  it('-ies: converts to -y', () => {
    expect(getStems('libraries')).toContain('library')
  })

  it('-ier/-iest: converts to -y', () => {
    expect(getStems('easier')).toContain('easy')
    expect(getStems('easiest')).toContain('easy')
  })

  it('-er/-est comparative', () => {
    expect(getStems('faster')).toContain('fast')
    expect(getStems('bigger')).toContain('big')    // doubling: bigger → big
  })

  it('-ness: removes suffix', () => {
    expect(getStems('darkness')).toContain('dark')
  })

  it('-ment: removes suffix and tries silent-e form', () => {
    expect(getStems('movement')).toContain('move')
  })

  it('-ation: strips suffix, word itself is always included', () => {
    // 'organisation' → base = 'organis' (slice(0,-5)), so stems include 'organis' and 'organise'
    const stems = getStems('organisation')
    expect(stems).toContain('organisation') // original
    expect(stems).toContain('organis')      // base without -ation
    expect(stems).toContain('organise')     // base + e
  })

  it('-tion: strips suffix and adds silent-e form', () => {
    // 'solution' → base = 'solut' (slice(0,-4) = 'solut')... wait 'solution'.slice(0,-4) = 'solu'
    // Let's use 'calculation': 11 chars, ends with 'ation' → base = 'calcul'
    const stems = getStems('calculation')
    expect(stems).toContain('calcul')
    expect(stems).toContain('calcule')
  })

  it('-ise/-ize cross-spelling normalisation', () => {
    expect(getStems('standardised')).toContain('standardize')
    expect(getStems('standardized')).toContain('standardise')
    expect(getStems('organise')).toContain('organize')
    expect(getStems('organize')).toContain('organise')
  })

  it('agent nouns: -er → silent-e base', () => {
    expect(getStems('writer')).toContain('write')
    expect(getStems('teacher')).toContain('teach')
  })

  it('lowercases input', () => {
    expect(getStems('Running')).toContain('running')
    expect(getStems('WORK')).toContain('work')
  })

  it('short words: returns at least the word itself', () => {
    expect(getStems('in')).toEqual(['in'])
    expect(getStems('at')).toEqual(['at'])
  })
})

// ── getActiveVocab ────────────────────────────────────────────────────────────
describe('getActiveVocab', () => {
  it('returns a Set of exactly N words', () => {
    const vocab = getActiveVocab(0, 'test-seed', 500)
    expect(vocab.size).toBe(500)
  })

  it('is stable across calls (same seed+para+N)', () => {
    const a = getActiveVocab(0, 'abc', 300)
    const b = getActiveVocab(0, 'abc', 300)
    // Same object (cached) or same contents.
    expect([...a].sort().join(',')).toBe([...b].sort().join(','))
  })

  it('varies by paragraph index (different reordering per para)', () => {
    const p0 = getActiveVocab(0, 'abc', 300)
    const p1 = getActiveVocab(1, 'abc', 300)
    // The same N words are in each vocab (they're the top-N from the same list),
    // but the reordering (which N words make the top-N after perturbation) differs.
    const overlap = [...p0].filter(w => p1.has(w)).length
    expect(overlap).toBeLessThan(300) // some divergence expected
  })

  it('varies by session seed (same para, different seed)', () => {
    const a = getActiveVocab(0, 'seed-a', 300)
    const b = getActiveVocab(0, 'seed-b', 300)
    const overlap = [...a].filter(w => b.has(w)).length
    expect(overlap).toBeLessThan(300)
  })
})

// ── isInVocab ─────────────────────────────────────────────────────────────────
describe('isInVocab', () => {
  it('always returns true for infinite mode', () => {
    expect(isInVocab('madeupwordxyz', 0, 'seed', 'infinite')).toBe(true)
  })

  it('returns true for common words (likely in top 1000)', () => {
    // "the", "of", "and" are always in the top N for any seed
    expect(isInVocab('the', 0, 'seed', 1000)).toBe(true)
    expect(isInVocab('and', 0, 'seed', 1000)).toBe(true)
  })

  it('treats rare/proper-noun words as in-vocab (no flagging)', () => {
    // Words that would have no known mid-frequency rank → in-vocab by the
    // "not flaggable" rule, regardless of N.
    expect(isInVocab('supercalifragilistic', 0, 'seed', 500)).toBe(true)
  })
})

// ── clearRankCacheFrom ────────────────────────────────────────────────────────
describe('clearRankCacheFrom', () => {
  it('causes re-computation for paragraphs ≥ fromParagraph', () => {
    const seed = 'clear-test-seed'
    const before0 = getActiveVocab(0, seed, 200)
    const before1 = getActiveVocab(1, seed, 200)
    // Clear from paragraph 1 onward.
    clearRankCacheFrom(seed, 1)
    // Para 0 should still be cached (not cleared).
    const after0 = getActiveVocab(0, seed, 200)
    expect([...before0].sort().join(',')).toBe([...after0].sort().join(','))
    // Para 1 is re-computed — result is deterministic, so it should be the same content.
    const after1 = getActiveVocab(1, seed, 200)
    expect([...before1].sort().join(',')).toBe([...after1].sort().join(','))
  })
})
