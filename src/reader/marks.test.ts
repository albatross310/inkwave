import { describe, it, expect } from 'vitest'
import { locateMark, locateAll, markRuns, type ReaderMark, type Located } from './marks'

const mk = (o: Partial<ReaderMark> = {}): ReaderMark => ({
  id: 'm1', kind: 'highlight', color: '#ffe066', block: 1, start: 11,
  text: 'relative identity', createdAt: '2026-08-28T00:00:00Z', ...o,
})

const BLOCKS = ['Some opening prose.', 'Talk about relative identity in this block.', 'And a third.']

describe('locateMark', () => {
  it('finds a mark where it was left', () => {
    expect(locateMark(mk(), BLOCKS)).toMatchObject({ block: 1, start: 11, end: 28 })
  })

  it('re-finds it when the text SHIFTED inside its block (an edit above it)', () => {
    const edited = [...BLOCKS]
    edited[1] = 'Now with more words, talk about relative identity in this block.'
    const l = locateMark(mk(), edited)
    expect(l).not.toBeNull()
    expect(edited[1].slice(l!.start, l!.end)).toBe('relative identity')
  })

  it('re-finds it when the BLOCK moved (a section was inserted above)', () => {
    const shifted = ['A new intro.', ...BLOCKS]
    const l = locateMark(mk(), shifted)
    expect(l!.block).toBe(2)
    expect(shifted[l!.block].slice(l!.start, l!.end)).toBe('relative identity')
  })

  it('THE REFUSAL: text that is gone is ORPHANED, never re-placed at its old offset', () => {
    // A publisher rewrote the paragraph. Placing the highlight at offset 11 anyway would colour
    // words the reader never marked, and they would have no way to know.
    const rewritten = [...BLOCKS]
    rewritten[1] = 'A completely different sentence about something else entirely.'
    expect(locateMark(mk(), rewritten)).toBeNull()
  })

  it('prefers the REMEMBERED offset when the same phrase appears twice', () => {
    const dup = ['x', 'relative identity and later relative identity again', 'y']
    const l = locateMark(mk({ start: 28 }), dup)
    expect(l!.start).toBe(28)   // the second occurrence, not the first
    expect(dup[1].slice(l!.start, l!.end)).toBe('relative identity')
  })

  it('locateAll separates the placed from the orphaned', () => {
    const gone = mk({ id: 'm2', text: 'not in any block' })
    const { placed, orphaned } = locateAll([mk(), gone], BLOCKS)
    expect(placed.map((p) => p.id)).toEqual(['m1'])
    expect(orphaned.map((p) => p.id)).toEqual(['m2'])
  })
})

describe('markRuns', () => {
  const L = (start: number, end: number, id = 'a'): Located =>
    ({ ...mk({ id }), start, end } as Located)

  it('an unmarked block is one run', () => {
    expect(markRuns(20, [])).toEqual([{ from: 0, to: 20, marks: [] }])
  })

  it('cuts at every mark edge', () => {
    const runs = markRuns(20, [L(5, 10)])
    expect(runs.map((r) => [r.from, r.to])).toEqual([[0, 5], [5, 10], [10, 20]])
    expect(runs[1].marks.map((m) => m.id)).toEqual(['a'])
    expect(runs[0].marks).toEqual([])
  })

  it('OVERLAPPING marks both survive — a note inside a highlight', () => {
    // The obvious implementation (last one wins) loses one of them silently.
    const runs = markRuns(20, [L(2, 12, 'hl'), L(6, 8, 'note')])
    const both = runs.find((r) => r.marks.length === 2)
    expect(both).toBeDefined()
    expect(both!.marks.map((m) => m.id).sort()).toEqual(['hl', 'note'])
  })

  it('covers the block exactly, with no gaps and no overlaps', () => {
    const runs = markRuns(30, [L(0, 4, 'a'), L(10, 30, 'b'), L(12, 20, 'c')])
    expect(runs[0].from).toBe(0)
    expect(runs[runs.length - 1].to).toBe(30)
    for (let i = 1; i < runs.length; i++) expect(runs[i].from).toBe(runs[i - 1].to)
  })

  it('a mark spanning the whole block yields one run, not an empty tail', () => {
    const runs = markRuns(10, [L(0, 10)])
    expect(runs.length).toBe(1)
    expect(runs[0]).toMatchObject({ from: 0, to: 10 })
    expect(runs[0].marks.length).toBe(1)
  })
})
