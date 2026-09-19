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
import { describe, it, expect, afterEach } from 'vitest'
import { paginate, MARGIN_BOTTOM_PX, type SplitLine } from './arithmeticLayout'
import { _computeBreakPicksForTest as computeBreakPicks } from './staticPagination'
import { _computeBreaksForTest, _setLiveIsCanonicalForTest } from './extensions/PaginationExtension'

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CHARACTERIZATION — written BEFORE the three copies were folded into one module, against the
// unmoved code, with every expected string derived BY HAND from the rule as written (not read back
// from a run). A characterization written after a move encodes the mover's belief; written first it
// can contradict it. Where the copies genuinely differ today, the difference is PINNED as a scope
// statement — a consolidation that silently "fixed" one would be a behaviour change on the thesis.
//
// GEOMETRY. Page 1000, top margin 100, bottom 72 ⇒ textArea 828. Lines 30px ⇒ a page holds 27
// lines (27 × 30 = 810; the 28th would make 840 > 828). A break lands BEFORE line index 27 of a
// page; brokeUsed 810 ⇒ botMargin = max(72, 900 − 810) = 90.
// POSITIONS. Block b starts at doc pos (b+1)·1000; its j-th line's pos is (b+1)·1000 + 1 + j — so a
// break's `at` reads as "block, line" at a glance (2003 = block 1, third line) and a snapped break
// (at the block START) is visibly a round thousand.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
type Fx = { lines: SplitLine[]; blocks: Array<{ start: number }> }
function fixture(linesPerBlock: number[], lh = 30): Fx {
  const lines: SplitLine[] = []
  const blocks: Array<{ start: number }> = []
  let i = 0
  linesPerBlock.forEach((n, b) => {
    blocks.push({ start: (b + 1) * 1000 })
    for (let j = 0; j < n; j++, i++) lines.push({ top: i * lh, blockIdx: b, pos: (b + 1) * 1000 + 1 + j })
  })
  return { lines, blocks }
}
const editor = (fx: Fx, o: { refListPos?: number; live?: boolean; gapped?: boolean } = {}) => {
  _setLiveIsCanonicalForTest(o.live ?? true)
  try {
    return _computeBreaksForTest(
      fx.lines.map((l) => ({ top: l.top, blockIdx: l.blockIdx, cx: 0, cy: 0, pos: l.pos })) as never,
      fx.blocks as never, o.refListPos ?? -1, PAGE_H, TOP_M, o.gapped ?? false, (l: { pos: number }) => l.pos,
    )
  } finally { _setLiveIsCanonicalForTest(true) }
}
const model = (fx: Fx, refListPos = -1, legacySnap = false) => paginate(fx.lines, fx.blocks, refListPos, PAGE_H, TOP_M, legacySnap)
const pane = (fx: Fx) => computeBreakPicks(fx.lines.map((l) => ({ top: l.top, absTop: l.top, blockIdx: l.blockIdx })), TEXT_AREA)
const paneIdx = (fx: Fx) => pane(fx).map((p) => p.lineIdx)

afterEach(() => { _setLiveIsCanonicalForTest(true) })

