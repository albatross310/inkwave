import { describe, it, expect } from 'vitest'
import { computeAnalytics } from './analytics'
import type { ExportBundle } from '../provenance/bundle'

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

const bundle = {
  v: 1,
  document: { id: 'd', title: 't', contentJson: doc('alpha gamma delta epsilon') },
  snapshots: [
    { id: 's1', documentId: 'd', createdAt: '2026-06-17T00:00:10.000Z', trigger: 'word-nudge', wordCount: 3, contentHash: '', contentJson: doc('alpha beta gamma'), bundleHash: '', ots: { status: 'confirmed' } },
    { id: 's2', documentId: 'd', createdAt: '2026-06-17T00:00:20.000Z', trigger: 'manual', wordCount: 4, contentHash: '', contentJson: doc('alpha gamma delta epsilon'), bundleHash: '', ots: { status: 'confirmed' } },
  ],
  receipts: [
    { v: 1, sessionToken: 'A', counter: 0, prevHash: '', contentHash: '', setVersion: 0, lockedSetHash: '', serverTime: '2026-06-17T00:00:15.000Z', signature: '', lockedSet: '',
      kicks: [{ lemma: 'big', commitIndex: 0, setVersion: 0, trigger: 'in-S', response: 'swapped', replacement: 'large', deliberationMs: 2000 }] },
    { v: 1, sessionToken: 'A', counter: 1, prevHash: '', contentHash: '', setVersion: 0, lockedSetHash: '', serverTime: '2026-06-17T00:00:20.000Z', signature: '', lockedSet: '',
      kicks: [{ lemma: 'cat', commitIndex: 1, setVersion: 0, trigger: 'in-S', response: 'dismissed', deliberationMs: 500 }] },
  ],
} as unknown as ExportBundle

describe('computeAnalytics', () => {
  const a = computeAnalytics(bundle)

  it('computes added/deleted words as a lower bound from snapshot diffs', () => {
    // s1: ''→'alpha beta gamma'  = +3, -0 ; s2: 'alpha beta gamma'→'alpha gamma delta epsilon' = +2 (delta,epsilon), -1 (beta)
    expect(a.intervals.map((b) => [b.added, b.removed])).toEqual([[3, 0], [2, 1]])
    expect(a.stats.addedWords).toBe(5)
    expect(a.stats.deletedWords).toBe(1)
    expect(a.stats.churn).toBe(0.2)
    expect(a.stats.finalWords).toBe(4)
  })

  it('counts word nudges, swaps and snapshots from receipts', () => {
    expect(a.stats.totalNudges).toBe(2)
    expect(a.stats.swaps).toBe(1)
    expect(a.stats.nudgesByResponse).toEqual({ swapped: 1, dismissed: 1 })
    expect(a.stats.snapshots).toBe(2)
    expect(a.stats.sessions).toBe(1)
    expect(a.stats.periods).toBe(2)
    expect(a.nudges.map((k) => `${k.old}->${k.replacement ?? ''}`)).toEqual(['big->large', 'cat->'])
  })

  it('derives duration, deliberation and the words timeline', () => {
    expect(a.stats.avgDeliberationMs).toBe(1250)
    expect(a.stats.durationMs).toBe(10_000)
    expect(a.words[0]).toEqual({ t: a.tMin, words: 0 })
    expect(a.words.at(-1)).toMatchObject({ words: 4 })
  })
})
