// Grow-only snapshot merge — the invariant that provenance history can never SHRINK on write-back.
// Regression guard for the 2026-07-05 incident where an unconditional sync/save overwrite truncated
// the archived snapshot history whenever the local OPFS set was momentarily short (fresh login /
// cleared data / a sync racing ahead of restore).

import { describe, it, expect } from 'vitest'
import { mergeSnapshots } from './snapshots'
import type { Snapshot, SignedReceipt } from '../types/document'

function snap(id: string, createdAt: string, receipts = 0): Snapshot {
  return {
    id,
    documentId: 'doc',
    createdAt,
    trigger: 'word-nudge',
    wordCount: 100,
    contentHash: `hash-${id}`,
    contentJson: { type: 'doc', content: [] } as Snapshot['contentJson'],
    bundleHash: `bundle-${id}`,
    ots: { status: 'unstamped' },
    ...(receipts ? { receipts: Array.from({ length: receipts }, () => ({}) as SignedReceipt) } : {}),
  }
}

describe('mergeSnapshots (grow-only)', () => {
  it('unions two disjoint sets and keeps them ordered by createdAt', () => {
    const a = [snap('1', '2026-07-05T07:00:00Z'), snap('2', '2026-07-05T08:00:00Z')]
    const b = [snap('3', '2026-07-05T07:30:00Z')]
    const out = mergeSnapshots(a, b)
    expect(out.map((s) => s.id)).toEqual(['1', '3', '2'])
  })

  it('never shrinks: merging a SHORT set into a long file returns the full history', () => {
    const file = ['1', '2', '3', '4', '5'].map((n, i) => snap(n, `2026-07-05T0${i}:00:00Z`))
    const shortLocal = [snap('6', '2026-07-05T09:00:00Z')] // fresh OPFS with only the newest
    const out = mergeSnapshots(file, shortLocal)
    expect(out).toHaveLength(6)
    expect(out.map((s) => s.id)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('dedupes by id (no duplicates when the same snapshot is in both lists)', () => {
    const a = [snap('1', '2026-07-05T07:00:00Z'), snap('2', '2026-07-05T08:00:00Z')]
    const b = [snap('2', '2026-07-05T08:00:00Z'), snap('3', '2026-07-05T09:00:00Z')]
    const out = mergeSnapshots(a, b)
    expect(out.map((s) => s.id)).toEqual(['1', '2', '3'])
  })

  it('on an id clash keeps the richer copy (more signed receipts = more evidence)', () => {
    const poor = [snap('1', '2026-07-05T07:00:00Z', 2)]
    const rich = [snap('1', '2026-07-05T07:00:00Z', 40)]
    expect(mergeSnapshots(poor, rich)[0].receipts).toHaveLength(40)
    expect(mergeSnapshots(rich, poor)[0].receipts).toHaveLength(40) // order-independent
  })

  it('tolerates empty / malformed input without throwing', () => {
    expect(mergeSnapshots([], [])).toEqual([])
    expect(mergeSnapshots([snap('1', '2026-07-05T07:00:00Z')], [])).toHaveLength(1)
    // @ts-expect-error — defend against a junk entry slipping through
    expect(mergeSnapshots([snap('1', '2026-07-05T07:00:00Z'), null, undefined], [])).toHaveLength(1)
  })
})
