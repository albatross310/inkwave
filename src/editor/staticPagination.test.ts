// THE /snapshot PANE MUST BREAK PAGES THE WAY THE EDITOR DOES.
//
// Canonical pagination's whole claim is "the same text on page N at every zoom, on phone, and in
// print" (CLAUDE.md). The /snapshot doc pane exists to MIRROR the editor — so a rule the editor
// retired may not live on here.
//
// WHY THIS FILE EXISTS: there are THREE copies of the break rule — PaginationExtension.computeBreaks
// (the editor, production), arithmeticLayout.paginate (the canvas model), and
// staticPagination.computeBreakPicks (this pane). When production retired the widow/orphan snap
// (`const snap = false`), paginate()'s default was corrected and THIS COPY WAS MISSED — for a week,
// with the whole suite green, while its own comment claimed "identical policy (and 0.22 constant) to
// the editor" and the file header claimed "the SAME overflow / orphan-snap rules". MEASURED in the
// real app (halvesbisect.prove.mjs, three corners from ONE document): the pane was +2 pages on a
// 25-page document of PLAIN PROSE, so every page number /snapshot showed — the minimap's and the
// diff panel's included — disagreed with the editor. Fixed; this is what keeps it fixed.
//
// THE FIXTURE HAS TO SEPARATE blockFirstLine FROM i, or it cannot see the rule at all. CLAUDE.md
// records the same trap one level down: "arithmeticLayout.test.ts gives every line its own block
// with blocks[i].start === lines[i].pos, so snapping to the block start returns the IDENTICAL number
// — the assertions pass under both rules. A test only sees a rule it VARIES."
import { describe, it, expect } from 'vitest'
import { _computeBreakPicksForTest as computeBreakPicks } from './staticPagination'

const line = (i: number, blockIdx: number) => ({ top: i * 30, absTop: i * 30, blockIdx })

describe('staticPagination break picks — the pane mirrors the editor', () => {
  // 40 lines at 30px, textArea 828 (= the arithmeticLayout fixture's geometry, deliberately: the two
  // copies of this rule should be checkable against the same numbers). Lines 0-24 are block 0;
  // 25+ are block 1 — so when line 27 overflows, block 1 has only a 2-line orphan (60px) on the
  // page, well under the retired snap's 0.22 × 828 = 182px threshold. That is the ONLY shape in
  // which the two rules differ, which is why the fixture is built this way.
  const lines = Array.from({ length: 40 }, (_, i) => line(i, i < 25 ? 0 : 1))
  const TEXT_AREA = 828

  it('breaks mid-block at the OVERFLOWING line — it does not snap the orphan to the block start', () => {
    const picks = computeBreakPicks(lines, TEXT_AREA)
    expect(picks.length).toBeGreaterThan(0)
    // The editor's rule: break where the page fills. Line 27 overflows (28 × 30 = 840 > 828).
    expect(picks[0].lineIdx).toBe(27)
    expect(picks[0].snap).toBe(false)
    expect(picks[0].brokeUsed).toBe(810) // 27 lines × 30 — the page is FULL, not short
  })

  it('NO pick ever snaps — the retired rule is gone from this copy', () => {
    for (const p of computeBreakPicks(lines, TEXT_AREA)) expect(p.snap).toBe(false)
  })

  // THE FIXTURE MUST BE ABLE TO SEE THE DIFFERENCE. If the snap and no-snap rules would produce the
  // same pick here, every assertion above is decoration — which is exactly how this bug survived.
  it('the fixture DISCRIMINATES: the retired rule would have picked a different line', () => {
    const picks = computeBreakPicks(lines, TEXT_AREA)
    // Reproduce the retired rule on the same input.
    const retired = (() => {
      let used = 0, blockIdx = -2, blockStartUsed = 0, blockFirstLine = 0
      for (let i = 0; i < lines.length; i++) {
        const lh = i < lines.length - 1 ? Math.max(1, lines[i + 1].top - lines[i].top) : 24
        if (lines[i].blockIdx !== blockIdx || blockIdx === -2) { blockIdx = lines[i].blockIdx; blockStartUsed = used; blockFirstLine = i }
        if (i > 0 && used + lh > TEXT_AREA) {
          const orphan = used - blockStartUsed
          const snap = orphan <= TEXT_AREA * 0.22 && blockFirstLine > 0
          return { lineIdx: snap ? blockFirstLine : i, snap }
        }
        used += lh
      }
      return null
    })()
    expect(retired).not.toBeNull()
    expect(retired!.snap).toBe(true)       // the retired rule really would snap on this fixture
    expect(retired!.lineIdx).toBe(25)      // …to block 1's first line
    expect(picks[0].lineIdx).not.toBe(retired!.lineIdx) // …and the shipped rule does NOT
  })

  it('a single-block document is identical under both rules (the snap needs a block boundary)', () => {
    // Not a guard — a scope statement. Nothing to snap TO when every line shares block 0, which is
    // why a naive fixture would have reported "no difference" and closed the case.
    const oneBlock = Array.from({ length: 40 }, (_, i) => line(i, 0))
    const picks = computeBreakPicks(oneBlock, TEXT_AREA)
    expect(picks[0].lineIdx).toBe(27)
    expect(picks[0].snap).toBe(false)
  })
})