describe('CHARACTERIZATION — the EDITOR rule, pinned by hand before the move', () => {
  it('block boundary mid-page, canonical: splits the block at the overflowing line', () => {
    const fx = fixture([25, 15])
    const r = editor(fx)
    expect(r.sig).toBe('2003:90|pages:2')
    expect(r.decos).toEqual([{ from: 2003, to: 2003, key: 'gap-1-2003b' }]) // b = continuation bracket
    expect(r.breaks).toEqual([{ at: 2003, brokeUsed: 810, botMargin: 90 }])
    expect(r.lastUsed).toBe(384) // page 2: lines 27..39 = 12 × 30 + the last line's fixed 24
    expect(model(fx).sig).toBe(r.sig)
    expect(paneIdx(fx)).toEqual([27])
  })

  it('the same boundary OFF-canonical: snaps to the block start and carries the orphan over', () => {
    const fx = fixture([25, 15])
    const r = editor(fx, { live: false })
    // orphan = 810 − 750 = 60 > 0, blockStart 2000 > lastBreakAt −1 ⇒ snap. brokeUsed is the
    // used-on-page at the BLOCK start (750), so botMargin = max(72, 900 − 750) = 150.
    expect(r.sig).toBe('2000:150|pages:2')
    expect(r.breaks).toEqual([{ at: 2000, brokeUsed: 750, botMargin: 150 }])
    // ⚠ PINNED QUIRK, not endorsed: `midBlock` is computed from the LINES around the overflow (26
    // and 27 share a block), not from where the break was placed — so a snapped break at a block
    // START still gets the continuation-bracket key. Preserved byte-for-byte; a fix is a separate,
    // visible change.
    expect(r.decos).toEqual([{ from: 2000, to: 2000, key: 'gap-1-2000b' }])
    // used restarts at the orphan (60), then line 27 adds 30, then 28..38 and the 24px tail.
    expect(r.lastUsed).toBe(444)
    // ⚠ THE DOCUMENTED GAP: the model does not implement the off-canonical snap. Pinned as a
    // known-negative — a consolidation must not close it silently (→ pagination-rounds.md#arith-engine).
    expect(model(fx).sig).toBe('2003:90|pages:2')
    expect(model(fx).sig).not.toBe(r.sig)
  })

  it('orphan 0 (the block STARTS at the overflowing line): no snap, canonical and off-canonical agree', () => {
    const fx = fixture([27, 13])
    const live = editor(fx), zoomed = editor(fx, { live: false })
    expect(live.sig).toBe('2001:90|pages:2')
    expect(live.decos).toEqual([{ from: 2001, to: 2001, key: 'gap-1-2001' }]) // no bracket: a block start
    expect(zoomed.sig).toBe(live.sig)
    expect(zoomed.decos).toEqual(live.decos)
    expect(live.lastUsed).toBe(384)
    expect(model(fx).sig).toBe(live.sig)
    expect(paneIdx(fx)).toEqual([27])
  })

  it('a block TALLER than a page after a short one, canonical: split, split, split', () => {
    const fx = fixture([5, 60])
    const r = editor(fx)
    expect(r.sig).toBe('2023:90|2050:90|pages:3')
    expect(r.decos.map((d) => d.key)).toEqual(['gap-1-2023b', 'gap-2-2050b'])
    expect(r.lastUsed).toBe(324) // lines 54..64: 10 × 30 + 24
    expect(model(fx).sig).toBe(r.sig)
    expect(paneIdx(fx)).toEqual([27, 54])
  })

  it('a block TALLER than a page, OFF-canonical: pushed whole ONCE, then split (the lastBreakAt guard)', () => {
    const fx = fixture([5, 60])
    const r = editor(fx, { live: false })
    // Page 1: orphan 660 > 0 and blockStart 2000 > −1 ⇒ snap at 2000 with brokeUsed 150 ⇒ botMargin 750.
    // used = 660 (+30 for line 27 = 690). Line 32 overflows (810 + 30): blockStart 2000 is NOT >
    // lastBreakAt 2000 ⇒ no second snap ⇒ mid-block at line 32 (block 1, j=27 ⇒ 2028). Then every 27.
    expect(r.sig).toBe('2000:750|2028:90|2055:90|pages:4')
    expect(r.breaks).toEqual([
      { at: 2000, brokeUsed: 150, botMargin: 750 },
      { at: 2028, brokeUsed: 810, botMargin: 90 },
      { at: 2055, brokeUsed: 810, botMargin: 90 },
    ])
    expect(r.decos.map((d) => d.key)).toEqual(['gap-1-2000b', 'gap-2-2028b', 'gap-3-2055b'])
    expect(r.lastUsed).toBe(174) // lines 59..64: 5 × 30 + 24
  })

  it('a block TALLER than a page at the DOCUMENT START, off-canonical — pinned quirk', () => {
    const fx = fixture([60])
    const r = editor(fx, { live: false })
    // ⚠ PINNED, NOT ENDORSED. orphan 810, blockStart 1000 > −1 ⇒ snap at 1000 with brokeUsed 0: a gap
    // with NOTHING above it (botMargin 900 — an empty first page), and used restarts at 810 so page
    // 2 carries 28 lines (840px > textArea). The next overflow (line 28) finds blockStart 1000 ==
    // lastBreakAt ⇒ split; brokeUsed 840 ⇒ botMargin max(72, 60) = 72. Reachable only when zoomed
    // and the FIRST block outgrows a page. Preserved byte-for-byte here; reported, not fixed.
    expect(r.sig).toBe('1000:900|1029:72|1056:90|pages:4')
    expect(r.breaks[0]).toEqual({ at: 1000, brokeUsed: 0, botMargin: 900 })
    expect(r.breaks[1]).toEqual({ at: 1029, brokeUsed: 840, botMargin: 72 })
    expect(r.lastUsed).toBe(144) // lines 55..59: 4 × 30 + 24
    // …and canonical is the plain split rule:
    expect(editor(fx).sig).toBe('1028:90|1055:90|pages:3')
  })

  it('atomLike pseudo-block PER LINE: orphan is always 0, so an atom is never pushed whole', () => {
    // The collector gives a top-level atom (refList, block math) one pseudo-block per line; the
    // rule then sees a block boundary at EVERY line. Canonical and off-canonical must coincide.
    const fx = fixture(new Array(40).fill(1))
    const live = editor(fx), zoomed = editor(fx, { live: false })
    expect(live.sig).toBe('28001:90|pages:2')
    expect(live.decos).toEqual([{ from: 28001, to: 28001, key: 'gap-1-28001' }])
    expect(zoomed.sig).toBe(live.sig)
    expect(zoomed.decos).toEqual(live.decos)
    expect(model(fx).sig).toBe(live.sig)
    expect(paneIdx(fx)).toEqual([27])
  })

  it('the reference list is forced onto a fresh page (used > 4), with its own key and sig token', () => {
    const fx = fixture([10, 10, 20])
    const r = editor(fx, { refListPos: 3000 })
    // used at the refList's first line = 20 × 30 = 600 ⇒ botMargin max(72, 900 − 600) = 300.
    expect(r.sig).toBe('ref:3000:300|pages:2')
    expect(r.decos).toEqual([{ from: 3000, to: 3000, key: 'gapref-3000' }])
    expect(r.breaks).toEqual([{ at: 3000, brokeUsed: 600, botMargin: 300 }])
    expect(r.lastUsed).toBe(594) // lines 20..39: 19 × 30 + 24
    expect(model(fx, 3000).sig).toBe(r.sig)
    // The pane has no refList rule (it never had one): it sees only geometry ⇒ one plain break at 27.
    expect(paneIdx(fx)).toEqual([27])
  })

  it('a reference list longer than a page: the ref break records lastBreakAt, so it is never re-snapped', () => {
    const fx = fixture([10, 10, 40])
    const live = editor(fx, { refListPos: 3000 })
    expect(live.sig).toBe('ref:3000:300|3028:90|pages:3')
    expect(live.decos.map((d) => d.key)).toEqual(['gapref-3000', 'gap-2-3028b'])
    // Off-canonical: line 47 overflows with orphan 810 > 0 but blockStart 3000 == lastBreakAt 3000.
    const zoomed = editor(fx, { refListPos: 3000, live: false })
    expect(zoomed.sig).toBe(live.sig)
    expect(model(fx, 3000).sig).toBe(live.sig)
  })

  it('a reference list that lands exactly where the page would break anyway: the ref break wins', () => {
    const fx = fixture([27, 13])
    const r = editor(fx, { refListPos: 2000 })
    // At line 27: used 810 > 4 ⇒ ref break FIRST (botMargin 90); used resets, so the overflow test
    // that would have broken at 2001 no longer fires. One gap, keyed as the ref gap.
    expect(r.sig).toBe('ref:2000:90|pages:2')
    expect(r.decos).toEqual([{ from: 2000, to: 2000, key: 'gapref-2000' }])
    expect(model(fx, 2000).sig).toBe(r.sig)
  })

  it('the `used > 4` threshold is re-asked on EVERY refList line — pinned quirk', () => {
    // FIRST DRAFT OF THIS TEST WAS WRONG, AND THAT IS THE CHARACTERIZATION WORKING. I asserted that a
    // reference list at the top of the document is never forced ('pages:1'). The rule as written
    // tests `blockStart >= refListPos && used > 4` at every line whose block starts at/after the
    // refList — and a top-level atom is one pseudo-block PER LINE, all starting at refListPos — so
    // line 0 passes (used 0) and line 1 FIRES (used 30): a gap at 1000 with nothing above it.
    // ⚠ PINNED, NOT ENDORSED: a document whose FIRST block is the reference list gets an empty
    // first page. Preserved byte-for-byte; reported as a finding, not fixed under a zero-change move.
    expect(editor(fixture([20]), { refListPos: 1000 }).sig).toBe('ref:1000:870|pages:2')
    expect(editor(fixture([20]), { refListPos: 1000 }).breaks).toEqual([{ at: 1000, brokeUsed: 30, botMargin: 870 }])
    expect(model(fixture([20]), 1000).sig).toBe('ref:1000:870|pages:2')
    // The edge itself: used 4 at the refList's first line defers to the next line (used 8 ⇒ 892);
    // used 5 fires at once (895).
    expect(editor(fixture([1, 5], 4), { refListPos: 2000 }).breaks).toEqual([{ at: 2000, brokeUsed: 8, botMargin: 892 }])
    expect(editor(fixture([1, 5], 5), { refListPos: 2000 }).breaks).toEqual([{ at: 2000, brokeUsed: 5, botMargin: 895 }])
    expect(model(fixture([1, 5], 4), 2000).sig).toBe('ref:2000:892|pages:2')
    expect(model(fixture([1, 5], 5), 2000).sig).toBe('ref:2000:895|pages:2')
  })

  it('an overflow whose `at` IS the refList position is suppressed after the ref break', () => {
    // The refList's first "line" carries pos 3000 and is taller than a page (top jumps by 900).
    const fx = fixture([10, 10, 20])
    fx.lines[20] = { ...fx.lines[20], pos: 3000 }
    for (let i = 21; i < fx.lines.length; i++) fx.lines[i] = { ...fx.lines[i], top: 1500 + (i - 21) * 30 }
    const r = editor(fx, { refListPos: 3000 })
    // Ref break at line 20 (used 600). Then 0 + 900 > 828 with at === refListPos ⇒ NO second gap
    // there; used becomes 900. Line 21: 900 + 30 > 828 ⇒ break at 3002 with brokeUsed 900 ⇒ 72.
    expect(r.sig).toBe('ref:3000:300|3002:72|pages:3')
    expect(r.decos.map((d) => d.key)).toEqual(['gapref-3000', 'gap-2-3002b'])
    expect(r.lastUsed).toBe(564) // lines 21..39: 18 × 30 + 24
    expect(model(fx, 3000).sig).toBe(r.sig)
  })

  it('an UNRESOLVED line position (pos 0) cannot host a break: the overflow rolls to the next line', () => {
    const fx = fixture([40])
    fx.lines[27] = { ...fx.lines[27], pos: 0 }
    const r = editor(fx)
    // Line 27 overflows but resolves to 0 ⇒ skipped; used 840. Line 28: 840 + 30 > 828 ⇒ break at
    // 1029 with brokeUsed 840 ⇒ botMargin max(72, 60) = 72. Page 1 is over-full by one line.
    expect(r.sig).toBe('1029:72|pages:2')
    expect(r.decos).toEqual([{ from: 1029, to: 1029, key: 'gap-1-1029b' }])
    expect(r.lastUsed).toBe(354) // lines 28..39: 11 × 30 + 24
    expect(model(fx).sig).toBe(r.sig)
    // The pane resolves positions AFTER picking, so it cannot see this: geometry alone says 27.
    expect(paneIdx(fx)).toEqual([27])
  })

  it('an UNRESOLVABLE block start (−1) never snaps — −1 is never > lastBreakAt', () => {
    const fx = fixture([25, 15])
    fx.blocks[1] = { start: -1 }
    expect(editor(fx, { live: false }).sig).toBe('2003:90|pages:2')
    expect(editor(fx, { live: false }).decos).toEqual([{ from: 2003, to: 2003, key: 'gap-1-2003b' }])
  })

  it('the LAST line is always 24px tall for the overflow test, whatever its real height', () => {
    // 26 lines at 32px: 25 × 32 = 800 used; the 26th is last ⇒ 800 + 24 = 824 ≤ 828 ⇒ no break.
    expect(editor(fixture([26], 32)).sig).toBe('pages:1')
    expect(editor(fixture([26], 32)).lastUsed).toBe(824)
    // Add one more line and the 26th is measured at its real 32 ⇒ 832 > 828 ⇒ break before it.
    expect(editor(fixture([27], 32)).sig).toBe('1026:100|pages:2') // botMargin max(72, 900 − 800)
    expect(model(fixture([26], 32)).sig).toBe('pages:1')
    expect(model(fixture([27], 32)).sig).toBe('1026:100|pages:2')
    expect(paneIdx(fixture([26], 32))).toEqual([])
    expect(paneIdx(fixture([27], 32))).toEqual([25])
  })

  it('two lines at the SAME top: the first counts as 1px, never 0 or negative', () => {
    const fx = fixture([40])
    for (let i = 5; i < fx.lines.length; i++) fx.lines[i] = { ...fx.lines[i], top: (i - 1) * 30 }
    // lh(4) = max(1, 0) = 1. Before line 27: 26 × 30 + 1 = 781; +30 = 811 ≤ 828 ⇒ no. Line 28:
    // 811 + 30 > 828 ⇒ break at 1029 with brokeUsed 811 ⇒ botMargin 89.
    const r = editor(fx)
    expect(r.sig).toBe('1029:89|pages:2')
    expect(r.breaks).toEqual([{ at: 1029, brokeUsed: 811, botMargin: 89 }])
    expect(model(fx).sig).toBe(r.sig)
    expect(pane(fx)).toEqual([{ lineIdx: 28, snap: false, brokeUsed: 811 }])
  })

  it('gapped vs ungapped changes the WIDGET only — sig, keys, positions and band are identical', () => {
    const fx = fixture([5, 60])
    const g = editor(fx, { gapped: true }), u = editor(fx, { gapped: false })
    expect(g.sig).toBe(u.sig)
    expect(g.decos).toEqual(u.decos)
    expect(g.breaks).toEqual(u.breaks)
    expect(g.lastUsed).toBe(u.lastUsed)
  })

  it('a document that fits one page: no breaks, one page, and the band still reports lastUsed', () => {
    const fx = fixture([10])
    const r = editor(fx)
    expect(r.sig).toBe('pages:1')
    expect(r.decos).toEqual([])
    expect(r.breaks).toEqual([])
    expect(r.lastUsed).toBe(294) // 9 × 30 + 24
    expect(model(fx).sig).toBe('pages:1')
    expect(pane(fx)).toEqual([])
  })

  it('an EMPTY line list: pages:1 and nothing else', () => {
    expect(editor({ lines: [], blocks: [] }).sig).toBe('pages:1')
    expect(editor({ lines: [], blocks: [] }).lastUsed).toBe(0)
    expect(model({ lines: [], blocks: [] }).sig).toBe('pages:1')
  })
})

