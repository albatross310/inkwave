import { describe, it, expect } from 'vitest'
import { paginate, type SplitLine } from './arithmeticLayout'

// ── The orphan-snap drift (found 2026-07-16 by the textRender pixel diff) ─────────────────────
// arithmeticLayout.paginate() still snaps small orphans to the block start; PaginationExtension
// .computeBreaks retired that rule (`const snap = false`). A consumer that takes paginate's default
// therefore paginates DIFFERENTLY from the editor it is supposed to mirror — measured on a real
// 4k-word doc in the live app: first break at 2141 vs the editor's 2403, 17 pages vs 16.
//
// These tests pin BOTH behaviours so the divergence can never again be silent: the legacy default is
// asserted (so existing callers stay byte-identical) AND the production rule is asserted (so the
// text renderer keeps matching the editor). If someone reconciles the default later, the second test
// is the one that must keep passing.
describe('paginate — orphan snap vs production', () => {
  // 40 lines at 30px. Page 1000px, topMargin 100, bottomMargin 72 (MARGIN_BOTTOM_PX) ⇒ textArea 828.
  // Lines 0-24 are block 0; lines 25+ are block 1 — so block 1 has only a 2-line orphan (60px, well
  // under the 22% × 828 = 182px snap threshold) on the page when line 27 overflows.
  const lines: SplitLine[] = Array.from({ length: 40 }, (_, i) => ({
    top: i * 30,
    blockIdx: i < 25 ? 0 : 1,
    pos: i < 25 ? 10 + i : 100 + i,
  }))
  const blocks = [{ start: 1 }, { start: 99 }]

  it('LEGACY default snaps the orphan back to the block start', () => {
    const res = paginate(lines, blocks, -1, 1000, 100)
    expect(res.breaks[0].at).toBe(99) // block 1's start — the whole paragraph moves to page 2
  })

  it('PRODUCTION rule (snapOrphans=false) breaks mid-block at the overflowing line', () => {
    const res = paginate(lines, blocks, -1, 1000, 100, false)
    expect(res.breaks[0].at).toBe(127) // lines[27].pos — the page fills, the paragraph straddles
  })

  it('the two rules genuinely disagree (the drift is real, not cosmetic)', () => {
    const legacy = paginate(lines, blocks, -1, 1000, 100)
    const production = paginate(lines, blocks, -1, 1000, 100, false)
    expect(legacy.breaks[0].at).not.toBe(production.breaks[0].at)
    expect(legacy.sig).not.toBe(production.sig)
  })

  it('with no orphan to snap, both rules agree (the guard is orphan-specific)', () => {
    // Every line in ONE block ⇒ blockStartUsed is 0, the orphan is the whole page, snap can't apply.
    const oneBlock: SplitLine[] = Array.from({ length: 40 }, (_, i) => ({ top: i * 30, blockIdx: 0, pos: 10 + i }))
    const legacy = paginate(oneBlock, [{ start: 1 }], -1, 1000, 100)
    const production = paginate(oneBlock, [{ start: 1 }], -1, 1000, 100, false)
    expect(legacy.sig).toBe(production.sig)
  })
})
