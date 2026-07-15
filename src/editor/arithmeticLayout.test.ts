import { describe, it, expect } from 'vitest'
import {
  CERTIFIED_FAMILIES, primaryFamily, isCertifiedStack, blockEligibility, snappedLineHeight,
  cssFontOf, layoutParagraph, resolveBlocks, paginate, figureBlockBox,
  hangsTrailingSpace, EDITOR_WHITE_SPACE,
  type ArithBlock, type InlineRun, type InlineBox, type Measure,
} from './arithmeticLayout'

// The canvas measure is browser-only; the pure layout/pagination logic is deterministic under a
// STUB measure. These tests pin the wrap algorithm, the LayoutUnit line-height snap, margin
// collapse, the eligibility boundary, and the computeBreaks port — everything the browser prover
// (scripts/arithmeticLayout.prove.mjs) then verifies is byte-identical to the real DOM measure.

const EB = "'EB Garamond', Georgia, serif"
const run = (text: string, over: Partial<InlineRun> = {}): InlineRun =>
  ({ text, fontFamily: EB, fontSizePx: 18, fontWeight: 400, italic: false, ...over })
const para = (runs: InlineRun[], over: Partial<ArithBlock> = {}): ArithBlock =>
  ({ type: 'paragraph', runs, baseFontPx: 18, marginTopPx: 0, marginBottomPx: 9, ...over })

// Monospace stub: every char is `w` px in that run's font size (so wrapping is exactly predictable).
const stubMeasure = (w = 10): Measure => (text, cssFont) => {
  const m = cssFont.match(/(\d+(?:\.\d+)?)px/)
  const size = m ? parseFloat(m[1]) : 18
  return text.length * w * (size / 18)
}

describe('certification', () => {
  it('has the 17 cross-engine-verified families', () => {
    expect(CERTIFIED_FAMILIES.size).toBe(17)
    expect(CERTIFIED_FAMILIES.has('EB Garamond')).toBe(true)
    expect(CERTIFIED_FAMILIES.has('Times New Roman')).toBe(false)
  })
  it('excludes Inter — it certifies on both engines but its DOM wrap differs across them (opsz)', () => {
    expect(CERTIFIED_FAMILIES.has('Inter')).toBe(false)
  })
  it('excludes Lora/Gelasio — no longer served, so their marks fall back to system fonts', () => {
    expect(CERTIFIED_FAMILIES.has('Lora')).toBe(false)
    expect(CERTIFIED_FAMILIES.has('Gelasio')).toBe(false)
  })
  it('includes the newly-verified faces', () => {
    for (const f of ['Libre Baskerville', 'Caladea', 'Zilla Slab', 'Courier Prime']) {
      expect(CERTIFIED_FAMILIES.has(f), f).toBe(true)
    }
  })
  it('parses the primary family out of a stack (quoted or bare)', () => {
    expect(primaryFamily(EB)).toBe('EB Garamond')
    expect(primaryFamily('"Crimson Pro", serif')).toBe('Crimson Pro')
    expect(primaryFamily('JetBrains Mono')).toBe('JetBrains Mono')
  })
  it('certifies by the primary family only', () => {
    expect(isCertifiedStack(EB)).toBe(true)
    expect(isCertifiedStack("'Cambria', Georgia, serif")).toBe(false)
    expect(isCertifiedStack("'Times New Roman', serif")).toBe(false)
  })
})

describe('snappedLineHeight (LayoutUnit floor — matches the browser)', () => {
  it('18px φ → 1863/64 = 29.109375 (NOT the naive 29.124)', () => {
    expect(snappedLineHeight(18, 1.618)).toBeCloseTo(29.109375, 6)
  })
  it('24px φ → 2485/64 = 38.828125', () => {
    expect(snappedLineHeight(24, 1.618)).toBeCloseTo(38.828125, 6)
  })
})

