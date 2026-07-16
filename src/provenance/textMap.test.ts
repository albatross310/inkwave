// THE PROVENANCE GUARD + the deletion-anchoring proof.
//
// textMap.ts MIRRORS pmToText, and pmToText is hashed into the export bundle and anchored to Bitcoin
// (M2/M5). A mirror that drifts would render a snapshot with subtly wrong text while every hash still
// verified — the error would be invisible exactly where it matters most. So the mirror's byte
// identity is not reviewed, it is ASSERTED against the REAL pmToText, at BOTH resolve settings, over
// fixtures chosen to hit the rules that are easy to get wrong: trimming, empty blocks, nested list
// items, hard breaks, citations.
//
// Each identity test below is paired with a KNOWN-NEGATIVE (`mutate`) proving the comparison can
// actually FAIL — a byte-identity assertion between two things that are always equal by construction
// would pass forever and guard nothing. That is the house's most-repeated failure, and this file is
// where it would hide.
import { describe, it, expect, beforeAll } from 'vitest'
import { pmToText } from './bundle'
import { bibProvider } from '../citations/bibProvider'
import { buildFlatMap, anchorOps, opsInRange } from './textMap'
import { diffWords, splitChangesAtReturns } from './diff'
import type { TiptapJSON } from '../types/document'

const p = (...kids: unknown[]) => ({ type: 'paragraph', content: kids })
const t = (text: string) => ({ type: 'text', text })
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as unknown as TiptapJSON

const cite = (key: string) => ({ type: 'citation', attrs: { citekeys: [key], prefix: '', suffix: '', locator: '' } })

// SEED bibProvider, or the resolve=true tests are testing the resolve=false path. citationText only
// takes its `simpleInText` branch when the keys RESOLVE; with an empty provider it falls through to
// the bare "(key)" form, so every "resolve=true" assertion below would silently exercise the same
// code as resolve=false — a suite that looks like it covers the display path and does not. The
// display path (`displayTextOf` → pmToText(doc, true)) is the one the diff is computed under, so it
// is the one that must be mapped correctly.
beforeAll(() => {
  bibProvider.setEntries([
    { id: 'leibniz1686', type: 'book', title: 'Discourse', author: [{ family: 'Leibniz', given: 'G' }], issued: { 'date-parts': [[1686]] } },
    { id: 'couturat1901', type: 'book', title: 'La Logique', author: [{ family: 'Couturat', given: 'L' }], issued: { 'date-parts': [[1901]] } },
  ] as unknown as Parameters<typeof bibProvider.setEntries>[0], 'library')
})

// Guard the seeding itself: if resolve stops changing the bytes, the two settings have collapsed
// into one and the resolve=true coverage is a fiction.
describe('the resolve setting actually changes the bytes', () => {
  it('resolve=true takes the simpleInText branch (else the resolve tests are vacuous)', () => {
    const d = doc(p(t('see '), cite('leibniz1686')))
    const bare = pmToText(d, false)
    const resolved = pmToText(d, true)
    expect(bare).not.toBe(resolved)          // the branch is real
    expect(resolved).toContain('(Leibniz, 1686)')
    expect(bare).toContain('(leibniz1686)')
  })
})

const FIXTURES: Array<[string, TiptapJSON]> = [
  ['plain paragraphs', doc(p(t('hello world')), p(t('second block')))],
  ['leading/trailing whitespace (trim)', doc(p(t('   padded  ')), p(t('\n\ttabbed\n')))],
  ['empty + whitespace-only blocks are dropped', doc(p(), p(t('   ')), p(t('kept')), p(t('')))],
  ['heading + blockquote + codeBlock', doc(
    { type: 'heading', attrs: { level: 2 }, content: [t('A Heading')] },
    { type: 'blockquote', content: [p(t('quoted text'))] },
    { type: 'codeBlock', content: [t('const x = 1')] },
  )],
  ['nested listItem flattening', doc({ type: 'bulletList', content: [
    { type: 'listItem', content: [p(t('first item'))] },
    { type: 'listItem', content: [p(t('second item')), p(t('same item, second para'))] },
  ] })],
  ['hard breaks', doc(p(t('line one'), { type: 'hardBreak' }, t('line two')))],
  ['citations mid-paragraph', doc(p(t('as argued '), cite('leibniz1686'), t(' the point stands')))],
  ['citation alone in a block', doc(p(cite('couturat1901')))],
  ['marks do not affect text', doc(p({ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }, t(' plain')))],
  ['empty doc', doc()],
]

