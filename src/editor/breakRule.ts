// THE PAGE-BREAK RULE — one pure loop, three callers.
//
// Page breaks are CANONICAL: the same text on page N at every zoom, on phone and in print. This
// module is the ONLY definition of where a page ends. The live editor (PaginationExtension.
// computeBreaks) renders its picks as gap widgets; the /snapshot pane (staticPagination.
// computeBreakPicks) resolves them to character offsets; the canvas model (arithmeticLayout.
// paginate) reports them for the rich diff renderer and the provers. Each caller supplies its own
// GEOMETRY and POLICY; none of them may re-implement any part of the loop.
//
// ⚠ THIS FILE WAS THREE COPIES, AND A RETIRED RULE WAS FIXED IN TWO OF THEM. The /snapshot pane ran
// +2 pages on plain prose for a week while every suite was green, because each copy's test agreed
// with that copy. Compare break POSITIONS, never page counts (R2, R6).
// → docs/archive/pagination-rounds.md#three-copies
//
// ⚠ PURE: no DOM, no ProseMirror. `posOf` is injected because the editor resolves a line's doc
// position LAZILY (one hit-test per break, not per line) and may THROW to bail an incremental
// measure — the throw propagates through this loop untouched.
import { MARGIN_BOTTOM } from './pageSettings'
import { PHONE_PAGE_MARGIN_BOTTOM } from './pageGap'

export interface BreakLine { top: number; blockIdx: number }
/** `start` is the block's doc position; −1 = unresolvable (never a snap target). */
export interface BreakBlock { start: number }

/**
 * Whether an overflowing line may be moved to the block boundary instead of splitting the block.
 *  - `never`: split at the overflowing line so the page fills (Peter: "probably split"). The pane
 *    and the model.
 *  - `off-canonical`: the editor's rule — `shouldSnapToBlock` below.
 *  - `legacy-orphan`: the RETIRED widow/orphan snap (≤22% of the text area). Opt-in for the model's
 *    known-negative tests only; nothing in production may select it.
 */
export type SnapPolicy =
  | { kind: 'never' }
  | { kind: 'off-canonical'; liveIsCanonical: boolean }
  | { kind: 'legacy-orphan' }

export interface BreakPolicy {
  pageH: number
  topM: number
  /** Phone pages take the fixed PHONE_PAGE_MARGIN_BOTTOM; desktop fills to the page bottom. */
  phone: boolean
  /** Doc position of the reference list (forced onto a fresh page); ≤0 = none. */
  refListPos: number
  /**
   * Doc position of line i's start. ≤0 = unresolvable, so no break may land there and the overflow
   * rolls to the next line. Called ONLY for a line that overflows (the editor's lazy hit-test).
   */
  posOf: (lineIdx: number) => number
  snap: SnapPolicy
}

export interface BreakPick {
  kind: 'ref' | 'line'
  /** The line whose visit produced the pick (for `ref`, the refList's first line seen with used > 4). */
  lineIdx: number
  /** Doc position of the gap: refListPos, the block start (snapped) or the line's own position. */
  at: number
  snap: boolean
  /** The line before the break is in the same block — the paragraph continues on the next page. */
  midBlock: boolean
  /** Content px used on the page at the break point (drives the fill-to-bottom margin). */
  brokeUsed: number
  botMargin: number
  /** 1-based number of the page this pick CLOSES. */
  pageNo: number
}

export interface BreakResult {
  picks: BreakPick[]
  pages: number
  /** Content px used on the last page (includes the fixed 24px last line). */
  lastUsed: number
  /** `at:round(botMargin)|ref:pos:round(botMargin)|…|pages:N` — the shared vocabulary every prover compares. */
  sig: string
}

/**
 * Should this break snap to the block boundary instead of splitting the paragraph?
 * ⚠ A CANONICAL LINE START IS NOT A RENDERED LINE START AT ANY OTHER ZOOM, and the gap widget is
 * `display:block`, so a mid-block break slices the rendered line; a BLOCK BOUNDARY is a line start
 * in every layout. At canonical rendering nothing changes, byte for byte. ⚠ Both extra conditions
 * are load-bearing: `orphan > 0` (with 0 the block begins at this very line, so snapping is a no-op)
 * and `blockStart > lastBreakAt` (or a block TALLER than a page is pushed whole, overflows again, and
 * snaps to the same boundary forever).
 * → docs/archive/pagination-rounds.md#zoom-snap
 */
export function shouldSnapToBlock(o: {
  liveIsCanonical: boolean; orphan: number; blockStart: number; lastBreakAt: number
}): boolean {
  return !o.liveIsCanonical && o.orphan > 0 && o.blockStart > o.lastBreakAt
}

