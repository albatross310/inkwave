// @vitest-environment jsdom
// TWO COPIES OF THE LINE RULE, AND — UNTIL THIS FILE — NO TEST COMPARED THEM.
//
// "A container's element children are not lines" exists twice, because it must:
//   1. `PaginationExtension.textblockEls`      — THE EDITOR. Asks ProseMirror: `child.isTextblock`.
//   2. `staticPagination.staticLineRects`      — THE /snapshot PANE. Has no PM tree (DocView and
//      FullDiffView render plain DOM), so it asks the layout engine: `getComputedStyle().display`.
// Two authorities, two implementations, ONE meaning. They cannot share code — and that is exactly
// the situation in which this repo has been bitten every single time.
//
// WHAT IT COST, TWICE OVER. `getClientRects()` over a container's contents returns each child
// element's BORDER BOX. The editor admitted a `<li>`'s box as a line and put a page break one line
// late in every ~2-line list item (LIVE, fixed 2026-07-17 — 5101f20). The pane's copy carried the
// identical defect and was fixed SEPARATELY, one commit later, after the first lane could only
// STATE that it was there. Both copies were self-consistent. Both passed their own suites. The
// break rule underneath them had already been through this three times over
// (`breakRuleParity.test.ts`) — "each was pinned against its OWN fixture; each passed; each was
// consistent with itself, and self-consistency is what this disease always preserves."
//
// THE REPO ALREADY KNEW HOW: `textMap.test.ts` (`expect(buildFlatMap(d, r).text).toBe(pmToText(d, r))`)
// and `breakRuleParity.test.ts`. One document, two implementations, one assertion. This is that
// assertion for the LINE rule.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { textblockEls } from './extensions/PaginationExtension'
import { staticLineRects } from './staticPagination'

// ── ONE DOCUMENT, EXPRESSED TWICE — as ProseMirror sees it, and as DocView renders it.
// The pairing is the fixture's whole point, so it is declared once, together: a shape that existed
// on only one side could not be compared, and a shape that DISAGREED between the two descriptions
// would be testing the fixture rather than the rules.
const SHAPES: Array<{ name: string; pm: unknown; html: string; textblocks: number }> = [
  {
    name: 'paragraph (the prose control)',
    pm: { type: 'paragraph', content: [{ type: 'text', text: 'plain prose' }] },
    html: '<p>plain prose</p>',
    textblocks: 1,
  },
  {
    name: 'paragraph with inline marks',
    pm: { type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'text', marks: [{ type: 'em' }], text: 'b' }, { type: 'text', text: ' c' }] },
    html: '<p>a <em>b</em> c</p>',
    textblocks: 1,
  },
  {
    name: 'heading',
    pm: { type: 'heading', content: [{ type: 'text', text: 'Chapter' }] },
    html: '<h2>Chapter</h2>',
    textblocks: 1,
  },
  {
    name: 'bulletList, 3 items — THE BUG\'S OWN SHAPE',
    pm: { type: 'bulletList', content: [1, 2, 3].map((i) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `item ${i}` }] }] })) },
    html: '<ul><li><p>item 1</p></li><li><p>item 2</p></li><li><p>item 3</p></li></ul>',
    textblocks: 3,
  },
  {
    name: 'blockquote',
    pm: { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
    html: '<blockquote><p>quoted</p></blockquote>',
    textblocks: 1,
  },
  {
    name: 'nested list',
    pm: {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'outer' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }] }] }] }],
    },
    html: '<ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul>',
    textblocks: 2,
  },
]

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    heading: { group: 'block', content: 'inline*', toDOM: () => ['h2', 0] },
    bulletList: { group: 'block', content: 'listItem+', toDOM: () => ['ul', 0] },
    listItem: { content: 'paragraph block*', toDOM: () => ['li', 0] },
    blockquote: { group: 'block', content: 'block+', toDOM: () => ['blockquote', 0] },
    text: { group: 'inline' },
  },
  marks: { em: { toDOM: () => ['em', 0] } },
})

// ── THE EDITOR'S SIDE. A view stub whose nodeDOM returns a distinct element per doc position.
const pmTextblocks = (json: unknown): number => {
  const doc = schema.nodeFromJSON({ type: 'doc', content: [json] })
  const byPos = new Map<number, HTMLElement>()
  doc.descendants((node: PMNode, pos: number) => {
    const el = document.createElement(node.isTextblock ? 'p' : 'div')
    byPos.set(pos, el)
    return true
  })
  const view = { nodeDOM: (pos: number) => byPos.get(pos) ?? null } as unknown as EditorView
  return textblockEls(view, doc.child(0), 0, document.createElement('div')).length
}

// ── THE PANE'S SIDE. Record which elements the rule opens a range over.
let asked: string[] = []
let real: () => DOMRectList
beforeEach(() => {
  asked = []
  real = Range.prototype.getClientRects
  Range.prototype.getClientRects = function (this: Range) {
    asked.push((this.startContainer as Element).tagName?.toLowerCase() ?? '#text')
    const empty: DOMRect[] = []
    return Object.assign(empty, { item: () => undefined }) as unknown as DOMRectList
  }
})
afterEach(() => { Range.prototype.getClientRects = real })

const domTextblocks = (html: string): number => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  asked = []
  staticLineRects(host.firstElementChild as HTMLElement)
  return asked.length
}

describe('THE LINE RULE — the editor and the pane must resolve the same textblocks', () => {
  for (const s of SHAPES) {
    it(`${s.name}: PM rule and DOM rule agree (${s.textblocks})`, () => {
      const pm = pmTextblocks(s.pm)
      const dom = domTextblocks(s.html)
      // THE ASSERTION THAT DID NOT EXIST — one document, two implementations.
      expect({ side: 'dom', n: dom }).toEqual({ side: 'dom', n: pm })
      // …pinned to the expected value too, so the two could not drift TOGETHER into agreeing on a
      // wrong answer. Two copies agreeing is what this whole file exists to distrust.
      expect(pm).toBe(s.textblocks)
    })
  }

  it('the fixture DISCRIMINATES — the pre-fix pane rule disagrees with the editor (negative FIRES)', () => {
    // Without this, "they agree" could mean "these shapes cannot tell them apart" — which is exactly
    // how three self-consistent copies of the break rule stayed green through a live drift.
    // `__iwStaticLineRule='range'` is production's own seam restoring the pre-fix rule, so the
    // negative runs the REAL shipped path.
    ;(window as unknown as { __iwStaticLineRule?: string }).__iwStaticLineRule = 'range'
    try {
      const list = SHAPES.find((s) => s.textblocks === 3)!
      expect(domTextblocks(list.html)).toBe(1)   // the pre-fix rule: ONE range, over the <ul> itself
      expect(pmTextblocks(list.pm)).toBe(3)      // …while the editor resolves the three items
      expect(domTextblocks(list.html)).not.toBe(pmTextblocks(list.pm))
    } finally {
      delete (window as unknown as { __iwStaticLineRule?: string }).__iwStaticLineRule
    }
  })

  it('the parity check is not vacuous — it really ran both rules on a container', () => {
    // A parity test between two zeros passes forever.
    const list = SHAPES.find((s) => s.textblocks === 3)!
    expect(domTextblocks(list.html)).toBeGreaterThan(1)
    expect(pmTextblocks(list.pm)).toBeGreaterThan(1)
    expect(asked).not.toContain('ul') // and neither side ever ranged the container
  })
})