describe('CHARACTERIZATION — the phone bottom margin (the EDITOR and the PANE model it; the MODEL does not)', () => {
  // `phoneLike()` reads matchMedia at break time. Under vitest there is no matchMedia ⇒ desktop; a
  // stub makes every break's botMargin the fixed PHONE_PAGE_MARGIN_BOTTOM (56).
  const g = globalThis as unknown as { matchMedia?: unknown }
  afterEach(() => { delete g.matchMedia })
  const asPhone = () => { g.matchMedia = () => ({ matches: true }) }

  it('every break — plain and ref — carries 56 on phone; positions are unchanged', () => {
    asPhone()
    const fx = fixture([10, 10, 40])
    const r = editor(fx, { refListPos: 3000 })
    expect(r.sig).toBe('ref:3000:56|3028:56|pages:3')
    expect(r.breaks.map((b) => b.botMargin)).toEqual([56, 56])
    expect(r.breaks.map((b) => b.brokeUsed)).toEqual([600, 810]) // brokeUsed is geometry, not margin
  })

  it('the MODEL is desktop-only by declaration — same input, desktop margins', () => {
    asPhone()
    expect(model(fixture([10, 10, 40]), 3000).sig).toBe('ref:3000:300|3028:90|pages:3')
  })

  it('the stub is real — without it the same fixture reads desktop margins', () => {
    expect(editor(fixture([10, 10, 40]), { refListPos: 3000 }).sig).toBe('ref:3000:300|3028:90|pages:3')
  })
})