describe('buildFlatMap — the provenance boundary', () => {
  for (const [name, d] of FIXTURES) {
    for (const resolve of [false, true]) {
      it(`text is BYTE-IDENTICAL to pmToText (${name}, resolve=${resolve})`, () => {
        expect(buildFlatMap(d, resolve).text).toBe(pmToText(d, resolve))
      })
    }
  }

  // THE KNOWN-NEGATIVE. If this comparison could not fail, every test above is decoration.
  it('the identity check FIRES on a mirror that drifts (negative must fail)', () => {
    const d = doc(p(t('hello world')), p(t('second')))
    const real = pmToText(d, false)
    // A DRIFTED MIRROR, written out as a real (wrong) implementation rather than a string tweak —
    // it gets each of pmToText's three structural rules subtly wrong. The identity assertion must
    // CATCH it; if it does not, every identity test above is decoration.
    const drifted = (dd: TiptapJSON, join: string, trailing: string, trim: boolean): string => {
      const blocks: string[] = []
      const inline = (n: { type?: string; text?: string; content?: unknown[] }): string =>
        n.type === 'text' ? (n.text ?? '') : ((n.content as typeof n[] | undefined) ?? []).map(inline).join('')
      const walk = (n: { type?: string; content?: unknown[] }): void => {
        if (n.type === 'paragraph') { const s2 = ((n.content as typeof n[] | undefined) ?? []).map(inline).join(''); blocks.push(trim ? s2.trim() : s2) }
        else if (Array.isArray(n.content)) (n.content as typeof n[]).forEach(walk)
      }
      walk(dd as { type?: string; content?: unknown[] })
      return blocks.filter((b) => b.length > 0).join(join) + trailing
    }
    expect(drifted(d, '\n', '\n', true)).not.toBe(real)   // wrong block join   → CAUGHT
    expect(drifted(d, '\n\n', '', true)).not.toBe(real)    // no trailing newline → CAUGHT
    // …and a mirror that gets all three right DOES match, so the assertion is not simply always-false.
    expect(drifted(d, '\n\n', '\n', true)).toBe(real)
    // …and the real mirror survives.
    expect(buildFlatMap(d, false).text).toBe(real)
  })
})

describe('buildFlatMap — the map itself', () => {
  it('every block range slices back to that block’s own text', () => {
    const d = doc(p(t('   alpha beta  ')), p(t('gamma')), { type: 'heading', attrs: { level: 1 }, content: [t('Title')] })
    const m = buildFlatMap(d, false)
    expect(m.blocks.map((b) => m.text.slice(b.flatStart, b.flatEnd))).toEqual(['alpha beta', 'gamma', 'Title'])
  })

  it('every seg maps to the exact source text it emitted (trim-clipped included)', () => {
    const d = doc(p(t('  lead'), t(' middle '), t('tail  ')))
    const m = buildFlatMap(d, false)
    // Reassembling every seg's flat slice must reproduce the block, proving no seg is misplaced.
    const b = m.blocks[0]
    const rebuilt = b.segs.map((s) => m.text.slice(s.flatStart, s.flatStart + s.len)).join('')
    expect(rebuilt).toBe(m.text.slice(b.flatStart, b.flatEnd))
  })

  it('a seg whose head was trimmed carries a non-zero nodeStart', () => {
    const d = doc(p(t('   xy')))
    const m = buildFlatMap(d, false)
    const seg = m.blocks[0].segs[0]
    expect(seg.nodeStart).toBe(3)      // the three spaces were trimmed off this leaf
    expect(m.text.slice(seg.flatStart, seg.flatStart + seg.len)).toBe('xy')
  })

  it('whitespace-only blocks are dropped, and following blocks’ offsets account for it', () => {
    const d = doc(p(t('  ')), p(t('kept')))
    const m = buildFlatMap(d, false)
    expect(m.blocks).toHaveLength(1)
    expect(m.text.slice(m.blocks[0].flatStart, m.blocks[0].flatEnd)).toBe('kept')
    expect(m.blocks[0].flatStart).toBe(0) // NOT offset by the dropped block
  })

  it('paths address the real source node (listItem flattening included)', () => {
    const d = doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('item text'))] }] })
    const m = buildFlatMap(d, false)
    expect(m.blocks).toHaveLength(1)
    expect(m.blocks[0].path).toEqual([0, 0])          // the listItem itself is the block
    expect(m.blocks[0].segs[0].path).toEqual([0, 0, 0, 0]) // → paragraph → text, flattened by inline
  })
})

