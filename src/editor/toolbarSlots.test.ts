import { describe, it, expect } from 'vitest'
import { moveSlot, neighborShift, nearestSlot, brokeHoldSlop, HOLD_SLOP_PX } from './toolbarSlots'

const ORDER = ['bib', 'guide', 'math', 'receipt'] as const

describe('moveSlot', () => {
  it('adjacent move is a swap', () => {
    expect(moveSlot(ORDER, 0, 1)).toEqual(['guide', 'bib', 'math', 'receipt'])
    expect(moveSlot(ORDER, 3, 2)).toEqual(['bib', 'guide', 'receipt', 'math'])
  })
  it('long move inserts and pushes the crossed neighbours toward the origin', () => {
    expect(moveSlot(ORDER, 0, 2)).toEqual(['guide', 'math', 'bib', 'receipt'])
    expect(moveSlot(ORDER, 3, 0)).toEqual(['receipt', 'bib', 'guide', 'math'])
  })
  it('no-op for same index or out-of-range', () => {
    expect(moveSlot(ORDER, 1, 1)).toEqual([...ORDER])
    expect(moveSlot(ORDER, -1, 2)).toEqual([...ORDER])
    expect(moveSlot(ORDER, 1, 4)).toEqual([...ORDER])
  })
})

describe('neighborShift', () => {
  it('matches the committed order exactly (preview ≡ result, every from/over pair)', () => {
    for (let from = 0; from < 4; from++) {
      for (let over = 0; over < 4; over++) {
        const committed = moveSlot(ORDER, from, over)
        for (let j = 0; j < 4; j++) {
          if (j === from) continue
          const previewIdx = j + neighborShift(j, from, over)
          // The neighbour previews at the slot it will occupy after the commit.
          expect(committed[previewIdx]).toBe(ORDER[j])
        }
      }
    }
  })
  it('the dragged slot never shifts', () => {
    expect(neighborShift(2, 2, 0)).toBe(0)
  })
})

describe('nearestSlot', () => {
  const centers = [20, 60, 100, 140] // 40px pitch
  it('returns the origin before any midpoint is crossed', () => {
    expect(nearestSlot(centers, 20 + 19)).toBe(0)
  })
  it('retargets when the neighbour midpoint is crossed', () => {
    expect(nearestSlot(centers, 20 + 21)).toBe(1)
    expect(nearestSlot(centers, 105)).toBe(2)
  })
  it('clamps beyond the ends', () => {
    expect(nearestSlot(centers, -500)).toBe(0)
    expect(nearestSlot(centers, 500)).toBe(3)
  })
})

// ─── The hold-to-arm slop rule ───────────────────────────────────────────────
// Both toolbar drags cancel a pending hold when the finger moves first. They had a copy each with a
// bare `10`; these pin the shared rule so the two gestures cannot drift apart, which is the whole
// reason it was lifted.
describe('brokeHoldSlop', () => {
  it('stillness does not break the hold', () => {
    expect(brokeHoldSlop(0, 0)).toBe(false)
  })

  it('is inclusive at the threshold — exactly 10px is still a hold', () => {
    // Strict `>`: a finger resting with 10px of jitter must still arm, or the gesture feels broken
    // on anyone whose hand is not perfectly steady.
    expect(brokeHoldSlop(HOLD_SLOP_PX, 0)).toBe(false)
    expect(brokeHoldSlop(0, HOLD_SLOP_PX)).toBe(false)
    expect(brokeHoldSlop(HOLD_SLOP_PX + 1, 0)).toBe(true)
  })

  it('treats BOTH axes alike — the row drag is horizontal, the drop-up drag is 2D', () => {
    // What it detects is "the finger is going somewhere", not "going the wrong way", so a purely
    // vertical slide must cancel the row drag too.
    expect(brokeHoldSlop(0, 40)).toBe(true)
    expect(brokeHoldSlop(40, 0)).toBe(true)
  })

  it('is sign-agnostic', () => {
    expect(brokeHoldSlop(-40, 0)).toBe(true)
    expect(brokeHoldSlop(0, -40)).toBe(true)
  })

  it('neither axis alone can mask the other', () => {
    expect(brokeHoldSlop(-40, 2)).toBe(true)
    expect(brokeHoldSlop(2, -40)).toBe(true)
  })
})
