// ─── The practice heatmap (§A2) ──────────────────────────────────────────────
//
// The claims that matter here are not "does it store a colour" — they are the ones that would
// quietly destroy the student's or the teacher's work: last-write-wins that erases history, an
// author boundary that doesn't hold, a range that silently covers nothing, and a provenance hash
// that changes when nothing changed (or fails to change when something did).

import { describe, expect, it } from 'vitest'
import {
  barsOfPiece, colourAt, erase, heatmapHash, historyAt, paint, recordHeatmapProvenance,
  HEATMAP_PALETTE,
} from './heatmap'
import { newPiece, type HeatmapEntry, type Piece } from './types'

const RED = '#c94f4f'
const GREEN = '#5aa469'

function emptyPiece(): Piece {
  return newPiece({ id: 'p1', title: 'T', source: { type: 'photo', captured_via: 'image' } })
}

/** Deterministic stamps/ids — a test that depends on the wall clock is a test that flakes. */
function stamper() {
  let n = 0
  return {
    now: () => `2026-07-17T10:0${n}:00.000+10:00`,
    id: () => `e${n}`,
    tick: () => { n++ },
  }
}

// ─── Addressing ──────────────────────────────────────────────────────────────

describe('bar addressing across a piece', () => {
  const page = (bars: Array<{ system: number; x: number }>) => ({
    image_ref: 'a.png', systems: [], bars: bars.map((b, i) => ({
      bar_index: i, system: b.system, region: { x: b.x, y: 0.1, w: 0.2, h: 0.1 },
    })),
  })

  it('numbers bars continuously ACROSS pages, in playing order', () => {
    // The join key must be rangeable over a page turn — "bars 1–3" spans the break here.
    const piece: Piece = {
      ...emptyPiece(),
      pages: [page([{ system: 0, x: 0.1 }, { system: 0, x: 0.5 }]), page([{ system: 0, x: 0.1 }])],
    }
    const bars = barsOfPiece(piece)
    expect(bars.map(b => b.bar_index)).toEqual([0, 1, 2])
    expect(bars.map(b => b.page)).toEqual([0, 0, 1])
  })

  it('orders by system then across the page, not by storage order', () => {
    // Bars arrive in detection order and a student taps more in later; playing order is the truth.
    const piece: Piece = {
      ...emptyPiece(),
      pages: [page([{ system: 1, x: 0.5 }, { system: 0, x: 0.5 }, { system: 0, x: 0.1 }])],
    }
    expect(barsOfPiece(piece).map(b => [b.system, b.region.x])).toEqual([[0, 0.1], [0, 0.5], [1, 0.5]])
  })

  it('a piece with no bar model yields no bars rather than throwing', () => {
    expect(barsOfPiece(emptyPiece())).toEqual([])
  })
})

// ─── Painting ────────────────────────────────────────────────────────────────

describe('painting a range', () => {
  it('colours every bar in the range, inclusive at both ends', () => {
    const s = stamper()
    const hm = paint([], { bars: [2, 4], colour: RED, author: 'student', ...s })
    for (const b of [2, 3, 4]) expect(colourAt(hm, b)?.colour).toBe(RED)
    expect(colourAt(hm, 1)).toBeNull()
    expect(colourAt(hm, 5)).toBeNull()
  })

  it('normalises a backwards sweep — a Pencil runs right-to-left too', () => {
    // Unnormalised, `colourAt` finds nothing between 4 and 2 and the stroke silently does nothing.
    const s = stamper()
    const hm = paint([], { bars: [4, 2], colour: RED, author: 'student', ...s })
    expect(hm[0].bars).toEqual([2, 4])
    expect(colourAt(hm, 3)?.colour).toBe(RED)
  })

  it('a single bar is a range of one', () => {
    const s = stamper()
    const hm = paint([], { bars: [7, 7], colour: RED, author: 'student', ...s })
    expect(colourAt(hm, 7)?.colour).toBe(RED)
  })

  it('never mutates the array it was given — entries are provenance material', () => {
    const s = stamper()
    const before: HeatmapEntry[] = []
    const after = paint(before, { bars: [0, 1], colour: RED, author: 'student', ...s })
    expect(before).toEqual([])
    expect(after).toHaveLength(1)
  })
})

// ─── The teacher, mid-lesson (§A2's whole point) ─────────────────────────────

describe('the teacher recolours mid-lesson', () => {
  it('the teacher’s later paint wins the display', () => {
    const s = stamper()
    let hm = paint([], { bars: [0, 9], colour: GREEN, author: 'student', ...s })
    s.tick()
    hm = paint(hm, { bars: [3, 6], colour: RED, label: 'your priority', author: 'teacher', ...s })

    expect(colourAt(hm, 4)?.colour).toBe(RED)
    expect(colourAt(hm, 4)?.author).toBe('teacher')
    expect(colourAt(hm, 4)?.label).toBe('your priority')
    expect(colourAt(hm, 1)?.colour).toBe(GREEN)   // outside the teacher's range, untouched
  })

  it('and it is captured AS the teacher’s, with a timestamp', () => {
    const s = stamper()
    const hm = paint([], { bars: [3, 6], colour: RED, author: 'teacher', ...s })
    expect(hm[0].author).toBe('teacher')
    expect(hm[0].ts).toMatch(/\+10:00$/)   // local offset, never a bare Z (§A9)
  })

  it('KEEPS what it covered — the record is over TIME, not a current state', () => {
    // §A2: "a timestamped record of how the student saw the piece over time". If a recolour deleted
    // what it covered, the anchored record would attest a history that had been quietly rewritten.
    const s = stamper()
    let hm = paint([], { bars: [0, 9], colour: GREEN, author: 'student', ...s })
    s.tick()
    hm = paint(hm, { bars: [3, 6], colour: RED, author: 'teacher', ...s })

    expect(hm).toHaveLength(2)
    const hist = historyAt(hm, 4)
    expect(hist.map(e => [e.author, e.colour])).toEqual([['student', GREEN], ['teacher', RED]])
  })
})

