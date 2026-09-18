import { describe, expect, it } from 'vitest'
import { EditBatcher, PARA_RANGE_LIMIT, SMALL_EDIT_CHAR_BUDGET } from './editBatcher'

describe('EditBatcher', () => {
  it('starts empty and does not flush', () => {
    const b = new EditBatcher()
    expect(b.isEmpty).toBe(true)
    expect(b.flushReason()).toBeNull()
  })

  it('accumulates inserted and deleted characters and touched paragraphs', () => {
    const b = new EditBatcher()
    b.record(3, 1, [2])
    b.record(0, 2, [2, 4])
    expect(b.pending.chars).toBe(6)
    expect([...b.pending.paragraphs].sort()).toEqual([2, 4])
    expect(b.isEmpty).toBe(false)
  })

  it('flushes on the character budget', () => {
    const b = new EditBatcher()
    b.record(SMALL_EDIT_CHAR_BUDGET - 1, 0, [0])
    expect(b.flushReason()).toBeNull()
    b.record(1, 0, [0])
    expect(b.flushReason()).toBe('chars')
  })

  it('counts deletions toward the budget', () => {
    const b = new EditBatcher()
    b.record(0, SMALL_EDIT_CHAR_BUDGET, [1])
    expect(b.flushReason()).toBe('chars')
  })

  it('flushes when more than PARA_RANGE_LIMIT distinct paragraphs are touched', () => {
    const b = new EditBatcher()
    for (let i = 0; i < PARA_RANGE_LIMIT; i++) b.record(1, 0, [i])
    expect(b.flushReason()).toBeNull()
    b.record(1, 0, [PARA_RANGE_LIMIT])
    expect(b.flushReason()).toBe('range')
  })

  it('does not double-count the same paragraph', () => {
    const b = new EditBatcher()
    for (let i = 0; i < 50; i++) b.record(1, 0, [3])
    expect(b.pending.paragraphs.size).toBe(1)
    expect(b.flushReason()).toBeNull()
  })

  it('reset empties the pending set', () => {
    const b = new EditBatcher()
    b.record(500, 0, [0, 1, 2, 3, 4, 5, 6])
    b.reset()
    expect(b.isEmpty).toBe(true)
    expect(b.flushReason()).toBeNull()
  })

  it('honours custom thresholds', () => {
    const b = new EditBatcher(10, 1)
    b.record(5, 0, [0])
    expect(b.flushReason()).toBeNull()
    b.record(0, 0, [1])
    expect(b.flushReason()).toBe('range')
  })
})