describe('anchorOps — deletions have no home', () => {
  const opsFor = (a: string, b: string) => splitChangesAtReturns(diffWords(a, b))

  it('non-del text concatenates to CUR; non-add text concatenates to PREV', () => {
    const prev = 'the quick brown fox jumps over the lazy dog'
    const cur = 'the quick red fox leaps over the dog'
    const ops = opsFor(prev, cur)
    expect(ops.filter((o) => o.type !== 'del').map((o) => o.text).join('')).toBe(cur)
    expect(ops.filter((o) => o.type !== 'add').map((o) => o.text).join('')).toBe(prev)
  })

  it('every non-del op’s range slices back to its own text in CUR', () => {
    const prev = 'alpha beta gamma delta epsilon'
    const cur = 'alpha GAMMA gamma delta omega'
    const anchored = anchorOps(opsFor(prev, cur))
    for (const op of anchored) {
      if (op.type === 'del') continue
      expect(cur.slice(op.curStart, op.curEnd)).toBe(op.text)
    }
    expect(anchored[anchored.length - 1].curEnd).toBe(cur.length)
  })

  it('a del is a POINT, not a range, and sits where the text was removed', () => {
    const prev = 'keep DELETED keep2'
    const cur = 'keep keep2'
    const anchored = anchorOps(opsFor(prev, cur))
    const dels = anchored.filter((o) => o.type === 'del')
    expect(dels.length).toBeGreaterThan(0)
    for (const d of dels) {
      expect(d.curEnd).toBe(d.curStart)              // occupies nothing in cur
      expect(d.curStart).toBeGreaterThanOrEqual(0)
      expect(d.curStart).toBeLessThanOrEqual(cur.length)
    }
    // The deletion belongs after "keep " — i.e. the cursor did NOT advance past it.
    expect(cur.slice(0, dels[0].curStart)).toBe('keep ')
  })

  // THE KNOWN-NEGATIVE for the cursor rule: the bug this design exists to avoid is advancing the
  // cursor on a del. It must be PROVED to misplace something, or these tests guard nothing.
  //
  // THIS NEGATIVE WAS BLIND ON ITS FIRST WRITING, and the way it was blind is worth keeping: with a
  // SINGLE deletion that is also the FIRST change ('keep DELETED keep2' → 'keep keep2'), the correct
  // and buggy rules BOTH answer 5 — they cannot diverge until a del has actually been passed over.
  // The negative scored identically to the right answer BY CONSTRUCTION, which is the exact trap
  // CLAUDE.md lists. TWO deletions are the minimum that can see this bug.
  it('advancing the cursor on a del (the bug) misplaces LATER dels — negative FIRES', () => {
    const prev = 'alpha REMOVED1 beta REMOVED2 gamma'
    const cur = 'alpha beta gamma'
    const ops = opsFor(prev, cur)
    const correct = anchorOps(ops).filter((o) => o.type === 'del').map((o) => o.curStart)
    // The WRONG rule: advance on every op, dels included.
    let bad = 0
    const wrong: number[] = []
    for (const op of ops) { if (op.type === 'del') wrong.push(bad); bad += op.text.length }

    expect(correct.length).toBeGreaterThanOrEqual(2) // the fixture must actually contain the case
    expect(wrong).not.toEqual(correct)               // the bug really does move a deletion
    expect(bad).not.toBe(cur.length)                 // …and the cursor overruns cur entirely
    // Concretely: the correct rule keeps every anchor inside cur; the buggy one walks off the end.
    for (const c of correct) expect(c).toBeLessThanOrEqual(cur.length)
    expect(Math.max(...wrong)).toBeGreaterThan(cur.length)
    // And the correct anchors land exactly at the word boundaries the text was removed from.
    expect(cur.slice(0, correct[0])).toBe('alpha ')
    expect(cur.slice(0, correct[1])).toBe('alpha beta ')
  })

  it('a pure insertion anchors nothing and covers the inserted range', () => {
    const anchored = anchorOps(opsFor('a c', 'a b c'))
    const adds = anchored.filter((o) => o.type === 'add')
    expect(adds.length).toBeGreaterThan(0)
    for (const a of adds) expect('a b c'.slice(a.curStart, a.curEnd)).toBe(a.text)
  })

  it('identical documents produce one same op spanning everything', () => {
    const s = 'unchanged text here'
    const anchored = anchorOps(opsFor(s, s))
    expect(anchored).toHaveLength(1)
    expect(anchored[0]).toMatchObject({ type: 'same', curStart: 0, curEnd: s.length })
  })
})

describe('opsInRange — splitting one node into marked runs', () => {
  const prev = 'alpha beta gamma delta'
  const cur = 'alpha BETA gamma'
  const anchored = anchorOps(splitChangesAtReturns(diffWords(prev, cur)))

  it('clips ranges to the window and preserves the sliced text', () => {
    for (const op of opsInRange(anchored, 0, cur.length)) {
      if (op.type === 'del') continue
      expect(cur.slice(op.curStart, op.curEnd)).toBe(op.text)
    }
  })

  it('the runs in a window tile it exactly, with no gap and no overlap', () => {
    const runs = opsInRange(anchored, 0, cur.length).filter((o) => o.type !== 'del')
    expect(runs.map((r) => r.text).join('')).toBe(cur)
    for (let i = 1; i < runs.length; i++) expect(runs[i].curStart).toBe(runs[i - 1].curEnd)
  })

  it('a del at the window END is excluded so adjacent segments cannot render it twice', () => {
    const a = anchorOps([{ type: 'same', text: 'ab' }, { type: 'del', text: 'X' }, { type: 'same', text: 'cd' }])
    const del = a.find((o) => o.type === 'del')!
    expect(del.curStart).toBe(2)
    expect(opsInRange(a, 0, 2).some((o) => o.type === 'del')).toBe(false) // excluded at `to`
    expect(opsInRange(a, 2, 4).some((o) => o.type === 'del')).toBe(true)  // included at `from`
  })
})
