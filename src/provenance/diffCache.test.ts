import { describe, it, expect } from 'vitest'
import { opsBetween, peekOpsBetween, displayTextOf } from './diffCache'
import type { Snapshot } from '../types/document'

// WHY THIS FILE EXISTS (2026-07-17). The /snapshot header badges are painted by the rAF flipbook
// driver, i.e. ON THE INPUT PATH at up to 60fps. That is only affordable because
// `peekOpsBetween` is CACHE-ONLY: it never runs the word diff (an LCS over two whole documents).
// The browser probe that established this (scripts/scrub-probe/probe-badges.mjs) needs a build, a
// server and a real burst — so it proves the claim ONCE and cannot keep it. If someone later adds
// an innocent-looking `?? opsBetween(prev, cur)` fallback here, every gesture silently starts
// computing an LCS per step, the probe is not in CI, and the gate stays green.
// These tests are that claim's keeper: they run in milliseconds with no browser, and the first one
// fails the instant `peek` learns to compute.

let n = 0
const snap = (text: string): Snapshot => ({
  id: `dc-${++n}`,
  createdAt: new Date().toISOString(),
  contentHash: `hash-${n}`,
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
} as unknown as Snapshot)

describe('peekOpsBetween — the input path\'s cache-only read', () => {
  it('returns null for an UNCACHED pair rather than computing it', () => {
    // The load-bearing assertion. A fallback-to-compute implementation returns ops here.
    const a = snap('alpha beta gamma delta'), b = snap('alpha beta gamma epsilon')
    expect(peekOpsBetween(a, b)).toBeNull()
  })

  it('does not POPULATE the cache as a side effect (a peek must not warm anything)', () => {
    const a = snap('one two three four'), b = snap('one two three five')
    expect(peekOpsBetween(a, b)).toBeNull()
    expect(peekOpsBetween(a, b)).toBeNull() // still cold — the first peek computed nothing
  })

  it('returns the SAME array opsBetween cached — it reads the panes\' cache, not a copy', () => {
    const a = snap('the quick brown fox'), b = snap('the quick red fox')
    const computed = opsBetween(a, b)
    expect(computed).not.toBeNull()
    expect(peekOpsBetween(a, b)).toBe(computed) // identity, not deep-equality
  })

  it('returns null when there is no previous snapshot', () => {
    expect(peekOpsBetween(null, snap('anything at all'))).toBeNull()
  })

  it('keys on snapshot IDS, not content — identical text under new ids is a cache MISS', () => {
    // Indices shift when a snapshot arrives; ids do not. Two distinct pairs that happen to hold
    // the same words must not answer for each other.
    const a = snap('shared identical wording here'), b = snap('shared identical wording there')
    opsBetween(a, b)
    const c = snap('shared identical wording here'), d = snap('shared identical wording there')
    expect(displayTextOf(c)).toBe(displayTextOf(a)) // same content…
    expect(peekOpsBetween(c, d)).toBeNull()         // …different pair, so: miss, not a wrong answer
  })

  it('a cached pair peeks to the same stats the badges would show', () => {
    const a = snap('keep keep keep removed'), b = snap('keep keep keep added')
    opsBetween(a, b)
    const ops = peekOpsBetween(a, b)
    expect(ops).not.toBeNull()
    expect(ops!.some((o) => o.type === 'add')).toBe(true)
    expect(ops!.some((o) => o.type === 'del')).toBe(true)
  })
})
