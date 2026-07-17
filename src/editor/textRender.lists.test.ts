// THE LIST MARGIN COLLAPSE — the cheap guard for a bug MEASURED against the live editor.
//
// The renderer used to add one `li > p` margin-bottom after EVERY item, including the last, then
// the list's own margin-bottom on top. CSS collapses instead: the last item's paragraph has nothing
// below it inside the list (no padding, no border on the `li` or the `ul`), so its bottom margin
// merges with the list's own — the gap after a list is `max(itemMargin, listMargin)`, never a sum.
// MEASURED in the real editor (listdiag.mjs, 3-item lists at canonical 18px): the `ul`'s own rect is
// `Σ item paragraphs + (n−1) × 4.5` and the real gap to its next sibling is 9, while the model
// produced `Σ + n × 4.5` and then added 9 — **+4.5px per list, silently**, with estimatedBlocks 0
// and reliablePages 55/55.
//
// WHY THIS FILE EXISTS AT ALL (CLAUDE.md's headline): the browser probes that found it need a build,
// a server and a real editor. They are the truth; they are not a guard. This runs in ~30ms with no
// browser, and every mutant below was PROVED to kill it.
import { describe, it, expect, vi } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'

// blockStyle() reads styles HARVESTED from the live DOM, so jsdom (no layout) would return null for
// every kind and the list branch would placeholder out — the test would then pass against any rule
// at all. Mocking the harvest is what lets the ARITHMETIC be tested; the harvest's own fidelity is
// the browser probe's job, and the numbers below are the ones it measured.
vi.mock('./blockStyles', () => {
  const base = {
    fontFamily: "'EB Garamond', Georgia, serif", fontSizePx: 18, fontWeight: 400, italic: false,
    lineHeightRatio: 1.618, indentPx: 0, paddingTopPx: 0, borderTopPx: 0,
    marginTopPx: 0, marginBottomPx: 0,
  }
  return {
    // MEASURED (getComputedStyle in the real editor): ul/ol = padding-inline-start 27px,
    // margin-bottom 9px, margin-top 0; li > p = margin-bottom 4.5px, margin-top 0.
    blockStyle: (kind: string) => {
      if (kind === 'bulletList' || kind === 'orderedList') return { ...base, indentPx: 27, marginBottomPx: 9 }
      if (kind === 'listItemPara') return { ...base, marginBottomPx: 4.5 }
      return null
    },
    clearBlockStyles: () => {},
    harvestBlockStyles: () => {},
  }
})

const { buildRenderModel } = await import('./textRender')
type RenderGeom = import('./textRender').RenderGeom

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    bulletList: { group: 'block', content: 'listItem+', toDOM: () => ['ul', 0] },
    orderedList: { group: 'block', content: 'listItem+', toDOM: () => ['ol', 0] },
    listItem: { content: 'paragraph block*', toDOM: () => ['li', 0] },
    text: { group: 'inline' },
  },
})

const GEOM: RenderGeom = {
  pageWidthPx: 794, pageHeightPx: 1123, topMarginPx: 96, sideMarginPx: 96,
  contentWidthPx: 602, basePx: 18, ratio: 1.618, paraSpacingEm: 0.5,
}
const measure = (t: string) => t.length * 8 // 8px/char ⇒ a line holds ⌊575/8⌋ = 71 chars at the list indent
const fontLoaded = () => true

const LINE = Math.floor(1.618 * Math.round(18 * 64)) / 64 // snappedLineHeight(18, 1.618) = 29.109375
const ITEM_MB = 4.5
const LIST_MB = 9

