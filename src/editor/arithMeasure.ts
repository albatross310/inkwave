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

// MARKS THIS ENGINE MODELS — and marks it has PROVED it may ignore. Anything else DEFERS.
//
// WHY AN ALLOWLIST (2026-07-18, `typematrix.prove.mjs`). `runOf` used to walk `node.marks` and act
// on bold/italic/textStyle, SILENTLY IGNORING every other mark. For a metric-neutral mark that is
// right by luck; for `code` it was right by nothing at all. The `code` mark renders the run in a
// MONOSPACE face, and the engine measured it in the body font: MEASURED against the live editor on
// a 13k-word fixture with 434 code runs — **the model said 47 pages, the editor 79, and NOT ONE of
// its 79 break positions matched (first divergence at break 0, Δ955)**. It reported
// `estimatedBlocks 0` and full reliability the whole time. Wrong words on every page, declared
// trustworthy — the worst failure this renderer can produce.
//
// The gate is modelled on `isCertifiedStack`, which already does exactly this for FONTS: an
// allowlist, and anything outside it defers to the DOM measure rather than being guessed. The
// property that matters is what happens to the NEXT mark someone adds to the schema — today it
// would silently corrupt every break below it; with this it defers and says so.
//
// METRIC_NEUTRAL is not an assumption: every family below is PROVED byte-identical to the live
// editor by typematrix.prove.mjs at ~46 breaks/fixture (underline, strike, highlight, scasSlot,
// comment, insertion, deletion — decorations and colour, no advance change). If a future change
// gives one of them a metric (padding, a font swap), its row goes red and this list is the first
// place to look.
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
  // An unmodelled mark rides the run so blockEligibility can refuse the block. It is carried as a
  // REASON rather than acted on here: this function's job is metrics, and inventing a metric for a
  // mark we have not certified is precisely the bug.
  const bad = unmodelledMark(node)
  return { text: node.text || '', fontFamily: family, fontSizePx: size, fontWeight: weight, italic, ...(bad ? { unmodelledMark: bad } : {}) }
}

// One paragraph's inline content → engine runs. SHARED by the whole-doc path and the scoped
// per-block path so the two can never drift apart.
//
// INLINE ATOMS: a CITATION is a proven opaque box (CitationNodeView pins white-space: nowrap, so
// its label has no internal break opportunity and its `normal`-mode subtree cannot reach the
// parent's line breaking) — it supplies the cached canonical box harvested by the DOM measure
// (citations/citeBox.ts). Anything else (inline MATH) supplies NO box, so blockEligibility's
// `!r.box` gate defers the whole block — exactly the gate we want until its own rect-fix lands.
// Marked citations cache under their own FONT KEY: real ones nearly always carry a
// textStyle{fontFamily} mark, so skipping them would defer ~every citation-bearing block.
function runsOfParagraph(node: PMNode, basePx: number, citationStyle: string, bibEpoch: number): InlineRun[] {
  const runs: InlineRun[] = []
  node.forEach((child) => {
    if (child.type.name === 'text') runs.push(runOf(child, basePx))
    else if (child.type.name === 'hardBreak')
      runs.push({ text: '\n', fontFamily: DEFAULT_STACK, fontSizePx: basePx, fontWeight: 400, italic: false })
    else {
      // basePx joins the box lookup: the label sets in `font: inherit`, so its advance is base-
      // dependent (117px at canonical 18, 143px at the phone's 22.5 render base). A box harvested at
      // a different base MISSES ⇒ this block defers to the DOM measure rather than wrap on a width
      // that is ~26px wrong per citation. See citations/citeBox.ts keyOf.
      const box = child.type.name === 'citation'
        ? citeBox((child.attrs.citekeys as string[]) ?? [], citationStyle, bibEpoch, citeFontKey(child.marks), basePx) ?? undefined
        : undefined
      runs.push({ text: '', fontFamily: DEFAULT_STACK, fontSizePx: basePx, fontWeight: 400, italic: false, atomic: true, atomType: child.type.name, box })
    }
  })
  return runs
}

// ── ONE block, laid out arithmetically (the scoped/per-region seam) ─────────────────────────────
// computeScoped's whole cost is measuring the CHANGED blocks live — which is what forces the
// canonical context and pays its two full-document reflows (the 400–1100ms phone pause). When every
// changed block is arithmetic-eligible we can produce the SAME per-block geometry with no DOM at
// all, so the scoped measure needs no forced context and no reflow. Unchanged blocks already reuse
// their cached entries, so a typing pause in ordinary prose becomes pure arithmetic.
//
// `relPos` is the payoff: the DOM path leaves each line's doc position LAZY and pays a posAtCoords
// hit-test for the one line a break lands on. Arithmetically the position is exact and free —
// relPos = 1 + charIndex (the block's content starts at offset+1) — so nothing is ever hit-tested.
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

// `fontLoaded(stack, sizePx)` gates a text run whose face isn't loaded (measureText would fall back
// to a system face). `ratio` = the render context's line-height (1.618 desktop / 1.55 phone / the
// live --inkwave-lh). `contentWidthPx` = the CANONICAL content width (pageWidthPx − 2·sideMargin).
// `forcedBreaks` — doc positions at which a line MUST start (the mid-block canonical break `at`
// positions from computeBreaks). The RENDER pass needs these: a page-gap widget is display:block
// inside the `<p>`, so it ends the pre-gap line partial and text resumes AFTER the gap; without it
// the continuous wrap fills that slack and loses a render line, drifting every band below. The
// CANONICAL pass passes none (it PRODUCES the breaks; feeding them back would be circular and its
// own gaps are cleared before it measures). Absent ⇒ byte-identical to the gap-free layout.
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
