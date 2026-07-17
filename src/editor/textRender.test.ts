import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { paginate, blockEligibility, type SplitLine, type InlineRun, type ArithBlock } from './arithmeticLayout'
import { unmodelledMark } from './arithMeasure'
import { buildRenderModel, pageContainingPos, type RenderGeom } from './textRender'

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

// ── THE LEAF-ATOM POSITION RULE (2026-07-17) ───────────────────────────────────────────────────
// A MEASURED production bug (tail.prove.mjs, real app/fonts/DPR): every placeholder block pushed
// `pos: offset + 1`, which is right for a normal block (content starts past the opening token) and
// WRONG for a LEAF ATOM (referenceList, mathBlock, horizontalRule) — nodeSize 1, occupying exactly
// [offset, offset+1), so offset+1 is the position AFTER it. The trailing refList at start=122267
// took line pos 122268 = doc.content.size, and `pageContainingPos(122267)` — the refList's OWN
// position — returned page 56 while it rendered on 57.
//
// WHY THIS TEST EXISTS AT ALL: an external test auditor mutation-tested the fix out
// (`node.isLeaf ? offset : offset + 1` → `offset + 1`) and THE FULL GATE STAYED GREEN — 79 files,
// all passing. The only guard was a hand-run browser probe, in no CI and no package.json script. A
// proof that ran once and convinced everyone is indistinguishable, six weeks later, from a proof
// that never ran. tail.prove.mjs remains the in-browser truth; THIS is what stops a silent revert.
// Harness adapted from the auditor's own reproduction (audit/probe-atompos.test.ts.txt) rather than
// reinvented — 4-node schema, fake measure, no browser, no canvas, no thesis fixture.
//
// WHY IT CANNOT BE CHECKED FROM THE LINE LIST: pageOfLine, pageTop and the page walk are all built
// FROM the lines, so they agree with each other perfectly under both rules (measured: maxPageOfLine
// === pages-1, pageTopLen === pages, pos monotonic, emptyPages [] — all true, bug present). The
// error is in what a line's pos MEANS. Only a query from OUTSIDE — "which page holds this doc
// position?" — can see it, and that is precisely the seam RichDiffView and the content anchor use.
describe('buildRenderModel — a leaf atom owns its OWN position', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
      // Leaf atoms: no content ⇒ nodeSize 1. Exactly referenceList / mathBlock / horizontalRule.
      referenceList: { group: 'block', atom: true, toDOM: () => ['div'] },
      horizontalRule: { group: 'block', atom: true, toDOM: () => ['hr'] },
      text: { group: 'inline' },
    },
  })
  const GEOM: RenderGeom = {
    pageWidthPx: 794, pageHeightPx: 1123, topMarginPx: 96, sideMarginPx: 96,
    contentWidthPx: 602, basePx: 18, ratio: 1.618, paraSpacingEm: 0.5,
  }
  const measure = (t: string) => t.length * 8
  const fontLoaded = () => true

  const para = (rnd: () => number) => {
    const W = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'.split(' ')
    const out: string[] = []
    for (let i = 0; i < 45; i++) out.push(W[Math.floor(rnd() * W.length)])
    return { type: 'paragraph', content: [{ type: 'text', text: out.join(' ') + '.' }] }
  }
  const rng = () => { let s = 42; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 }

  /** `paras` paragraphs, with `atom` inserted at `at` (or appended when at === paras). */
  const docWith = (paras: number, atom: string, at: number): PMNode => {
    const rnd = rng()
    const content: unknown[] = []
    for (let p = 0; p < paras; p++) {
      if (p === at) content.push({ type: atom })
      content.push(para(rnd))
    }
    if (at >= paras) content.push({ type: atom })
    return schema.nodeFromJSON({ type: 'doc', content })
  }

  /** Every leaf atom's own position must resolve to the page its line actually sits on. */
  const atomsAgree = (doc: PMNode, legacy: boolean) => {
    const w = globalThis as unknown as { window?: { __iwAtomPos?: string } }
    w.window = legacy ? { __iwAtomPos: 'legacy' } : {}
    try {
      const model = buildRenderModel(doc, GEOM, measure, fontLoaded, {})
      const out: Array<{ pos: number; queried: number; actual: number }> = []
      doc.forEach((n, off) => {
        if (!n.isLeaf) return
        const li = model.lines.findIndex((l) => model.blocks[l.blockIdx]?.start === off)
        out.push({ pos: off, queried: pageContainingPos(model, off), actual: li >= 0 ? model.pageOfLine[li] : -1 })
      })
      return out
    } finally { delete w.window }
  }

  for (const [name, doc] of [
    ['a TRAILING refList (the shape measured in the real app)', docWith(60, 'referenceList', 60)],
    ['a MID-DOCUMENT refList', docWith(60, 'referenceList', 30)],
  ] as Array<[string, PMNode]>) {
    it(`the atom's own position resolves to its own page — ${name}`, () => {
      const rows = atomsAgree(doc, false)
      expect(rows.length).toBeGreaterThan(0) // the fixture must actually contain a leaf atom
      for (const r of rows) {
        expect(r.actual).toBeGreaterThanOrEqual(0)
        expect(r.queried).toBe(r.actual)
      }
    })
  }

  // THE KNOWN-NEGATIVE. Without it the assertions above could be passing for any reason at all —
  // and they DID pass, against a mutated build, for the whole life of this fix.
  //
  // IT HAS TO SWEEP PLACEMENTS, and finding that out is the reason this comment exists. The two
  // rules can only DIFFER where the atom's own position and `offset+1` fall on different pages —
  // i.e. where the atom STARTS a page. An atom sitting mid-page resolves to the same page either
  // way, so a single fixed placement is a coin toss: the first cut of this suite tested a
  // `horizontalRule` at index 25, it landed mid-page, and that test PASSED AGAINST THE MUTATED
  // BUILD while its neighbours failed. It asserted a true invariant and discriminated nothing.
  // Sweeping every placement guarantees some atom lands on a page boundary, for each atom type.
  for (const atom of ['referenceList', 'horizontalRule']) {
    it(`the LEGACY rule MISPLACES a ${atom} — negative FIRES in-process, swept`, () => {
      let discriminating = 0
      for (let at = 0; at <= 60; at += 5) {
        const doc = docWith(60, atom, at)
        const fixed = atomsAgree(doc, false)
        const legacy = atomsAgree(doc, true)
        expect(fixed).toHaveLength(1)
        // THE FIX MUST ALWAYS AGREE — at every placement, boundary or not.
        expect(fixed[0].queried).toBe(fixed[0].actual)
        // The legacy rule mislands wherever the atom starts a page; count those.
        if (legacy[0].queried !== legacy[0].actual) {
          expect(legacy[0].queried).toBe(legacy[0].actual - 1) // always exactly one page early
          discriminating++
        }
      }
      // If NO placement discriminated, this test cannot see the bug and proves nothing.
      expect(discriminating).toBeGreaterThan(0)
    })
  }

  // A NON-leaf block must be untouched by the rule — otherwise the "fix" would move every break.
  it('a paragraph-only document is IDENTICAL under both rules (the fix is scoped to leaf atoms)', () => {
    const rnd = rng()
    const proseOnly = schema.nodeFromJSON({ type: 'doc', content: Array.from({ length: 40 }, () => para(rnd)) })
    const w = globalThis as unknown as { window?: { __iwAtomPos?: string } }
    const build = (legacy: boolean) => {
      w.window = legacy ? { __iwAtomPos: 'legacy' } : {}
      try { return buildRenderModel(proseOnly, GEOM, measure, fontLoaded, {}) } finally { delete w.window }
    }
    const a = build(false), b = build(true)
    // Byte-identical line positions and page count: a non-leaf block takes offset+1 under BOTH
    // rules, so the fix cannot have moved a single break on ordinary prose. This is the other half
    // of the claim in the commit — "breaks are byte-unchanged against the live editor".
    expect(a.lines.map((l) => l.pos)).toEqual(b.lines.map((l) => l.pos))
    expect(a.pages).toBe(b.pages)
    expect(a.lines.length).toBeGreaterThan(20) // …on a document big enough for it to mean something
  })
})

