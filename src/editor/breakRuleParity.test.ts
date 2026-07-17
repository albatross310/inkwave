// THREE COPIES OF THE BREAK RULE, AND — UNTIL THIS FILE — NO TEST COMPARED ANY PAIR.
//
// The rule that decides where a page ends exists three times:
//   1. `PaginationExtension.computeBreaks`  — THE EDITOR. Production. What "canonical pagination"
//      MEANS. It is the original the other two mirror, and it is the one copy no test imports.
//   2. `arithmeticLayout.paginate`          — the canvas model's copy.
//   3. `staticPagination.computeBreakPicks` — the /snapshot pane's copy.
// Each was pinned against its OWN fixture. Each passed. Each was consistent with itself — and
// self-consistency is what this disease always preserves.
//
// WHAT IT COST: when production retired the widow/orphan snap (`const snap = false`), copy 2 was
// corrected and copy 3 was MISSED. The /snapshot pane then ran **+2 pages on 25 pages of plain
// prose** for a week — every page number the minimap and diff panel showed disagreed with the
// editor — with the whole suite green, because copy 3's own test agreed with copy 3.
//
// It is the same shape as "a comment asserting parity is a reason nobody checks parity", but
// structural rather than textual: no comment lied here. THREE FIXTURES EACH TOLD THE TRUTH ABOUT A
// DIFFERENT COPY.
//
// THE REPO ALREADY KNEW HOW. `textMap.test.ts`: `expect(buildFlatMap(d, r).text).toBe(pmToText(d, r))`
// — one line, two implementations, byte-for-byte. It was the only place in the codebase that
// compared an implementation to the thing it claims to mirror. And the fixture below already
// existed: staticPagination.test.ts's own comment says textArea 828 was chosen "deliberately: the
// two copies should be checkable against the same numbers". The author aligned the geometries and
// stopped one line short of the assertion. This is that line.
import { describe, it, expect } from 'vitest'
import { paginate, MARGIN_BOTTOM_PX, type SplitLine } from './arithmeticLayout'
import { _computeBreakPicksForTest as computeBreakPicks } from './staticPagination'
import { _computeBreaksForTest } from './extensions/PaginationExtension'

// ── THE SHARED FIXTURE ──────────────────────────────────────────────────────────────────────────
// 40 lines at 30px. Page 1000px, topMargin 100, MARGIN_BOTTOM_PX 72 ⇒ textArea 828 — the SAME 828
// staticPagination.test.ts uses directly, which is what makes the two copies comparable at all.
//
// IT MUST SEPARATE blockFirstLine FROM i, or it cannot see the rule it is testing. Lines 0-24 are
// block 0; 25+ are block 1 — so when line 27 overflows, block 1 has a 2-line orphan (60px), well
// under the retired snap's 0.22 × 828 = 182px threshold. That is the ONLY shape in which the
// snapping and non-snapping rules differ. CLAUDE.md records the same trap one level down:
// "arithmeticLayout.test.ts gives every line its own block with blocks[i].start === lines[i].pos, so
// snapping to the block start returns the IDENTICAL number — the assertions pass under both rules."
const PAGE_H = 1000
const TOP_M = 100
const TEXT_AREA = PAGE_H - TOP_M - MARGIN_BOTTOM_PX // 828

const N = 40
const splitLines: SplitLine[] = Array.from({ length: N }, (_, i) => ({
  top: i * 30,
  blockIdx: i < 25 ? 0 : 1,
  pos: i < 25 ? 10 + i : 100 + i,
}))
const splitBlocks = [{ start: 1 }, { start: 99 }]
// The pane's copy takes StaticLines — the SAME geometry, its own shape.
const staticLines = splitLines.map((l) => ({ top: l.top, absTop: l.top, blockIdx: l.blockIdx }))

// THE EDITOR'S OWN RULE, reachable in-process. `computeBreaks` emits `at:round(botMargin)|…|pages:N`
// and `paginate` emits the SAME string by design ("so a prover can compare" — paginate's header).
const editorSig = () => _computeBreaksForTest(
  splitLines.map((l) => ({ top: l.top, blockIdx: l.blockIdx, cx: 0, cy: 0, pos: l.pos })) as never,
  splitBlocks as never, -1, PAGE_H, TOP_M, false, (l: { pos: number }) => l.pos,
).sig

