// ARITHMETIC CANONICAL MEASURE — the THIRD acquisition path for the pagination measure (flag
// `inkwave:arithLayout`, default OFF). Computes the canonical lines + block boundaries from the
// arithmeticLayout engine instead of forcing a reflow and reading `range.getClientRects`. Output is
// the SAME {lines, blocks} shape collectLines produces, feeding the SAME computeBreaks — so break
// positions and the page-break signature are byte-identical.
//
// ⚠ CONSERVATIVE BY CONSTRUCTION: ANY ineligible block ⇒ return null ⇒ the caller falls back to the
// DOM measure. It never approximates, it DEFERS (R8). The idle DOM verifier + pagCheck are the net.
// → docs/archive/pagination-rounds.md#arith-measure

import type { Node as PMNode } from '@tiptap/pm/model'
import {
  type ArithBlock, type InlineRun, type Measure,
  blockEligibility, layoutParagraph, isCertifiedStack, EDITOR_WHITE_SPACE,
} from './arithmeticLayout'
import { citeBox, citeFontKey } from '../citations/citeBox'

const DEFAULT_STACK = "'EB Garamond', Georgia, serif"

function resolveSizePx(v: unknown, basePx: number): number {
  if (typeof v !== 'string') return basePx
  const s = v.trim()
  if (s.endsWith('em') && !s.endsWith('rem')) return basePx * parseFloat(s)
  if (s.endsWith('rem')) return 16 * parseFloat(s)
  if (s.endsWith('px')) return parseFloat(s)
  const n = parseFloat(s)
  return isNaN(n) ? basePx : n
}

// ⚠ MARKS ARE AN ALLOW-LIST, and anything outside it DEFERS the block to the DOM (R8). `runOf` once
// acted on bold/italic/textStyle and SILENTLY IGNORED every other mark — right by luck for a
// metric-neutral one, right by nothing at all for `code`, which renders MONOSPACE and was measured
// in the body font. Modelled on `isCertifiedStack`, which does the same for fonts (R2).
// ⚠ METRIC_NEUTRAL is PROVED, never assumed (typematrix.prove.mjs) — give one of these a metric and
// its row goes red, and this list is the first place to look (R3).
// → docs/archive/pagination-rounds.md#marks-allowlist
const MODELLED_MARKS = new Set(['bold', 'italic', 'textStyle'])
const METRIC_NEUTRAL_MARKS = new Set(['underline', 'strike', 'highlight', 'scasSlot', 'comment', 'insertion', 'deletion'])

/** A mark this engine can neither model nor prove harmless ⇒ its block must DEFER to the DOM. */
export function unmodelledMark(node: PMNode): string | null {
  for (const m of node.marks || []) {
    const n = m.type.name
    if (!MODELLED_MARKS.has(n) && !METRIC_NEUTRAL_MARKS.has(n)) return n
  }
  return null
}

function runOf(node: PMNode, basePx: number): InlineRun {
  let family = DEFAULT_STACK, size = basePx, weight = 400, italic = false
  for (const m of node.marks || []) {
    if (m.type.name === 'bold') weight = 700
    else if (m.type.name === 'italic') italic = true
    else if (m.type.name === 'textStyle' && m.attrs) {
      if (m.attrs.fontFamily) family = m.attrs.fontFamily as string
      if (m.attrs.fontSize) size = resolveSizePx(m.attrs.fontSize, basePx)
    }
  }
  // ⚠ An unmodelled mark rides the run as a REASON, never as a metric — this function's job is
  // metrics, and inventing one for an uncertified mark IS the bug (R8). blockEligibility refuses it.
  const bad = unmodelledMark(node)
  return { text: node.text || '', fontFamily: family, fontSizePx: size, fontWeight: weight, italic, ...(bad ? { unmodelledMark: bad } : {}) }
}

// One paragraph's inline content → engine runs. SHARED by the whole-doc path and the scoped
// per-block path so the two can never drift apart (R2).
//
// ⚠ A CITATION supplies the cached canonical box (citations/citeBox.ts) because it is a PROVEN
// opaque box; anything else — inline MATH — supplies NONE, and blockEligibility's `!r.box` gate
// then defers the whole block (R8). → docs/archive/pagination-rounds.md#arith-measure
function runsOfParagraph(node: PMNode, basePx: number, citationStyle: string, bibEpoch: number): InlineRun[] {
  const runs: InlineRun[] = []
  node.forEach((child) => {
    if (child.type.name === 'text') runs.push(runOf(child, basePx))
    else if (child.type.name === 'hardBreak')
      runs.push({ text: '\n', fontFamily: DEFAULT_STACK, fontSizePx: basePx, fontWeight: 400, italic: false })
    else {
      // ⚠ basePx joins the box lookup — the label sets in `font: inherit`, so a box harvested at a
      // different base MISSES and this block defers, rather than wrap ~26px wrong per citation (R9).
      const box = child.type.name === 'citation'
        ? citeBox((child.attrs.citekeys as string[]) ?? [], citationStyle, bibEpoch, citeFontKey(child.marks), basePx) ?? undefined
        : undefined
      runs.push({ text: '', fontFamily: DEFAULT_STACK, fontSizePx: basePx, fontWeight: 400, italic: false, atomic: true, atomType: child.type.name, box })
    }
  })
  return runs
}