function snapDecision(policy: SnapPolicy, o: { orphan: number; blockStart: number; lastBreakAt: number; textArea: number }): boolean {
  switch (policy.kind) {
    case 'never': return false
    case 'off-canonical': return shouldSnapToBlock({ liveIsCanonical: policy.liveIsCanonical, orphan: o.orphan, blockStart: o.blockStart, lastBreakAt: o.lastBreakAt })
    case 'legacy-orphan': return o.orphan <= o.textArea * 0.22 && o.blockStart > 0
  }
}

/** Text area per page = pageH minus the top margin (settings) and the bottom margin constant. */
export function textAreaPx(pageH: number, topM: number): number {
  return Math.max(1, pageH - topM - MARGIN_BOTTOM)
}

/**
 * Walk the lines top to bottom and pick where each page ends.
 *  - Line height = the gap to the next line's top (≥1px); the LAST line is always 24px.
 *  - The reference list is forced onto a fresh page the first time a line of it is seen with
 *    used > 4 — an atom the paginator cannot split, so it at least starts clean (Peter's call).
 *  - A line that would overflow the text area breaks the page before itself — mid-block, so the
 *    page fills — unless the snap policy moves the break to the block start, in which case the
 *    block's lines already on this page (`orphan`) carry over as used space.
 *  - A break is never placed at an unresolvable position, nor again at the refList boundary.
 * A block missing from `blocks` reads as UNRESOLVABLE (start −1): the pane has no block positions
 * and no policy that could consult one.
 */
export function pickBreaks(lines: readonly BreakLine[], blocks: readonly BreakBlock[], policy: BreakPolicy): BreakResult {
  const { pageH, topM, phone, refListPos, posOf } = policy
  const textArea = textAreaPx(pageH, topM)
  const bottomMargin = (brokeUsed: number) => phone ? PHONE_PAGE_MARGIN_BOTTOM : Math.max(MARGIN_BOTTOM, pageH - topM - brokeUsed)
  const picks: BreakPick[] = []
  const sig: string[] = []
  let used = 0
  let pageNo = 1
  let refBroken = false
  // `curBlock = -1` after a break: the block-on-page baseline (orphan counting) restarts per page.
  let curBlock = -1, blockStartUsed = 0
  let lastBreakAt = -1 // guards the block snap against pushing an over-tall block forever
  for (let i = 0; i < lines.length; i++) {
    const lh = i < lines.length - 1 ? Math.max(1, lines[i + 1].top - lines[i].top) : 24
    if (lines[i].blockIdx !== curBlock) {
      curBlock = lines[i].blockIdx
      blockStartUsed = used
    }
    const blockStart = blocks[lines[i].blockIdx]?.start ?? -1
    // Block-level test: a line is at/after the refList exactly when its block starts at/after it.
    if (refListPos > 0 && !refBroken && blockStart >= refListPos && used > 4) {
      const botMargin = bottomMargin(used)
      picks.push({ kind: 'ref', lineIdx: i, at: refListPos, snap: false, midBlock: false, brokeUsed: used, botMargin, pageNo })
      sig.push(`ref:${refListPos}:${Math.round(botMargin)}`)
      pageNo++; used = 0; curBlock = -1; refBroken = true; lastBreakAt = refListPos
    }
    // Break before the LINE that would overflow the text area.
    if (i > 0 && used + lh > textArea) {
      const pos = posOf(i)
      if (pos > 0) {
        const orphan = used - blockStartUsed // height of the current block already on this page
        const snap = snapDecision(policy.snap, { orphan, blockStart, lastBreakAt, textArea })
        const at = snap ? blockStart : pos
        const brokeUsed = snap ? blockStartUsed : used
        const botMargin = bottomMargin(brokeUsed)
        // The line before the break is in the SAME block ⇒ this block spans the boundary.
        const midBlock = lines[i - 1].blockIdx === lines[i].blockIdx
        if (at > 0 && !(refBroken && at === refListPos)) {
          picks.push({ kind: 'line', lineIdx: i, at, snap, midBlock, brokeUsed, botMargin, pageNo })
          sig.push(`${at}:${Math.round(botMargin)}`)
          pageNo++
          lastBreakAt = at
          used = snap ? orphan : 0 // snapped: the orphan lines move to the next page; else line i starts it
          curBlock = -1            // recompute the block-on-page baseline at the next line
        }
      }
    }
    used += lh
  }
  sig.push(`pages:${pageNo}`)
  return { picks, pages: pageNo, lastUsed: used, sig: sig.join('|') }
}
