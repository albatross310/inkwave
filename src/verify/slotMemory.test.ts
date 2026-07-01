import { describe, it, expect } from 'vitest'
import { extractSlotMemory } from './slotMemory'
import type { TiptapJSON } from '../types/document'

function makeDoc(slots: { text: string; attrs: Record<string, unknown> }[]): TiptapJSON {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: slots.map(s => ({
        type: 'text',
        text: s.text,
        marks: [{ type: 'scasSlot', attrs: s.attrs }],
      })),
    }],
  }
}

describe('extractSlotMemory', () => {
  it('returns empty for a doc with no slots', () => {
    const m = extractSlotMemory({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] })
    expect(m.total).toBe(0)
    expect(m.slots).toHaveLength(0)
  })

  it('extracts a single changed slot', () => {
    const t0 = '2026-07-01T10:00:00.000Z'
    const t1 = '2026-07-01T10:00:15.000Z'
    const doc = makeDoc([{
      text: 'large',
      attrs: { original: 'big', firstWord: 'large', kickedAt: t0, firstCommitAt: t1, lastCommitAt: t1, history: ['large'], changes: 1, locked: false },
    }])
    const m = extractSlotMemory(doc)
    expect(m.total).toBe(1)
    expect(m.changed).toBe(1)
    expect(m.acceptedOriginal).toBe(0)
    expect(m.slots[0].original).toBe('big')
    expect(m.slots[0].finalWord).toBe('large')
    expect(m.slots[0].changes).toBe(1)
    expect(m.avgFirstCommitMs).toBe(15000)
  })

  it('counts a justified/dismissed slot as acceptedOriginal', () => {
    const doc = makeDoc([{
      text: 'cat',
      attrs: { original: 'cat', firstWord: 'cat', firstCommitAt: null, history: null, changes: 0, locked: false },
    }])
    const m = extractSlotMemory(doc)
    expect(m.acceptedOriginal).toBe(1)
    expect(m.changed).toBe(0)
  })

  it('deduplicates slots by original, keeping last occurrence', () => {
    const doc: TiptapJSON = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'feline', marks: [{ type: 'scasSlot', attrs: { original: 'cat', changes: 1, history: ['feline'], locked: false } }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'creature', marks: [{ type: 'scasSlot', attrs: { original: 'cat', changes: 2, history: ['feline', 'creature'], locked: false } }] },
        ],
      }],
    }
    const m = extractSlotMemory(doc)
    expect(m.total).toBe(1)
    expect(m.slots[0].finalWord).toBe('creature')
    expect(m.slots[0].changes).toBe(2)
  })

  it('recognises locked slots', () => {
    const doc = makeDoc([{
      text: 'large',
      attrs: { original: 'big', firstWord: 'large', changes: 1, locked: true },
    }])
    const m = extractSlotMemory(doc)
    expect(m.locked).toBe(1)
    expect(m.slots[0].locked).toBe(true)
  })

  it('handles missing timing fields gracefully', () => {
    const doc = makeDoc([{
      text: 'large',
      attrs: { original: 'big', firstWord: 'large', changes: 1 },
    }])
    const m = extractSlotMemory(doc)
    expect(m.avgFirstCommitMs).toBeNull()
    expect(m.slots[0].kickedAt).toBeNull()
    expect(m.slots[0].firstCommitAt).toBeNull()
  })
})
