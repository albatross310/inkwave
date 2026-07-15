// ARITHMETIC CANONICAL MEASURE (Decision 6, 2026-07-15 — flag `inkwave:arithLayout`, default OFF).
// The THIRD acquisition path for the pagination measure: instead of forcing a full-document browser
// reflow (canonicalMeasure) and reading each block's line geometry with range.getClientRects,
// COMPUTE the canonical lines + block boundaries from the arithmeticLayout engine (canvas advances +
// greedy wrap — proven byte-identical for the certified font palette). Output is the SAME
// {lines, blocks} shape collectLines produces, feeding the SAME computeBreaks — so break positions +
// page-break signature are byte-identical, and the caller can SKIP forceCanonicalContext entirely
// (no visible-tree reflow) on the paths where the live layout isn't already canonical (phone).
//
// SCOPE OF THIS FIRST VERSION (conservative — correctness over coverage): the whole document must be
// arithmetic-eligible TEXT PARAGRAPHS (certified uniform-size fonts, no citations / inline-math /
// lists / rules / refList / headings). ANY ineligible block ⇒ return null ⇒ caller falls back to the
// DOM measure. Uniform-size + leading-free means firstLineLeadingPx=0 is byte-identical (the leading
// only shifts the cosmetic botMargin at a SIZE boundary, which an all-body-text doc never has). The
// idle DOM verifier + pagCheck remain the safety net. Extending eligibility (headings via the
// per-font leading table, block-math via a cached KaTeX box, per-region scoped use) is the follow-up.

import type { Node as PMNode } from '@tiptap/pm/model'
import {
  type ArithBlock, type InlineRun, type Measure,
  blockEligibility, layoutParagraph, isCertifiedStack,
} from './arithmeticLayout'

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
  return { text: node.text || '', fontFamily: family, fontSizePx: size, fontWeight: weight, italic }
}

export interface ArithLine { top: number; blockIdx: number; pos: number }
export interface ArithMeasureResult { lines: ArithLine[]; blocks: Array<{ start: number; end: number }> }

// `fontLoaded(stack, sizePx)` gates a text run whose face isn't loaded (measureText would fall back
// to a system face). `ratio` = the render context's line-height (1.618 desktop / 1.55 phone / the
// live --inkwave-lh). `contentWidthPx` = the CANONICAL content width (pageWidthPx − 2·sideMargin).
export function buildArithMeasure(
  doc: PMNode,
  contentWidthPx: number,
  ratio: number,
  paraSpacingEm: number,
  measure: Measure,
  fontLoaded: (stack: string, sizePx: number) => boolean,
  mathEligible = false,
  basePx = 18, // base font px: 18 = canonical 1.125rem (Decision 6); the LIVE render font for renderFill
): ArithMeasureResult | null {
  const CANON_BASE = basePx
  const items: Array<{ node: PMNode; offset: number }> = []
  doc.forEach((node, offset) => { items.push({ node, offset }) })
  if (!items.length) return null

  const lines: ArithLine[] = []
  const blocks: Array<{ start: number; end: number }> = []
  let top = 0
  for (const { node, offset } of items) {
    if (node.type.name !== 'paragraph') return null // first version: text paragraphs only
    const runs: InlineRun[] = []
    node.forEach((child) => {
      if (child.type.name === 'text') runs.push(runOf(child, CANON_BASE))
      else if (child.type.name === 'hardBreak')
        runs.push({ text: '\n', fontFamily: DEFAULT_STACK, fontSizePx: CANON_BASE, fontWeight: 400, italic: false })
      else // inline atom (citation / inline math) with no box → makes the block ineligible below
        runs.push({ text: '', fontFamily: DEFAULT_STACK, fontSizePx: CANON_BASE, fontWeight: 400, italic: false, atomic: true, atomType: child.type.name })
    })
    const arith: ArithBlock = {
      type: 'paragraph', runs, baseFontPx: CANON_BASE,
      marginTopPx: 0, marginBottomPx: paraSpacingEm * CANON_BASE, firstLineLeadingPx: 0,
    }
    if (!blockEligibility(arith, ratio, mathEligible).eligible) return null
    for (const r of runs) if (r.text !== '\n' && !r.atomic && !fontLoaded(r.fontFamily, r.fontSizePx)) return null
    const lay = layoutParagraph(arith, contentWidthPx, ratio, measure)
    const bi = blocks.length
    blocks.push({ start: offset, end: offset + node.nodeSize })
    for (let k = 0; k < lay.lineCount; k++)
      lines.push({ top: top + lay.relTops[k], blockIdx: bi, pos: offset + 1 + lay.breakStartChars[k] })
    // Next block is a paragraph (marginTop 0), so the adjacent-margin collapse is just marginBottom.
    top += lay.height + arith.marginBottomPx
  }
  return { lines, blocks }
}

export { isCertifiedStack }