describe('eligibility boundary', () => {
  it('plain certified paragraph is eligible', () => {
    expect(blockEligibility(para([run('hello world')])).eligible).toBe(true)
  })
  it('empty paragraph is eligible', () => {
    expect(blockEligibility(para([])).reason).toBe('paragraph:empty')
  })
  it('same-size bold/italic runs are eligible', () => {
    const b = para([run('a', { fontWeight: 700 }), run('b', { italic: true })])
    expect(blockEligibility(b).eligible).toBe(true)
  })
  it('an inline atom (citation/math) defers the whole block', () => {
    const b = para([run('see '), run('(Author 2020)', { atomic: true })])
    expect(blockEligibility(b)).toEqual({ eligible: false, reason: 'inline-atom' })
  })
  it('an uncertified font defers', () => {
    const b = para([run('x', { fontFamily: "'Cambria', serif" })])
    expect(blockEligibility(b).reason).toBe('uncertified:Cambria')
  })
  it('a MIXED font-size paragraph defers (unstable DOM reference)', () => {
    const b = para([run('a', { fontSizePx: 18 }), run('b', { fontSizePx: 24 })])
    expect(blockEligibility(b)).toEqual({ eligible: false, reason: 'mixed-size' })
  })
  it('non-paragraph blocks defer with their type', () => {
    expect(blockEligibility({ ...para([]), type: 'horizontalRule' }).reason).toBe('block:horizontalRule')
  })
})

describe('greedy wrap — the fit test is white-space dependent', () => {
  const measure = stubMeasure(10) // 10px/char @18px → content width 100px = 10 chars/line
  // "aaa bbb ccc" at width 70. bare("aaa bbb")=70, full("aaa bbb ")=80.
  //   break-spaces (THE EDITOR): the trailing space COUNTS → "bbb " (80) overflows → wraps at 4.
  //   normal/pre-wrap:           the trailing space HANGS  → bare 70 fits → only "ccc" wraps at 8.
  // Both are real browser behaviours (1/64px-swept); the editor is break-spaces, hence the default.
  it('break-spaces (the editor default): the trailing space COUNTS — no hang', () => {
    const lay = layoutParagraph(para([run('aaa bbb ccc')]), 70, 1.618, measure)
    expect(lay.lineCount).toBe(2)
    expect(lay.breakStartChars).toEqual([0, 4]) // "bbb ccc" pushed to line 2
  })
  it('normal: the trailing space HANGS past the edge', () => {
    const lay = layoutParagraph(para([run('aaa bbb ccc')]), 70, 1.618, measure, 'normal')
    expect(lay.lineCount).toBe(2)
    expect(lay.breakStartChars).toEqual([0, 8]) // second line starts at "ccc"
  })
  it('pre-wrap hangs too; break-spaces is the only no-hang mode', () => {
    expect(hangsTrailingSpace('normal')).toBe(true)
    expect(hangsTrailingSpace('pre-wrap')).toBe(true)
    expect(hangsTrailingSpace('break-spaces')).toBe(false)
    expect(EDITOR_WHITE_SPACE).toBe('break-spaces')
  })
  it('block height = lineCount × snapped line height', () => {
    const lay = layoutParagraph(para([run('aaa bbb ccc')]), 70, 1.618, measure)
    expect(lay.height).toBeCloseTo(2 * snappedLineHeight(18, 1.618), 6)
  })
  it('a hard break forces a new line', () => {
    const lay = layoutParagraph(para([run('ab\ncd')]), 1000, 1.618, measure)
    expect(lay.lineCount).toBe(2)
  })
  it('an empty paragraph is one strut-height line', () => {
    const lay = layoutParagraph(para([]), 500, 1.618, measure)
    expect(lay.lineCount).toBe(1)
    expect(lay.height).toBeCloseTo(snappedLineHeight(18, 1.618), 6)
  })
  it('a word straddling two runs is measured piece-by-piece (cross-run token)', () => {
    // "hel" (bold) + "lo world" — the word "hello" spans both runs; width = 5 chars regardless.
    const b = para([run('hel', { fontWeight: 700 }), run('lo world')])
    const lay = layoutParagraph(b, 55, 1.618, measure) // "hello "(60 full/50 bare) fits width 55
    expect(lay.lineCount).toBe(2) // "hello " then "world"
    expect(lay.breakStartChars).toEqual([0, 6])
  })
})