const item = (text: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

/** A list of n ONE-LINE items, followed by a paragraph — so the trailing advance is observable. */
const listDoc = (n: number, kind = 'bulletList'): PMNode => schema.nodeFromJSON({
  type: 'doc',
  content: [
    p('lead'),
    { type: kind, content: Array.from({ length: n }, (_, i) => item(`item ${i}`)) },
    p('tail'),
  ],
})

const blocksOf = (doc: PMNode) => buildRenderModel(doc, GEOM, measure, fontLoaded, {}).blocks

describe('buildRenderModel — a list is ONE box whose margins COLLAPSE', () => {
  for (const kind of ['bulletList', 'orderedList']) {
    // n is swept because the bug is EXACTLY one item margin: at n=1 the wrong rule adds 4.5 to a
    // box with no internal gaps at all, and the two rules must diverge at every n. A single n could
    // agree by arithmetic accident.
    for (const n of [1, 2, 3, 5]) {
      it(`${kind} × ${n}: the box is Σ items + (n−1) item margins — never n`, () => {
        const b = blocksOf(listDoc(n, kind))
        const list = b[1]
        expect(list.type).toBe(kind)
        expect(list.kind).toBe('text')
        expect(list.height).toBeCloseTo(n * LINE + (n - 1) * ITEM_MB, 6)
      })

      it(`${kind} × ${n}: the trailing gap is max(item, list) margin — never their sum`, () => {
        const b = blocksOf(listDoc(n, kind))
        const list = b[1], tail = b[2]
        expect(tail.type).toBe('paragraph')
        // The advance the next block starts at. max(4.5, 9) = 9 — NOT 4.5 + 9.
        expect(tail.top - (list.top + list.height)).toBeCloseTo(Math.max(ITEM_MB, LIST_MB), 6)
        expect(tail.top - (list.top + list.height)).not.toBeCloseTo(ITEM_MB + LIST_MB, 6)
      })
    }
  }

  it('the list is laid out arithmetically at all — the control, or every assertion above is vacuous', () => {
    const m = buildRenderModel(listDoc(3), GEOM, measure, fontLoaded, {})
    expect(m.blocks[1].kind).toBe('text')
    expect(m.blocks[1].estimated).toBeUndefined()
    expect(m.estimatedBlocks).toBe(0)
    expect(m.lines.filter((l) => l.blockIdx === 1)).toHaveLength(3) // one line per one-line item
  })

  it('item lines are indented and only the FIRST line of an item carries its marker', () => {
    // A 2-line item, so "first line only" is a claim something can fail.
    const long = 'x'.repeat(60) + ' ' + 'y'.repeat(60) // 121 chars ⇒ 2 lines at 71 chars/line
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'orderedList', content: [item(long), item('short')] }] })
    const m = buildRenderModel(doc, GEOM, measure, fontLoaded, {})
    const lines = m.lines.filter((l) => l.blockIdx === 0)
    expect(lines.length).toBeGreaterThan(2)
    expect(lines.every((l) => l.indentPx === 27)).toBe(true)
    expect(lines[0].marker).toBe('1.')
    expect(lines[1].marker).toBeUndefined() // the item's continuation line
    expect(lines[lines.length - 1].marker).toBe('2.')
  })

  it('the between-item gap IS the item margin (the rule the collapse must not also delete)', () => {
    const m = buildRenderModel(listDoc(3), GEOM, measure, fontLoaded, {})
    const lines = m.lines.filter((l) => l.blockIdx === 1)
    expect(lines[1].top - lines[0].top).toBeCloseTo(LINE + ITEM_MB, 6)
    expect(lines[2].top - lines[1].top).toBeCloseTo(LINE + ITEM_MB, 6)
  })
})

describe('buildRenderModel — a list the model has no rule for DEFERS, never renders half', () => {
  it('a NESTED list inside an item placeholders the whole list rather than dropping it', () => {
    // The branch used to skip every non-paragraph child of a listItem, so a nested list's entire
    // height vanished from the model while it still reported the list laid out and the pages
    // reliable. A missing block is not a smaller block; it is a wrong document.
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'outer' }] }, { type: 'bulletList', content: [item('inner')] }] },
          item('second'),
        ],
      }],
    })
    const m = buildRenderModel(doc, GEOM, measure, fontLoaded, {})
    expect(m.blocks[0].kind).toBe('placeholder')
    expect(m.blocks[0].estimated).toBe(true)
    expect(m.estimatedBlocks).toBeGreaterThan(0)
    expect(m.blocks[0].label).toBe('list')
  })

  it('DISCRIMINATES: the same list WITHOUT the nested child renders (the defer is not blanket)', () => {
    const flat = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'bulletList', content: [item('outer'), item('second')] }] })
    const m = buildRenderModel(flat, GEOM, measure, fontLoaded, {})
    expect(m.blocks[0].kind).toBe('text')
    expect(m.estimatedBlocks).toBe(0)
  })

  it('a partially-laid list is ROLLED BACK — no orphan lines survive the defer', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [
          item('first renders fine'),
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'outer' }] }, { type: 'bulletList', content: [item('inner')] }] },
        ],
      }],
    })
    const m = buildRenderModel(doc, GEOM, measure, fontLoaded, {})
    // Exactly one line — the placeholder's own — and no leftovers from the first, already-emitted item.
    expect(m.lines.filter((l) => l.blockIdx === 0)).toHaveLength(1)
    expect(m.lines[0].segs).toHaveLength(0)
  })
})
