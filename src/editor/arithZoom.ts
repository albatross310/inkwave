// ARITHMETIC WINDOWED ZOOM (2026-07-15 — consumes the frozen arithmeticLayout engine; option (b)).
//
// During a live font-reflow zoom / pinch gesture the editor puts content-visibility:auto on every
// block and gives each a PLACEHOLDER height (contain-intrinsic-size) so the browser skips laying out
// off-screen blocks (see Scroll.tsx enterZoomLive). The historic placeholder = gesture-start height ×
// (z/z0)² — an APPROXIMATION: font-reflow rewraps discretely (lines-per-block jumps), so a block's
// real height is NOT a smooth (z/z0)² of its start height. The error drives two live bugs:
//   • the browser re-evaluates content-visibility relevancy between frames; each wave shifts the
//     off-screen placeholder mass, moving the pinned focal text a frame before the guard re-pins it
//     (the "anchoring jumps around as you zoom" report — worse the bigger the doc);
//   • at gesture end the class is removed and the WHOLE document re-lays-out at the final font in one
//     synchronous reflow (measured 2688ms @40k words, 4× CPU) — the "reflow-zoom lag scales with doc
//     size" report.
//
// This module computes the EXACT per-block height at the target zoom, reflow-free, via
// arithmeticLayout.layoutParagraph (canvas advances + greedy wrap — proven byte-identical for the
// certified font palette). Writing those as the placeholder sizes makes the skipped geometry EXACT,
// so relevancy waves stop moving the focal text (fixes the anchor jump) and the gesture-end un-skip
// can be deferred off the critical path (fixes the doc-size lag). ELIGIBILITY is the engine's:
// certified-font uniform-size text paragraphs (+ block math when a box is supplied) resolve
// arithmetically; citations / inline-math / mixed-size / uncertified / lists DEFER and keep the old
// (z/z0)² placeholder — graceful degradation, exact where we can prove it.
//
// Pure-ish: reads the ProseMirror doc MODEL (no layout reads) + a canvas measure + a base-font/width
// sample taken once at gesture start. No arithmeticLayout edits — this is a consumer.

import type { Node as PMNode } from '@tiptap/pm/model'
import {
  type ArithBlock, type InlineRun, type Measure,
  blockEligibility, layoutParagraph, isCertifiedStack,
} from './arithmeticLayout'

const DEFAULT_STACK = "'EB Garamond', Georgia, serif"

// Resolve a textStyle fontSize attr (em / rem / px) to px against the block base.
function resolveSizePx(v: unknown, basePx: number): number {
  if (typeof v !== 'string') return basePx
  const s = v.trim()
  if (s.endsWith('em') && !s.endsWith('rem')) return basePx * parseFloat(s)
  if (s.endsWith('rem')) return 16 * parseFloat(s)
  if (s.endsWith('px')) return parseFloat(s)
  const n = parseFloat(s)
  return isNaN(n) ? basePx : n
}

// One PM text node → InlineRun (INTRINSIC sizes at the canonical base; zoom is applied later by
// scaling baseFontPx). Mirrors the prover's runOf: bold→700, italic, textStyle.fontFamily/fontSize.
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

export interface ArithBlockInfo {
  arith: ArithBlock
  eligible: boolean   // did blockEligibility pass (at the canonical base — zoom-invariant)?
  reason: string
}

// Extract every TOP-LEVEL block of the doc as an ArithBlock at the INTRINSIC (canonical) base font.
// `mathEligible=false` (inline-math gate) by default per the engine's wire-in note — inline-math
// paragraphs defer until the collectLines pill rect-fix lands. Block-math is eligible only if a
// blockBox provider is supplied; here we have none, so mathBlock/lists/etc. defer (kept approximate).
export function extractArithBlocks(doc: PMNode, basePx: number, mathEligible = false): ArithBlockInfo[] {
  const out: ArithBlockInfo[] = []
  doc.forEach((block) => {
    let arith: ArithBlock
    if (block.type.name === 'paragraph') {
      const runs: InlineRun[] = []
      block.forEach((child) => {
        if (child.type.name === 'text') runs.push(runOf(child, basePx))
        else if (child.type.name === 'hardBreak')
          runs.push({ text: '\n', fontFamily: DEFAULT_STACK, fontSizePx: basePx, fontWeight: 400, italic: false })
        else // inline atom (citation / inline math) with NO box supplied → the block will defer
          runs.push({ text: '', fontFamily: DEFAULT_STACK, fontSizePx: basePx, fontWeight: 400, italic: false, atomic: true, atomType: child.type.name })
      })
      arith = { type: 'paragraph', runs, baseFontPx: basePx, marginTopPx: 0, marginBottomPx: 0 }
    } else {
      // Non-paragraph blocks (headings, lists, math, hr, refList) — no reflow-free box here → defer.
      arith = { type: block.type.name, runs: [], baseFontPx: basePx, marginTopPx: 0, marginBottomPx: 0 }
    }
    const elig = blockEligibility(arith, 1.618, mathEligible)
    out.push({ arith, eligible: elig.eligible && arith.type === 'paragraph', reason: elig.reason })
  })
  return out
}

// Scale a block's intrinsic runs + base by `zoom` (font-reflow zoom multiplies every font size).
function scaledBlock(b: ArithBlock, zoom: number): ArithBlock {
  return {
    ...b,
    baseFontPx: b.baseFontPx * zoom,
    runs: b.runs.map((r) => ({ ...r, fontSizePx: r.fontSizePx * zoom })),
  }
}

// EXACT content height (px) of an eligible block at `zoom`, reflow-free. contentWidthPx is the text
// column width (fixed under font-reflow zoom). Returns null for a deferred block (caller keeps the
// (z/z0)² approximation). Only eligible paragraphs whose faces are loaded are computed.
export function exactBlockHeightAtZoom(
  info: ArithBlockInfo, contentWidthPx: number, ratio: number, zoom: number, measure: Measure,
  fontLoaded: (stack: string, sizePx: number) => boolean,
): number | null {
  if (!info.eligible) return null
  const b = info.arith
  for (const r of b.runs) if (r.text !== '\n' && !fontLoaded(r.fontFamily, r.fontSizePx * zoom)) return null
  return layoutParagraph(scaledBlock(b, zoom), contentWidthPx, ratio, measure).height
}

export { isCertifiedStack }