// ─── Erasing, and the author boundary ────────────────────────────────────────

describe('erase', () => {
  it('removes your own mark', () => {
    const s = stamper()
    const hm = paint([], { bars: [0, 2], colour: RED, author: 'student', ...s })
    const r = erase(hm, hm[0].id, 'student')
    expect(r.removed).toBe(true)
    expect(r.heatmap).toEqual([])
  })

  it('REFUSES to delete the teacher’s mark, and says whose it was', () => {
    // The teacher marks four bars on the student's iPad and hands it back. A stray erase must not
    // silently delete the lesson's main artifact.
    const s = stamper()
    const hm = paint([], { bars: [3, 6], colour: RED, author: 'teacher', ...s })
    const r = erase(hm, hm[0].id, 'student')
    expect(r.removed).toBe(false)
    expect(r.refusedAuthor).toBe('teacher')
    expect(r.heatmap).toHaveLength(1)   // still there
  })

  it('and the reverse: a teacher does not erase the student’s marks', () => {
    const s = stamper()
    const hm = paint([], { bars: [0, 2], colour: GREEN, author: 'student', ...s })
    expect(erase(hm, hm[0].id, 'teacher').removed).toBe(false)
  })

  it('an unknown id is a no-op, not a throw', () => {
    expect(erase([], 'nope', 'student')).toEqual({ heatmap: [], removed: false, refusedAuthor: null })
  })
})

// ─── Provenance ──────────────────────────────────────────────────────────────

describe('the provenance hash', () => {
  const entry = (over: Partial<HeatmapEntry> = {}): HeatmapEntry => ({
    id: 'a', bars: [1, 3], colour: RED, author: 'student', ts: '2026-07-17T10:00:00.000+10:00',
    ...over,
  })

  it('is stable for the same record', async () => {
    expect(await heatmapHash([entry()])).toBe(await heatmapHash([entry()]))
  })

  it('does NOT depend on array order — two devices legitimately differ', async () => {
    // A hash that moved with array order would report tampering when a sync merely arrived in a
    // different sequence. Sorting is what makes the anchor mean "this record", not "this array".
    const a = entry({ id: 'a', ts: '2026-07-17T10:00:00.000+10:00' })
    const b = entry({ id: 'b', ts: '2026-07-17T11:00:00.000+10:00' })
    expect(await heatmapHash([a, b])).toBe(await heatmapHash([b, a]))
  })

  // KNOWN-NEGATIVE: an anchored hash that cannot notice a change anchors nothing. Every field that
  // carries meaning must move it — proved field by field, because "the hash changed" on one field
  // says nothing about the others.
  it('KNOWN-NEGATIVE: it CHANGES when any part of the record changes', async () => {
    const base = await heatmapHash([entry()])
    const variants: Array<[string, HeatmapEntry]> = [
      ['colour', entry({ colour: GREEN })],
      ['range', entry({ bars: [1, 4] })],
      ['author', entry({ author: 'teacher' })],
      ['timestamp', entry({ ts: '2026-07-17T10:00:01.000+10:00' })],
      ['label', entry({ label: 'added' })],
      ['id', entry({ id: 'b' })],
    ]
    for (const [name, v] of variants) {
      expect(await heatmapHash([v]), `${name} must move the hash`).not.toBe(base)
    }
    // …and dropping an entry entirely must too.
    expect(await heatmapHash([])).not.toBe(base)
  })

  it('distinguishes a missing label from an empty one', async () => {
    expect(await heatmapHash([entry()])).not.toBe(await heatmapHash([entry({ label: '' })]))
  })

  it('folds into the Piece’s provenance record', async () => {
    const s = stamper()
    const piece: Piece = { ...emptyPiece(), heatmap: paint([], { bars: [0, 2], colour: RED, author: 'student', ...s }) }
    const next = await recordHeatmapProvenance(piece)
    expect(next.provenance.hashes.heatmap).toBe(await heatmapHash(piece.heatmap))
    expect(piece.provenance.hashes.heatmap).toBeUndefined()   // the input is not mutated
  })
})

// ─── The palette is not a scale ──────────────────────────────────────────────

describe('the palette', () => {
  it('carries no severity ordering the app could compute from', () => {
    // §A2: manual annotation, NOT an AI judgement — "nothing opaque to defend". A numeric level or
    // score on a swatch is exactly the field a later change would start averaging.
    for (const s of HEATMAP_PALETTE) {
      expect(Object.keys(s).sort()).toEqual(['colour', 'suggested'])
      expect(s.colour).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('a colour outside the palette is fine — §A2 says CUSTOM colours', () => {
    const s = stamper()
    const hm = paint([], { bars: [0, 0], colour: '#123456', author: 'student', ...s })
    expect(colourAt(hm, 0)?.colour).toBe('#123456')
  })
})