describe('CHARACTERIZATION — the MODEL’s opt-in legacy orphan snap (test-only; production rides the default)', () => {
  it('legacy: a small orphan (≤ 22% of the text area) snaps to the block start', () => {
    expect(model(fixture([25, 15]), -1, true).sig).toBe('2000:150|pages:2')
  })
  it('legacy: a large orphan does not snap, and there is no lastBreakAt guard in this rule', () => {
    expect(model(fixture([5, 60]), -1, true).sig).toBe('2023:90|2050:90|pages:3')
  })
  it('legacy: blockStart must be > 0 (an unresolvable block never snaps)', () => {
    const fx = fixture([25, 15]); fx.blocks[1] = { start: 0 }
    expect(model(fx, -1, true).sig).toBe('2003:90|pages:2')
  })
})

describe('CHARACTERIZATION — the PANE’s pick shape', () => {
  it('reports lineIdx + brokeUsed, never snaps, and needs neither positions nor a refList', () => {
    expect(pane(fixture([5, 60]))).toEqual([
      { lineIdx: 27, snap: false, brokeUsed: 810 },
      { lineIdx: 54, snap: false, brokeUsed: 810 },
    ])
  })
  it('the first line can never be a break (i > 0), even when it alone overflows', () => {
    // Three 900px lines: line 0 is never a break; 1 and 2 each overflow what precedes them. (My
    // first draft wrote [1] for the pane while writing three pages for the editor — the two
    // expectations contradicted each other, and the code was right.)
    const fx = fixture([3], 900)
    expect(paneIdx(fx)).toEqual([1, 2])
    expect(editor(fx).sig).toBe('1002:72|1003:72|pages:3')
    expect(model(fx).sig).toBe('1002:72|1003:72|pages:3')
  })
})
