// @vitest-environment jsdom
// A CONTAINER'S ELEMENT CHILDREN ARE NOT LINES — the cheap guard for a LIVE pagination bug.
//
// `range.selectNodeContents(el).getClientRects()` returns the border box of every ELEMENT it fully
// contains. For a `<p>` that is harmless (inline mark spans' boxes coincide with the text rects and
// the 3px dedup eats them). For a `<ul>` each `<li>` contributes ONE rect spanning the WHOLE ITEM,
// and `keepLineRects` admitted it as a line: a 2-line item's box is 58.2px, under the 80px tall-box
// cut, and it sits exactly 3.000px above its own first text rect — so `top - lastTop <= 3` DROPPED
// the item's first text line and the li's box stood in for it.
// The COUNT survived (6 rects for 6 lines), which is why every count-based check passed. The SAMPLE
// POINT did not: collectLines samples `r.top + r.height/2`, which for a 58px li box is the middle of
// the ITEM — line 2. So the break attributed to the item's FIRST line resolved, via posAtCoords, to
// the SECOND line's doc position, one line late, and the page carried 26.5px more than its own text
// area allowed. MEASURED in the real editor: model 25306 vs the editor's gap at 25383.
//
// WHY THIS FILE, and not just the browser probe: the probe needs a build, a server and a real
// editor. It is the truth; it is not a guard. `textblockEls` is the whole rule, it is pure given a
// nodeDOM lookup, and it runs here in milliseconds.
import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { textblockEls, keepLineRects } from './extensions/PaginationExtension'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    heading: { group: 'block', content: 'inline*', toDOM: () => ['h2', 0] },
    bulletList: { group: 'block', content: 'listItem+', toDOM: () => ['ul', 0] },
    listItem: { content: 'paragraph block*', toDOM: () => ['li', 0] },
    blockquote: { group: 'block', content: 'block+', toDOM: () => ['blockquote', 0] },
    referenceList: { group: 'block', atom: true, toDOM: () => ['div'] },
    text: { group: 'inline' },
  },
})

/** A view stub whose nodeDOM returns a DISTINCT tagged element per doc position, so which element
 *  the rule resolves to is observable rather than inferred. */
const stubView = (doc: PMNode) => {
  const byPos = new Map<number, HTMLElement>()
  doc.descendants((node, pos) => {
    const el = document.createElement(node.isTextblock ? 'p' : 'div')
    el.setAttribute('data-t', node.type.name)
    el.setAttribute('data-pos', String(pos))
    byPos.set(pos, el)
    return true
  })
  return {
    view: { nodeDOM: (pos: number) => byPos.get(pos) ?? null } as unknown as EditorView,
    byPos,
  }
}

const nameOf = (el: HTMLElement) => el.getAttribute('data-t') ?? el.tagName.toLowerCase()

describe('textblockEls — rects are collected per TEXTBLOCK, never from a container box', () => {
  it('a bulletList resolves to its item PARAGRAPHS — not the <ul>, and not the <li>s', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [1, 2, 3].map((i) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `item ${i}` }] }] })),
      }],
    })
    const { view } = stubView(doc)
    const ul = document.createElement('ul')
    const els = textblockEls(view, doc.child(0), 0, ul)
    expect(els).toHaveLength(3)
    expect(els.map(nameOf)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(els).not.toContain(ul)
    // The <li>s themselves must never be measured: their boxes are what became phantom lines.
    expect(els.some((e) => nameOf(e) === 'listItem')).toBe(false)
  })

  it('a blockquote resolves to its inner paragraphs — the same container shape, same rule', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] }],
    })
    const { view } = stubView(doc)
    const bq = document.createElement('blockquote')
    const els = textblockEls(view, doc.child(0), 0, bq)
    expect(els.map(nameOf)).toEqual(['paragraph'])
    expect(els).not.toContain(bq)
  })

  // THE LOAD-BEARING CONTROL. A paragraph/heading IS a textblock, so it must resolve to [el] and
  // take the byte-identical single-range call it always did. If this ever returns anything else,
  // every prose document's page breaks change — and prose is nearly every document.
  it('a TEXTBLOCK returns [el] itself — prose takes the identical old path', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }, { type: 'heading', content: [{ type: 'text', text: 'head' }] }],
    })
    const { view } = stubView(doc)
    const p = document.createElement('p')
    expect(textblockEls(view, doc.child(0), 0, p)).toEqual([p])
    const h = document.createElement('h2')
    expect(textblockEls(view, doc.child(1), doc.child(0).nodeSize, h)).toEqual([h])
  })

  it('a LEAF ATOM (referenceList) has no textblock inside — it falls back to its own element', () => {
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'referenceList' }] })
    const { view } = stubView(doc)
    const div = document.createElement('div')
    expect(textblockEls(view, doc.child(0), 0, div)).toEqual([div])
  })

  it('resolves the item paragraphs by their REAL doc positions (offset + 1 + pos)', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'lead' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
      ],
    })
    const listOffset = doc.child(0).nodeSize
    const { view } = stubView(doc)
    const els = textblockEls(view, doc.child(1), listOffset, document.createElement('ul'))
    expect(els).toHaveLength(1)
    // The stub keys nodeDOM by the element's REAL doc position, so this asserts the `offset + 1 +
    // pos` arithmetic against the document rather than against itself: bulletList at listOffset,
    // listItem at +1, its paragraph at +2. A wrong base returns the wrong element or none, and the
    // block's lines then come from somewhere else entirely.
    expect(els[0].getAttribute('data-pos')).toBe(String(listOffset + 2))
    expect(nameOf(els[0])).toBe('paragraph')
    // …and the base really is non-zero here, or the arithmetic is untested (a lone list at offset 0
    // would pass under any `+ offset` rule).
    expect(listOffset).toBeGreaterThan(0)
  })

  it('an UNMAPPED subtree falls back to the element rather than losing the block\'s lines', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] }],
    })
    const blind = { nodeDOM: () => null } as unknown as EditorView
    const ul = document.createElement('ul')
    expect(textblockEls(blind, doc.child(0), 0, ul)).toEqual([ul])
  })
})

// The filter the container rule exists to protect. These are the REAL measurements from the editor.
describe('keepLineRects — the 3px dedup is what made an admitted <li> box eat a real line', () => {
  const R = (top: number, height: number, width = 500): DOMRect => ({ top, height, width, left: 0, right: width, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

  it('reproduces the bug: an li box 3.000px above its first text rect DELETES that rect', () => {
    // Measured in the real editor: li box top 725.188 h 58.219; its first text rect top 728.188 h 23.
    const kept = keepLineRects([R(725.188, 58.219), R(728.188, 23), R(757.297, 23)], 1)
    expect(kept).toHaveLength(2)
    expect(kept[0].height).toBeCloseTo(58.219, 3) // the CONTAINER box, standing in for a line
    expect(kept[1].top).toBeCloseTo(757.297, 3)   // and the item's FIRST text line is gone
  })

  it('with the container box never offered, both real text lines survive — the fix\'s effect', () => {
    const kept = keepLineRects([R(728.188, 23), R(757.297, 23)], 1)
    expect(kept).toHaveLength(2)
    expect(kept[0].top).toBeCloseTo(728.188, 3)
    expect(kept[1].top).toBeCloseTo(757.297, 3)
  })

  it('a 3-line item\'s box was dropped by the 80px cut — which is why only ~2-line items broke', () => {
    expect(keepLineRects([R(100, 87.3), R(103, 23)], 1)).toHaveLength(1)
  })
})
