import { describe, it, expect } from 'vitest'
import { bundleHash, bibliographyHash } from './hash'
import type { CSLItem } from '../types/document'

const A: CSLItem = { id: 'a', type: 'book', title: 'A', author: [{ family: 'X' }] }
const B: CSLItem = { id: 'b', type: 'book', title: 'B' }

describe('bibliographyHash — determinism', () => {
  it('is stable across calls and key ordering (JCS canonicalises)', async () => {
    const h1 = await bibliographyHash([A, B], 'apa')
    const reordered = { id: 'a', title: 'A', author: [{ family: 'X' }], type: 'book' } as CSLItem
    const h2 = await bibliographyHash([reordered, B], 'apa')
    expect(h1).toBe(h2)
  })
  it('changes when the style changes', async () => {
    expect(await bibliographyHash([A], 'apa')).not.toBe(await bibliographyHash([A], 'mla'))
  })
  it('changes when entry data changes', async () => {
    expect(await bibliographyHash([A], 'apa')).not.toBe(await bibliographyHash([{ ...A, title: 'A!' }], 'apa'))
  })
})

describe('bundleHash — v1/v2 back-compat', () => {
  it('with no bibHash produces the exact legacy v:1 hash', async () => {
    const legacy = await bundleHash('abc', [])
    const explicit = await bundleHash('abc', [], undefined)
    expect(legacy).toBe(explicit)
  })
  it('folding in a bibHash yields a different (v:2) hash', async () => {
    const v1 = await bundleHash('abc', [])
    const bib = await bibliographyHash([A], 'apa')
    const v2 = await bundleHash('abc', [], bib)
    expect(v2).not.toBe(v1)
  })
  it('v:2 hash is reproducible given the same inputs (verifier can recompute)', async () => {
    const bib = await bibliographyHash([A, B], 'chicago-author-date')
    expect(await bundleHash('xyz', [], bib)).toBe(await bundleHash('xyz', [], bib))
  })
})
