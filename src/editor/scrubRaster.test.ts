// Pure-logic tests for the scrub raster layer (round 3): cache keys, nearest-bitmap fallback,
// and byte-budget eviction planning. The DOM capture path is exercised by browser probes.
import { describe, it, expect } from 'vitest'
import { rasterKey, pickNearest, planEviction, summariseRecord, type ScrubRecEntry } from './scrubRaster'

describe('rasterKey', () => {
  it('buckets by pane size, zoom and dpr', () => {
    expect(rasterKey('doc', 's1', 800.4, 600, 1, 2)).toBe('doc|s1|800x600|z1.000|d2.00')
    expect(rasterKey('diff', 's1', 800, 600, 1.25, 1)).toBe('diff|s1|800x600|z1.250|d1.00')
  })
  it('same snapshot at a different zoom is a different entry', () => {
    expect(rasterKey('doc', 's1', 800, 600, 1, 1)).not.toBe(rasterKey('doc', 's1', 800, 600, 1.1, 1))
  })
})

describe('pickNearest', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f']
  it('exact hit wins', () => {
    expect(pickNearest(order, ['a', 'c', 'f'], 'c')).toBe('c')
  })
  it('falls back to the nearest cached snapshot by order distance', () => {
    expect(pickNearest(order, ['a', 'f'], 'e')).toBe('f')
    expect(pickNearest(order, ['a', 'f'], 'b')).toBe('a')
  })
  it('unknown target never shows an arbitrary version', () => {
    expect(pickNearest(order, ['a', 'b'], 'zz')).toBeNull()
  })
  it('no candidates → null', () => {
    expect(pickNearest(order, [], 'c')).toBeNull()
  })
  it('candidates outside the order are ignored', () => {
    expect(pickNearest(order, ['ghost', 'd'], 'b')).toBe('d')
  })
})

describe('planEviction', () => {
  const item = (key: string, bytes: number, lastUsed: number, prot = false) =>
    ({ key, bytes, lastUsed, protected: prot })
  it('nothing over budget → nothing evicted', () => {
    expect(planEviction([item('a', 100, 1)], 0)).toEqual([])
    expect(planEviction([item('a', 100, 1)], -5)).toEqual([])
  })
  it('evicts least-recently-used first, only as much as needed', () => {
    const plan = planEviction([item('old', 100, 1), item('mid', 100, 2), item('new', 100, 3)], 150)
    expect(plan).toEqual(['old', 'mid'])
  })
  it('protected entries (scrub window) go last', () => {
    const plan = planEviction([item('win', 100, 1, true), item('far', 100, 2)], 100)
    expect(plan).toEqual(['far'])
  })
  it('takes protected entries only when unprotected cannot cover the deficit', () => {
    const plan = planEviction([item('win', 100, 1, true), item('far', 100, 2)], 200)
    expect(plan).toEqual(['far', 'win'])
  })
})