// ── THE UNMODELLED-MARK GATE (2026-07-18) ──────────────────────────────────────────────────────
// `runOf` walked node.marks, acted on bold/italic/textStyle, and SILENTLY IGNORED everything else.
// For a metric-neutral mark that is right by luck; for `code` — which renders MONOSPACE — it was
// right by nothing. MEASURED against the live editor (typematrix.prove.mjs, 13k words, 434 code
// runs): the model said 47 pages, the editor said 79, and NOT ONE of the 79 break positions
// matched — while `estimatedBlocks` was 0 and the model claimed FULL reliability. Wrong words on
// every page, reported trustworthy.
//
// The rule now mirrors `isCertifiedStack`, which already does this for FONTS: an allowlist, and
// anything outside it DEFERS to the DOM measure. What this really buys is the NEXT mark added to
// the schema — today it would have silently corrupted every break below it.
//
// A BROWSER PROBE CANNOT KEEP THIS. typematrix.prove.mjs needs a real editor and is run by hand;
// F6 taught us that a proof which ran once is indistinguishable, six weeks on, from one that never
// ran. This runs in the gate, in milliseconds, with no browser.
describe('blockEligibility — a mark the engine cannot model DEFERS the block', () => {
  const run = (over: Partial<InlineRun> = {}): InlineRun =>
    ({ text: 'hello world ', fontFamily: "'EB Garamond', Georgia, serif", fontSizePx: 18, fontWeight: 400, italic: false, ...over })
  const para = (runs: InlineRun[]): ArithBlock =>
    ({ type: 'paragraph', runs, baseFontPx: 18, marginTopPx: 0, marginBottomPx: 9, firstLineLeadingPx: 0 })

  it('a plain certified run is eligible (the control — the gate must not refuse everything)', () => {
    expect(blockEligibility(para([run()])).eligible).toBe(true)
  })

  it('an unmodelled mark refuses the block, and NAMES it', () => {
    const e = blockEligibility(para([run({ unmodelledMark: 'code' })]))
    expect(e.eligible).toBe(false)
    expect(e.reason).toBe('unmodelled-mark:code')
  })

  it('ONE bad run in a paragraph of good ones is enough to refuse it', () => {
    // The engine lays out a BLOCK, so a single unmeasurable run poisons the whole paragraph's wrap.
    const e = blockEligibility(para([run(), run({ unmodelledMark: 'code' }), run()]))
    expect(e.eligible).toBe(false)
    expect(e.reason).toBe('unmodelled-mark:code')
  })

  it('a FUTURE unknown mark defers too — the property the allowlist exists for', () => {
    const e = blockEligibility(para([run({ unmodelledMark: 'someMarkNobodyHasWrittenYet' })]))
    expect(e.eligible).toBe(false)
    expect(e.reason).toContain('someMarkNobodyHasWrittenYet')
  })

  // THE KNOWN-NEGATIVE: without it these assertions could pass against a gate that refuses
  // everything, which would be "safe" and useless. The control above proves it does not — and this
  // proves the two answers actually differ on the SAME block.
  it('the gate DISCRIMINATES: same runs, only the mark differs', () => {
    const clean = para([run()])
    const dirty = para([run({ unmodelledMark: 'code' })])
    expect(blockEligibility(clean).eligible).toBe(true)
    expect(blockEligibility(dirty).eligible).toBe(false)
  })
})