describe('resolveBlocks — arithmetic where eligible, DOM otherwise, margin collapse', () => {
  const measure = stubMeasure(10)
  it('collapses adjacent margins (max, not sum) below an eligible paragraph', () => {
    const p = para([run('a')]) // 1 line, marginBottom 9
    const hr: ArithBlock = { type: 'horizontalRule', runs: [], baseFontPx: 18, marginTopPx: 12, marginBottomPx: 12 }
    const res = resolveBlocks([p, hr], 500, 1.618, measure, () => ({ relTops: [0], advance: 13 }))
    // advance below the paragraph = height(29.109) + max(9,12) = 41.109, NOT +9
    expect(res[0].advance).toBeCloseTo(snappedLineHeight(18, 1.618) + 12, 6)
    expect(res[0].eligible).toBe(true)
    expect(res[1].eligible).toBe(false) // hr → DOM measure
  })
  it('defers ineligible blocks to the injected DOM measure', () => {
    const cite = para([run('see '), run('(A 2020)', { atomic: true })])
    const res = resolveBlocks([cite], 500, 1.618, measure, () => ({ relTops: [0, 30], advance: 60 }))
    expect(res[0].eligible).toBe(false)
    expect(res[0].reason).toBe('inline-atom')
    expect(res[0].advance).toBe(60) // from the DOM measure
  })
  it('an eligible block with an unloaded face defers (the gate)', () => {
    const p = para([run('hello')])
    const res = resolveBlocks([p], 500, 1.618, measure, () => ({ relTops: [0], advance: 40 }), () => false)
    expect(res[0].reason).toBe('fonts-unloaded')
    expect(res[0].advance).toBe(40)
  })
})

describe('paginate (port of computeBreaks)', () => {
  it('breaks before the line that overflows the text area; counts pages', () => {
    // pageH 1122.52, topM 96, botM 72 → textArea 954.52; lines every 29.109px.
    const pageH = 1122.52, topM = 96
    const lh = snappedLineHeight(18, 1.618)
    const lines = Array.from({ length: 80 }, (_, i) => ({ top: i * lh, blockIdx: i, pos: (i + 1) * 1000 }))
    const blocks = lines.map((_, i) => ({ start: (i + 1) * 1000 }))
    const r = paginate(lines, blocks, -1, pageH, topM)
    expect(r.pages).toBeGreaterThan(1)
    // Break before the line i where used+lh exceeds the text area: smallest i with (i+1)·lh > textArea.
    const textArea = pageH - topM - 72
    const breakLine = Math.ceil(textArea / lh) - 1        // the overflowing line's index
    expect(r.breaks[0].at).toBe((breakLine + 1) * 1000)   // its synthetic pos = (i+1)·1000
  })
  it('is deterministic — same input, same signature', () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ top: i * 29.109375, blockIdx: i, pos: (i + 1) * 1000 }))
    const blocks = lines.map((_, i) => ({ start: (i + 1) * 1000 }))
    const a = paginate(lines, blocks, -1, 1122.52, 96)
    const b = paginate(lines, blocks, -1, 1122.52, 96)
    expect(a.sig).toBe(b.sig)
  })
  it('forces the reference list onto a fresh page', () => {
    const lh = 29.109375
    const lines = Array.from({ length: 20 }, (_, i) => ({ top: i * lh, blockIdx: i, pos: (i + 1) * 1000 }))
    const blocks = lines.map((_, i) => ({ start: (i + 1) * 1000 }))
    const refListPos = 10000 // block index 9
    const r = paginate(lines, blocks, refListPos, 1122.52, 96)
    expect(r.breaks.some((b) => b.at === refListPos)).toBe(true)
  })
})

describe('cssFontOf', () => {
  it('builds the canvas/DOM font shorthand', () => {
    expect(cssFontOf({ fontFamily: EB, fontSizePx: 18, fontWeight: 700, italic: true }))
      .toBe(`italic 700 18px ${EB}`)
  })
})

// ─── The measurable-element generalization: math + figures ──────────────────────────────────────
const mathBox = (adv: number, demand: number): InlineBox => ({ advanceWidth: adv, lineHeightDemand: demand })
const mathRun = (box: InlineBox, atomType = 'mathInline'): InlineRun =>
  ({ text: '', fontFamily: EB, fontSizePx: 18, fontWeight: 400, italic: false, atomic: true, atomType, box })

describe('white-space eligibility guard', () => {
  it('a run in a DIFFERENT white-space mode than the block DEFERS (mixed-mode line)', () => {
    // The editor flips per subtree: .ProseMirror [contenteditable=false] { white-space: normal }.
    // A citation NodeView is display:inline, so its `normal` label text flows in the parent's
    // break-spaces line — two wrap rules on one line. Unmodelled ⇒ defer, never guess.
    const b = para([run('body text '), run('(Author 2020)', { whiteSpace: 'normal' })])
    expect(blockEligibility(b).reason).toBe('mixed-whitespace:normal')
  })
  it('a block in an unproven mode DEFERS (normal also collapses spaces — not modelled)', () => {
    const b = para([run('hello world')])
    expect(blockEligibility(b, 1.618, true, 'normal').reason).toBe('whitespace-unproven:normal')
  })
  it('uniform break-spaces runs are eligible', () => {
    const b = para([run('a ', { whiteSpace: 'break-spaces' }), run('b')])
    expect(blockEligibility(b).eligible).toBe(true)
  })
})