describe('THE BREAK RULE — all THREE copies must agree', () => {
  // ── THE ORIGINAL. This is the copy no test could reach, and the reason all three drifted. ──
  it('the EDITOR’s rule and the MODEL’s rule emit the SAME signature', () => {
    expect(editorSig()).toBe(paginate(splitLines, splitBlocks, -1, PAGE_H, TOP_M).sig)
  })

  it('the EDITOR’s rule and the PANE’s rule break at the same line', () => {
    // computeBreaks' sig is `at:botMargin|…`; the pane reports a line index. One axis: the `at`.
    const editorAts = editorSig().split('|').filter((t) => !t.startsWith('pages:')).map((t) => Number(t.split(':')[0]))
    const paneAts = computeBreakPicks(staticLines, TEXT_AREA).map((p) => splitLines[p.lineIdx].pos)
    expect(paneAts).toEqual(editorAts)
  })

  it('the editor sig is not vacuous — it really contains a break and a page count', () => {
    // A parity test between two empty strings passes forever.
    expect(editorSig()).toMatch(/^\d+:\d+\|pages:\d+$/)
    expect(editorSig()).toContain('pages:2')
  })

  it('the fixture is aligned: both copies see the same textArea', () => {
    expect(TEXT_AREA).toBe(828)
  })

  // THE ASSERTION THAT DID NOT EXIST. One line, two implementations — the textMap.test.ts pattern.
  it('paginate and computeBreakPicks break at the SAME LINES', () => {
    const modelBreaks = paginate(splitLines, splitBlocks, -1, PAGE_H, TOP_M).breaks.map((b) => b.at)
    const paneBreaks = computeBreakPicks(staticLines, TEXT_AREA).map((p) => splitLines[p.lineIdx].pos)
    expect(paneBreaks).toEqual(modelBreaks)
  })

  it('…and both land on line 27 — the overflowing line, not the block start', () => {
    const picks = computeBreakPicks(staticLines, TEXT_AREA)
    const res = paginate(splitLines, splitBlocks, -1, PAGE_H, TOP_M)
    expect(picks[0].lineIdx).toBe(27)
    expect(res.breaks[0].at).toBe(splitLines[27].pos) // 127
    expect(picks[0].snap).toBe(false) // production retired the orphan snap; both copies must obey
  })

  it('neither copy snaps ANY orphan, anywhere in the fixture', () => {
    for (const p of computeBreakPicks(staticLines, TEXT_AREA)) expect(p.snap).toBe(false)
  })

  // THE KNOWN-NEGATIVE. Without it, "they agree" could mean "the fixture cannot tell them apart" —
  // which is precisely how three self-consistent copies stayed green while one carried a retired
  // rule. This reproduces the RETIRED rule on the SAME input and proves the fixture discriminates:
  // the legacy rule breaks at line 25, the shipped rule at 27. A copy that regressed would be seen.
  it('the fixture DISCRIMINATES — the retired snap rule answers differently (negative FIRES)', () => {
    const retired = (() => {
      let used = 0, blockIdx = -2, blockStartUsed = 0, blockFirstLine = 0
      for (let i = 0; i < N; i++) {
        const lh = i < N - 1 ? Math.max(1, splitLines[i + 1].top - splitLines[i].top) : 24
        if (splitLines[i].blockIdx !== blockIdx || blockIdx === -2) {
          blockIdx = splitLines[i].blockIdx; blockStartUsed = used; blockFirstLine = i
        }
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
    expect(retired!.snap).toBe(true)   // the retired rule really does snap on this fixture
    expect(retired!.lineIdx).toBe(25)  // …to block 1's first line
    // …and BOTH shipped copies disagree with it, which is what makes the parity test meaningful.
    expect(computeBreakPicks(staticLines, TEXT_AREA)[0].lineIdx).not.toBe(retired!.lineIdx)
    expect(paginate(splitLines, splitBlocks, -1, PAGE_H, TOP_M).breaks[0].at).not.toBe(splitLines[retired!.lineIdx].pos)
  })

  // The parity assertion must be able to FAIL, not just pass. Perturb one copy's input and prove the
  // comparison notices — otherwise `toEqual` on two empty arrays would "pass" forever.
  it('the parity assertion DISCRIMINATES — a divergent input is caught', () => {
    const modelBreaks = paginate(splitLines, splitBlocks, -1, PAGE_H, TOP_M).breaks.map((b) => b.at)
    // A pane measuring a SHORTER page must break earlier than the model. If this still "agreed",
    // the assertion above would be comparing nothing.
    const shortPane = computeBreakPicks(staticLines, TEXT_AREA - 120).map((p) => splitLines[p.lineIdx].pos)
    expect(shortPane).not.toEqual(modelBreaks)
    expect(modelBreaks.length).toBeGreaterThan(0) // …and it is not vacuous on empty arrays
  })
})

// ── A CLAIM I ALMOST SHIPPED, AND THE PROBE THAT KILLED IT ──────────────────────────────────────
// The first draft of this file STATED that the editor's copy could not be reached: "it returns
// ProseMirror Decorations, so it needs the view layer… importing it at all drags in a browser."
// That was reasoning from the import list, and it was WRONG. Probed instead — the module was
// imported under vitest's node env and its exports enumerated — and it loads clean:
//     IMPORT OK. exports: MARGIN_TOP, MARGIN_BOTTOM, blockLineRects, keepLineRects, PaginationExtension
// The browser dependency is in the VIEW, not the module: `Decoration.widget(pos, toDOM)` never calls
// toDOM until a view renders it. The only real barrier was that `computeBreaks` was private — one
// `export` of a test seam, no behaviour touched.
// A "cannot be tested" that nobody tries is indistinguishable from a rule nobody wants to test.