// ── A RUN IN A FACE THE STRUT DOES NOT SET DEFERS (2026-07-17) ─────────────────────────────────
// A line box spans from the highest inline-box top to the lowest bottom over the STRUT (the block
// element's own font) and every run on the line, each centring its own (ascent + descent) in its own
// line-height. So a run whose baseline sits differently from the strut's makes the DOM's line TALLER
// than `ratio × size`, while the wrap — and every check derived from it — stays perfect.
// MEASURED in the real editor (strut = EB Garamond 18px φ, scripts/textrender-probe/strutrule.mjs),
// line gap vs the model's 29.109375: EB Garamond / bold / italic +0 · Crimson Pro +1 · Spectral +1 ·
// Atkinson +1 · Bitter +1 · Carlito +1 · Cormorant +1 · Gelasio +1 · **IM Fell DW Pica +2** (the
// app's own identity serif is the worst case). At ~44 lines/page that is ~1.5 lines of drift per
// page — it made `mark textStyle:fontFamily` diverge Δ+76 at the FIRST break while claiming full
// reliability.
// NOT CORRECTABLE FROM CANVAS: the correction needs each face's ascent/descent, and the only metrics
// canvas exposes (fontBoundingBoxAscent/Descent) are ROUNDED TO WHOLE PIXELS — EB Garamond and
// JetBrains Mono both report 18/5 though they are different faces. Fed those, the formula mispredicts
// 6 of 16 measured cases by 0.5px per line: ~22px over one page, enough to move a break. A height we
// cannot compute is one we do not invent.
describe('blockEligibility — a run off the STRUT\'s face DEFERS the block', () => {
  const STRUT = "'EB Garamond', Georgia, serif"
  const OTHER = "'Crimson Pro', 'Times New Roman', serif"
  const run = (over: Partial<InlineRun> = {}): InlineRun =>
    ({ text: 'hello world ', fontFamily: STRUT, fontSizePx: 18, fontWeight: 400, italic: false, ...over })
  const para = (runs: InlineRun[], baseFontFamily?: string): ArithBlock =>
    ({ type: 'paragraph', runs, baseFontPx: 18, baseFontFamily, marginTopPx: 0, marginBottomPx: 9, firstLineLeadingPx: 0 })

  it('a run in the strut\'s own family is eligible (the control — the rule must not refuse everything)', () => {
    expect(blockEligibility(para([run()], STRUT)).eligible).toBe(true)
  })

  it('a run in ANOTHER family refuses the block, and NAMES the family', () => {
    const e = blockEligibility(para([run({ fontFamily: OTHER })], STRUT))
    expect(e.eligible).toBe(false)
    expect(e.reason).toBe('mixed-family:Crimson Pro')
  })

  it('ONE marked run among plain ones is enough — the line it lands on is the one that grows', () => {
    const e = blockEligibility(para([run(), run({ fontFamily: OTHER }), run()], STRUT))
    expect(e.eligible).toBe(false)
    expect(e.reason).toContain('mixed-family')
  })

  it('BOLD and ITALIC of the strut\'s own family stay eligible — measured +0px, and they must not defer', () => {
    expect(blockEligibility(para([run({ fontWeight: 700 })], STRUT)).eligible).toBe(true)
    expect(blockEligibility(para([run({ italic: true })], STRUT)).eligible).toBe(true)
  })

  it('atoms and hard breaks are not text runs and never trip it', () => {
    // An atom carries no family of its own to compare (runsOfParagraph gives both of these the
    // DEFAULT stack); what matters is that the rule reads neither as a text run off the strut.
    const atom: InlineRun = { text: '', fontFamily: OTHER, fontSizePx: 18, fontWeight: 400, italic: false, atomic: true, box: { advanceWidth: 40, lineHeightDemand: 29 } }
    const br: InlineRun = { text: '\n', fontFamily: OTHER, fontSizePx: 18, fontWeight: 400, italic: false }
    expect(blockEligibility(para([run(), atom, br], STRUT)).eligible).toBe(true)
  })

  // THE OPT-IN. arithMeasure's live-editor path builds ArithBlocks WITHOUT a strut family; omitting
  // the field must leave this engine byte-identical to its behaviour before the rule existed, or a
  // renderer fix silently changes the editor's own pagination.
  it('OMITTING baseFontFamily disables the rule entirely (existing callers unchanged)', () => {
    expect(blockEligibility(para([run({ fontFamily: OTHER })])).eligible).toBe(true)
  })

  // THE KNOWN-NEGATIVE: same runs, only the strut differs — so the rule is proved to discriminate
  // rather than to be a constant that happens to read the way the assertions want.
  it('DISCRIMINATES: identical runs, one strut agrees and the other does not', () => {
    const runs = [run({ fontFamily: OTHER })]
    expect(blockEligibility(para(runs, OTHER)).eligible).toBe(true)
    expect(blockEligibility(para(runs, STRUT)).eligible).toBe(false)
  })
})

