import { describe, it, expect } from 'vitest'
import { computeAnalytics } from './analytics'
import type { ExportBundle } from '../provenance/bundle'

const bundle = {
  v: 1,
  document: { id: 'd', title: 't', contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world foo' }] }] } },
  snapshots: [
    { id: 's1', documentId: 'd', createdAt: '2026-06-17T00:00:10.000Z', trigger: 'kick', wordCount: 3, contentHash: '', contentJson: {}, bundleHash: '', ots: { status: 'confirmed' } },
    { id: 's2', documentId: 'd', createdAt: '2026-06-17T00:00:20.000Z', trigger: 'manual', wordCount: 8, contentHash: '', contentJson: {}, bundleHash: '', ots: { status: 'confirmed' } },
  ],
  receipts: [
    { v: 1, sessionToken: 'A', counter: 0, prevHash: '', contentHash: '', setVersion: 0, lockedSetHash: '', serverTime: '2026-06-17T00:00:15.000Z', signature: '', lockedSet: '',
      kicks: [{ lemma: 'big', commitIndex: 0, setVersion: 0, trigger: 'in-S', response: 'swapped', replacement: 'large', deliberationMs: 2000 }],
      cadence: [{ ins: 20, del: 2 }, { ins: 300, del: 0 }] },
    { v: 1, sessionToken: 'A', counter: 1, prevHash: '', contentHash: '', setVersion: 0, lockedSetHash: '', serverTime: '2026-06-17T00:00:20.000Z', signature: '', lockedSet: '',
      kicks: [{ lemma: 'cat', commitIndex: 1, setVersion: 0, trigger: 'in-S', response: 'dismissed', deliberationMs: 500 }],
      cadence: [{ ins: 40, del: 10 }] },
  ],
} as unknown as ExportBundle

describe('computeAnalytics', () => {
  const a = computeAnalytics(bundle)

  it('sums cadence chars and flags paste bins', () => {
    expect(a.stats.charsInserted).toBe(360)
    expect(a.stats.charsDeleted).toBe(12)
    expect(a.stats.pasteSuspectBins).toBe(1) // the 300-char bin > 120
    expect(a.stats.bins).toBe(3)
    expect(a.stats.hasCadence).toBe(true)
  })

  it('counts kicks, swaps and snapshots', () => {
    expect(a.stats.totalKicks).toBe(2)
    expect(a.stats.swaps).toBe(1)
    expect(a.stats.kicksByResponse).toEqual({ swapped: 1, dismissed: 1 })
    expect(a.stats.snapshots).toBe(2)
    expect(a.stats.sessions).toBe(1)
    expect(a.stats.periods).toBe(2)
    expect(a.kicks.map((k) => `${k.old}->${k.replacement ?? ''}`)).toEqual(['big->large', 'cat->'])
  })

  it('derives final words, duration and deliberation', () => {
    expect(a.stats.finalWords).toBe(8) // last snapshot
    expect(a.stats.avgDeliberationMs).toBe(1250)
    expect(a.stats.durationMs).toBe(10_000) // 00:00:10 → 00:00:20
    expect(a.words[0]).toEqual({ t: a.tMin, words: 0 })
    expect(a.words.at(-1)).toMatchObject({ words: 8 })
  })
})
