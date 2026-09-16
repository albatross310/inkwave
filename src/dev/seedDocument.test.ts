// The seed-history slicer is the one pure piece of "a seeded lane opens with ◈ N": every prefix
// must be a strict, growing prefix of the document, the full document is never among them (the
// caller commits the live one last), and a long seed is capped without ever repeating a length.
import { describe, it, expect } from 'vitest'
import { seedHistorySlices } from './seedDocument'
import type { TiptapJSON } from '../types/document'

const doc = (n: number): TiptapJSON => ({
  type: 'doc',
  content: Array.from({ length: n }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `p${i + 1}` }] })),
})

describe('seedHistorySlices', () => {
  it('yields nothing for 0 or 1 blocks', () => {
    expect(seedHistorySlices(doc(0))).toEqual([])
    expect(seedHistorySlices(doc(1))).toEqual([])
  })

  it('a short document yields every strict prefix, in order', () => {
    const out = seedHistorySlices(doc(4))
    expect(out.map((d) => d.content!.length)).toEqual([1, 2, 3])
    expect(out[1].content![1]).toEqual(doc(4).content![1]) // the same blocks, not copies re-authored
  })

  it('a long document is capped at maxSteps versions, lengths strictly increasing, full doc excluded', () => {
    const n = 21
    const out = seedHistorySlices(doc(n), 8)
    const lens = out.map((d) => d.content!.length)
    expect(lens.length).toBeLessThanOrEqual(7)
    expect(lens.every((l, i) => l > 0 && l < n && (i === 0 || l > lens[i - 1]))).toBe(true)
  })

  it('KNOWN-POSITIVE: the cap is real — uncapped, the same document yields n-1 prefixes', () => {
    expect(seedHistorySlices(doc(21), 100).length).toBe(20)
  })
})