describe('unmodelledMark — which marks the engine claims to handle', () => {
  const mk = (names: string[]): PMNode =>
    ({ text: 'x', marks: names.map((n) => ({ type: { name: n } })) } as unknown as PMNode)

  it('models bold/italic/textStyle', () => {
    for (const n of ['bold', 'italic', 'textStyle']) expect(unmodelledMark(mk([n]))).toBeNull()
  })

  // Each of these is PROVED byte-identical to the live editor by typematrix.prove.mjs (~46
  // breaks/fixture). They are ignorable because they carry no advance — not because we hope so.
  it('treats the PROVED metric-neutral decorations as ignorable', () => {
    for (const n of ['underline', 'strike', 'highlight', 'scasSlot', 'comment', 'insertion', 'deletion']) {
      expect(unmodelledMark(mk([n]))).toBeNull()
    }
  })

  it('refuses `code` — it renders MONOSPACE and was measured in the body font', () => {
    expect(unmodelledMark(mk(['code']))).toBe('code')
  })

  it('refuses an unknown mark, and finds it among modelled ones', () => {
    expect(unmodelledMark(mk(['future']))).toBe('future')
    expect(unmodelledMark(mk(['bold', 'italic', 'code']))).toBe('code')
    expect(unmodelledMark(mk([]))).toBeNull()
  })
})