describe('inline math eligibility', () => {
  it('a paragraph with a boxed inline-math atom is eligible (text+math)', () => {
    const b = para([run('the value '), mathRun(mathBox(30, 34)), run(' is bounded')])
    expect(blockEligibility(b)).toEqual({ eligible: true, reason: 'paragraph:text+math' })
  })
  it('gating math OFF (collectLines fix not yet in place) defers it', () => {
    const b = para([run('x '), mathRun(mathBox(30, 34))])
    expect(blockEligibility(b, 1.618, false).reason).toBe('inline-atom-gated:mathInline')
  })
  it('a citation atom (no box) always defers', () => {
    const b = para([run('see '), { text: '(A 2020)', fontFamily: EB, fontSizePx: 18, fontWeight: 400, italic: false, atomic: true, atomType: 'citation' }])
    expect(blockEligibility(b)).toEqual({ eligible: false, reason: 'inline-atom:citation' })
  })
})

describe('inline math layout (unbreakable box, line-height demand)', () => {
  const measure = stubMeasure(10)
  it('a tall inline atom raises ITS line to the atom demand; the atom is unbreakable', () => {
    // "aa " + math(adv 30, demand 34) + " bb" — one line, height = max(strut, 34) = 34.
    const lay = layoutParagraph(para([run('aa '), mathRun(mathBox(30, 34)), run(' bb')]), 1000, 1.618, measure)
    expect(lay.lineCount).toBe(1)
    expect(lay.lineHeights[0]).toBeCloseTo(34, 6)
  })
  it('a fitting inline atom (demand ≤ strut) leaves the line at the strut', () => {
    const lay = layoutParagraph(para([run('aa '), mathRun(mathBox(30, 28)), run(' bb')]), 1000, 1.618, measure)
    expect(lay.lineHeights[0]).toBeCloseTo(snappedLineHeight(18, 1.618), 6)
  })
  it('the atom advance participates in the wrap and never breaks internally', () => {
    // width 45: "aa "(30) fits; then math(30) overflows (30+30 > 45) → wraps whole to line 2.
    const lay = layoutParagraph(para([run('aa '), mathRun(mathBox(30, 20))]), 45, 1.618, measure)
    expect(lay.lineCount).toBe(2)
  })
})

describe('block math / figure (block atoms)', () => {
  const measure = stubMeasure(10)
  const mathBlock = (h: number): ArithBlock =>
    ({ type: 'mathBlock', runs: [], baseFontPx: 18, marginTopPx: 9, marginBottomPx: 9, blockBox: { height: h, marginTopPx: 9, marginBottomPx: 9 } })
  it('a block-atom with a box is eligible', () => {
    expect(blockEligibility(mathBlock(60)).reason).toBe('block-atom:mathBlock')
  })
  it('a block-atom without a box defers', () => {
    expect(blockEligibility({ ...mathBlock(60), blockBox: undefined }).reason).toBe('block:mathBlock')
  })
  it('resolveBlocks lays a block-atom as one unbreakable region (atomLike, collapsed advance)', () => {
    const p = para([run('x')])
    const res = resolveBlocks([mathBlock(60), p], 500, 1.618, measure, () => ({ relTops: [0], advance: 40 }))
    expect(res[0].eligible).toBe(true)
    expect(res[0].atomLike).toBe(true)
    expect(res[0].relTops).toEqual([0])
    expect(res[0].advance).toBeCloseTo(60 + Math.max(9, 0), 6) // height + collapse(mb9, next para mt0)
  })
  it('figureBlockBox scales an over-wide figure to the column and adds the caption', () => {
    // 1200×600 intrinsic in a 600px column → scale 0.5 → 300px image + 20px gap + 40px caption.
    const box = figureBlockBox({ intrinsicWidthPx: 1200, intrinsicHeightPx: 600, contentWidthPx: 600, captionHeightPx: 40, captionGapPx: 20, marginBottomPx: 9 })
    expect(box.height).toBeCloseTo(300 + 20 + 40, 6)
    expect(box.marginBottomPx).toBe(9)
  })
})