// ── summariseRecord — the burst RECORDER's verdict (round 10) ─────────────────────────────────
// The overlay repaints on the thread a scrub saturates, so its live numbers are an at-rest sample;
// the ring buffer is the real instrument and THIS is the roll-up both it and the harness read.
describe('summariseRecord', () => {
  const row = (
    t: number, pane: ScrubRecEntry['pane'], want: number, shown: number,
    src: ScrubRecEntry['src'], centre = 0, anchor = 0,
  ): ScrubRecEntry => ({ t, pane, want, shown, src, anchor, centre })

  it('empty burst reports nothing rather than dividing by zero', () => {
    const s = summariseRecord([])
    expect(s).toMatchObject({ presents: 0, commandedDistinct: 0, presentedDistinct: 0, spanMs: 0, perSec: 0 })
    expect(s.panes).toEqual([])
  })

  it('presents = rows / panes, and counts commanded vs presented versions', () => {
    const rows: ScrubRecEntry[] = []
    for (let i = 0; i < 4; i++) for (const p of ['doc', 'diff', 'map'] as const) rows.push(row(i * 16, p, i, i, 'hit'))
    const s = summariseRecord(rows)
    expect(s.presents).toBe(4)
    expect(s.commandedDistinct).toBe(4)
    expect(s.presentedDistinct).toBe(4)
  })

  it('exactRate counts hits AND hydrated thumbs as real, nearest/none as stale', () => {
    const s = summariseRecord([
      row(0, 'doc', 0, 0, 'hit'), row(1, 'doc', 1, 1, 'thumb'),
      row(2, 'doc', 2, 1, 'near'), row(3, 'doc', 3, -1, 'none'),
    ])
    expect(s.panes[0].exactRate).toBe(0.5)
  })

  it('REGISTRATION: content held under the line across version steps', () => {
    // Three steps to three different versions; the centre content survives two of them.
    const s = summariseRecord([
      row(0, 'doc', 0, 0, 'hit', 7), row(16, 'doc', 1, 1, 'hit', 7),
      row(32, 'doc', 2, 2, 'hit', 7), row(48, 'doc', 3, 3, 'hit', 9),
    ])
    expect(s.panes[0].centreSteps).toBe(3)
    expect(s.panes[0].registered).toBeCloseTo(2 / 3)
  })

  it('re-presenting the SAME version is not a step (it cannot misregister)', () => {
    const s = summariseRecord([
      row(0, 'doc', 0, 0, 'hit', 7), row(16, 'doc', 1, 0, 'near', 7), row(32, 'doc', 2, 1, 'hit', 9),
    ])
    expect(s.panes[0].centreSteps).toBe(1) // only 0→1 counted
  })

  it('registration is -1 (not 0) when no centre signature was recorded — unmeasured != unregistered', () => {
    const s = summariseRecord([row(0, 'doc', 0, 0, 'hit'), row(16, 'doc', 1, 1, 'hit')])
    expect(s.panes[0].registered).toBe(-1)
    expect(s.panes[0].centreSteps).toBe(0)
  })

  it('anchor drift averages the per-step scroll-offset jump', () => {
    const s = summariseRecord([
      row(0, 'doc', 0, 0, 'hit', 1, 100), row(16, 'doc', 1, 1, 'hit', 1, 140), row(32, 'doc', 2, 2, 'hit', 1, 120),
    ])
    expect(s.panes[0].anchorDriftPx).toBe(30) // |140-100| and |120-140| → (40+20)/2
  })

  it('rate is presents per second across the burst span', () => {
    const s = summariseRecord([row(0, 'doc', 0, 0, 'hit'), row(500, 'doc', 1, 1, 'hit')])
    expect(s.spanMs).toBe(500)
    expect(s.perSec).toBeCloseTo(4) // 2 presents / 0.5s
  })
})

// ── The eviction rule's SILENT SHORTFALL (2026-07-17) ────────────────────────────────────────
// Peter's `mem bitmaps 163 · 62.9MB and climbing` was read as a leak for a whole round. It is
// DESKTOP_BUDGET exactly (60 MiB = 62.9 decimal MB) — the cache filling to the cap and HOLDING.
// The real defect is that a genuine breach would look identical: `planEviction` walks both passes
// and then FALLS THROUGH with freed < over, returning a plan that silently under-delivers, and
// `enforceBudget` additionally refuses to evict anything still attached. These pin the shape of
// that shortfall so the caller's named `scrub.mem.overBudget` probe can never be quietly dropped.
describe('planEviction — the shortfall must be a fact the caller can see, not a surprise', () => {
  const item = (key: string, bytes: number, lastUsed: number, prot = false) => ({ key, bytes, lastUsed, protected: prot })

  it('under-delivers SILENTLY when nothing can cover `over` — the caller must re-check actual bytes', () => {
    // 3 items x 100 = 300 freed, but 10_000 is asked for. No throw, no signal — just a short plan.
    const plan = planEviction([item('a', 100, 1), item('b', 100, 2), item('c', 100, 3)], 10_000)
    const freed = plan.length * 100
    expect(plan).toHaveLength(3)
    expect(freed).toBeLessThan(10_000) // the budget stays broken and the plan says nothing about it
  })

  it('plans PROTECTED entries only after unprotected ones are exhausted', () => {
    const plan = planEviction([item('prot', 100, 1, true), item('free', 100, 2)], 150)
    expect(plan[0]).toBe('free') // unprotected first, despite being NEWER
    expect(plan).toContain('prot') // then protected, to try to reach `over`
  })

  it('counts bytes from entries the caller may REFUSE to evict (attached) — so the plan over-promises', () => {
    // enforceBudget skips `attached` entries. planEviction cannot know that and counts them freed.
    // This is exactly why the caller measures ACTUAL bytes afterwards rather than trusting `freed`.
    const plan = planEviction([item('attached', 5000, 1, true)], 4000)
    expect(plan).toEqual(['attached']) // promises 5000 freed…
    // …but if the caller skips it, 0 comes back and the budget is still broken.
  })

  it('evicts nothing when already under budget', () => {
    expect(planEviction([item('a', 100, 1)], 0)).toEqual([])
  })
})
