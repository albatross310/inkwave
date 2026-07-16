import { describe, it, expect } from 'vitest'
import { paginate, type SplitLine } from './arithmeticLayout'

// ── The orphan-snap drift (found + fixed 2026-07-16 by the textRender pixel diff) ─────────────
// paginate() snapped small orphans to the block start; PaginationExtension.computeBreaks retired
// that rule (`const snap = false`). Any consumer taking the default therefore paginated DIFFERENTLY
// from the editor it exists to mirror — measured live on a 4k-word doc: first break 2141 vs the
// editor's 2403, 17 pages vs 16. The default now matches production.
//
// THE EXISTING TESTS COULD NOT SEE THIS. arithmeticLayout.test.ts gives every line its own block
// with `blocks[i].start === lines[i].pos`, so snapping to the block start returns the IDENTICAL
// number — the assertions pass under both rules. A test only sees a rule it VARIES, so these
// fixtures deliberately separate blockStart from pos, which is the whole point of them.
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

  // THE LOAD-BEARING ONE: the default must be what the editor actually does. If someone "restores
  // compatibility" by flipping this back, pages silently carry the wrong words again.
  it('the DEFAULT matches production — breaks mid-block at the overflowing line, no snap', () => {
    const res = paginate(lines, blocks, -1, 1000, 100)
    expect(res.breaks[0].at).toBe(127) // lines[27].pos — the page fills, the paragraph straddles
  })

  it('LEGACY behaviour is opt-in only (snapOrphans=true snaps back to the block start)', () => {
    const res = paginate(lines, blocks, -1, 1000, 100, true)
    expect(res.breaks[0].at).toBe(99) // block 1's start — the whole paragraph moves to page 2
  })

  it('the two rules genuinely disagree (the drift was real, not cosmetic)', () => {
    const production = paginate(lines, blocks, -1, 1000, 100)
    const legacy = paginate(lines, blocks, -1, 1000, 100, true)
    expect(legacy.breaks[0].at).not.toBe(production.breaks[0].at)
    expect(legacy.sig).not.toBe(production.sig)
  })

  it('with no orphan to snap, both rules agree (the divergence is orphan-specific)', () => {
    // Every line in ONE block ⇒ blockStartUsed is 0, the orphan is the whole page, snap can't apply.
    const oneBlock: SplitLine[] = Array.from({ length: 40 }, (_, i) => ({ top: i * 30, blockIdx: 0, pos: 10 + i }))
    const production = paginate(oneBlock, [{ start: 1 }], -1, 1000, 100)
    const legacy = paginate(oneBlock, [{ start: 1 }], -1, 1000, 100, true)
    expect(legacy.sig).toBe(production.sig)
  })

  // Pins the blindness itself: under the OLD fixture shape (blockStart === pos) the two rules are
  // indistinguishable — which is exactly why arithmeticLayout.test.ts passed throughout the drift.
  it('documents why the old fixtures were blind: blockStart === pos hides the rule entirely', () => {
    const selfBlocked: SplitLine[] = Array.from({ length: 40 }, (_, i) => ({ top: i * 30, blockIdx: i, pos: (i + 1) * 1000 }))
    const perLineBlocks = selfBlocked.map((_, i) => ({ start: (i + 1) * 1000 }))
    const production = paginate(selfBlocked, perLineBlocks, -1, 1000, 100)
    const legacy = paginate(selfBlocked, perLineBlocks, -1, 1000, 100, true)
    expect(legacy.sig).toBe(production.sig) // identical — the fixture cannot see the difference
  })
})