// ── ONE block, laid out arithmetically (the scoped/per-region seam) ─────────────────────────────
// When every changed block is arithmetic-eligible the scoped measure needs NO forced context and no
// reflow — which is where computeScoped's whole cost lives (two full-document reflows, the
// 400–1100ms phone pause). `relPos` is the payoff: arithmetically a line's doc position is exact and
// free (1 + charIndex), so nothing is ever hit-tested.
// → docs/archive/pagination-rounds.md#arith-measure
export interface ArithBlockLayout {
  relTops: number[]   // per-line top, relative to the block's own top
  relPos: number[]    // per-line doc position, relative to the block's offset (never lazy)
  advance: number     // block top → next block top (height + collapsed margin)
  relEnd: number      // block's doc range end, relative to its offset (= nodeSize)
}

export function arithBlockLayout(
  node: PMNode,
  contentWidthPx: number,
  ratio: number,
  paraSpacingEm: number,
  measure: Measure,
  fontLoaded: (stack: string, sizePx: number) => boolean,
  citationStyle: string,
  bibEpoch: number,
  basePx = 18,
  forcedBreakChars: number[] = [], // block-relative char offsets a line must start at (page gaps)
): ArithBlockLayout | null {
  if (node.type.name !== 'paragraph') return null
  const runs = runsOfParagraph(node, basePx, citationStyle, bibEpoch)
  const arith: ArithBlock = {
    type: 'paragraph', runs, baseFontPx: basePx,
    marginTopPx: 0, marginBottomPx: paraSpacingEm * basePx, firstLineLeadingPx: 0,
  }
  if (!blockEligibility(arith, ratio).eligible) return null
  for (const r of runs) if (r.text !== '\n' && !r.atomic && !fontLoaded(r.fontFamily, r.fontSizePx)) return null
  const lay = layoutParagraph(arith, contentWidthPx, ratio, measure, EDITOR_WHITE_SPACE, forcedBreakChars)
  return {
    relTops: lay.relTops,
    relPos: lay.breakStartChars.map((c) => 1 + c),
    // The caller's guard requires the block after the region to be a paragraph too (marginTop 0),
    // so the adjacent-margin collapse is just this block's marginBottom.
    advance: lay.height + arith.marginBottomPx,
    relEnd: node.nodeSize,
  }
}

export interface ArithLine { top: number; blockIdx: number; pos: number }
export interface ArithMeasureResult { lines: ArithLine[]; blocks: Array<{ start: number; end: number }>; contentHeight: number }

// `fontLoaded(stack, sizePx)` gates a run whose face isn't loaded (measureText would fall back to a
// system face). `ratio` = the render line-height; `contentWidthPx` = the CANONICAL content width.
// ⚠ `forcedBreaks` is for the RENDER pass ONLY. A page-gap widget is display:block, so text resumes
// AFTER the gap and a continuous wrap would fill that slack, lose a line and drift every band below.
// The CANONICAL pass passes NONE — it PRODUCES the breaks, so feeding them back is circular (R7).
// Absent ⇒ byte-identical to the gap-free layout. → docs/archive/pagination-rounds.md#forced-breaks
export function buildArithMeasure(
  doc: PMNode,
  contentWidthPx: number,
  ratio: number,
  paraSpacingEm: number,
  measure: Measure,
  fontLoaded: (stack: string, sizePx: number) => boolean,
  mathEligible = false,
  basePx = 18, // base font px: 18 = canonical 1.125rem (Decision 6); the LIVE render font for renderFill
  citationStyle = '',  // CSL style + bib epoch: the citation box cache key (see citations/citeBox.ts)
  bibEpoch = -1,
  forcedBreaks: number[] = [],
): ArithMeasureResult | null {
  const CANON_BASE = basePx
  const items: Array<{ node: PMNode; offset: number }> = []
  doc.forEach((node, offset) => { items.push({ node, offset }) })
  if (!items.length) return null

  const lines: ArithLine[] = []
  const blocks: Array<{ start: number; end: number }> = []
  let top = 0
  for (const { node, offset } of items) {
    if (node.type.name !== 'paragraph') return null // whole-doc path: text paragraphs only
    const runs = runsOfParagraph(node, CANON_BASE, citationStyle, bibEpoch)
    const arith: ArithBlock = {
      type: 'paragraph', runs, baseFontPx: CANON_BASE,
      marginTopPx: 0, marginBottomPx: paraSpacingEm * CANON_BASE, firstLineLeadingPx: 0,
    }
    if (!blockEligibility(arith, ratio, mathEligible).eligible) return null
    for (const r of runs) if (r.text !== '\n' && !r.atomic && !fontLoaded(r.fontFamily, r.fontSizePx)) return null
    // Mid-block forced line-starts for THIS block: doc pos → block-relative char (pos − offset − 1).
    // A gap AT the block start (charOffset 0) is a no-op; a break past the content never matches.
    const forcedChars = forcedBreaks.length
      ? forcedBreaks.filter((p) => p > offset && p < offset + node.nodeSize).map((p) => p - offset - 1)
      : forcedBreaks
    const lay = layoutParagraph(arith, contentWidthPx, ratio, measure, EDITOR_WHITE_SPACE, forcedChars)
    const bi = blocks.length
    blocks.push({ start: offset, end: offset + node.nodeSize })
    for (let k = 0; k < lay.lineCount; k++)
      lines.push({ top: top + lay.relTops[k], blockIdx: bi, pos: offset + 1 + lay.breakStartChars[k] })
    // Next block is a paragraph (marginTop 0), so the adjacent-margin collapse is just marginBottom.
    top += lay.height + arith.marginBottomPx
  }
  return { lines, blocks, contentHeight: top }
}

export { isCertifiedStack }
