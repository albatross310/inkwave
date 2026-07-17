// @vitest-environment jsdom
// A CONTAINER'S ELEMENT CHILDREN ARE NOT LINES — the /snapshot pane's copy of the rule.
//
// THE BUG THIS PINS, measured in the REAL pane (scripts/textrender-probe/panerect.mjs, against
// DocView's own `<ul><li><p>` DOM, in the pane's own forced-canonical window):
//   `range.selectNodeContents(el).getClientRects()` returns, per CSSOM-View, the border box of every
//   element the range SELECTS whose parent it does not — the range container's own element children
//   — and not only text-line rects. So a `<ul>` hands the collector each `<li>`'s WHOLE-ITEM box,
//   and a `<blockquote>` hands it its `<p>`'s. The box sits exactly 3.000px above its own first text
//   rect (the half-leading: (29.109 − 23)/2), so `top - lastTop <= 3` DELETED that first real line
//   and the container's box stood in for it, 3px too high.
//   529 shipped lines / 529 true lines — the COUNT TELESCOPES — and 24 of them wrong: UL 8, OL 8,
//   BLOCKQUOTE 8. Every count- and height-based check in staticPagination.ts passed straight through.
//
// THE 80px CUT WAS A COINCIDENCE, NOT A RULE. It admitted a ≤80px container box and dropped a
// bigger one, so correctness depended on how many lines an item happened to wrap to: a 2-line `<li>`
// (58.219px) broke it; a 3-line one (87.328px) did not. That is why both `<blockquote>` shapes are
// below — the SHORT one is the only one that tests the rule rather than the constant.
//
// WHY THIS FILE, and not just panerect.mjs: the probe needs a build, a server and a real browser.
// It is the truth; it is not a guard, and a probe that ran once is this repo's headline lesson.
//
// WHAT IT ASSERTS, AND WHY THAT SHAPE. Not "the rects are right" — jsdom has no layout, and a test
// built on rects it invented would be a model agreeing with a model. It asserts WHICH RANGES THE
// RULE OPENS, by recording every `getClientRects()` call production makes. That is the exact thing
// that was wrong: the collector asked the engine for a container's contents as ONE range. A rule
// that never opens a range over a container cannot be handed a container's box.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { staticLineRects } from './staticPagination'

// ── The recorder. Stubs Range.getClientRects and reports which NODE each range covered, so the
// question the rule asks the layout engine is observable rather than inferred.
let asked: string[] = []
const nameOf = (n: Node): string => {
  if (n.nodeType === 3) return `#text(${(n.nodeValue || '').slice(0, 6)})`
  const el = n as Element
  return el.getAttribute('data-t') || el.tagName.toLowerCase()
}
// TWO maps, deliberately. An earlier cut of this file used ONE for both the range rects and the
// bounding rect, and the empty-textblock test was VACUOUS: the "empty" paragraph's range returned a
// rect, so the fallback branch never ran and deleting it kept all 10 tests green (mutation-proved —
// M4 SURVIVED). An EMPTY textblock is exactly the node whose RANGE yields nothing while its BOX
// still exists; a fixture that cannot express that difference cannot test the branch that reads it.
const rectsByNode = new Map<Node, DOMRect[]>()   // what selectNodeContents(node) yields
const boundingByNode = new Map<Node, DOMRect>()  // what getBoundingClientRect() yields
const R = (top: number, height: number, width = 500): DOMRect =>
  ({ top, height, width, left: 0, right: width, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

let realGetClientRects: () => DOMRectList
let realGetBoundingClientRect: () => DOMRect

beforeEach(() => {
  asked = []
  rectsByNode.clear()
  boundingByNode.clear()
  realGetClientRects = Range.prototype.getClientRects
  realGetBoundingClientRect = Element.prototype.getBoundingClientRect
  Range.prototype.getClientRects = function (this: Range) {
    // `selectNodeContents(el)` ⇒ startContainer === endContainer === el. A RUN (setStartBefore/
    // setEndAfter over sibling nodes) reports the shared parent with differing offsets — recorded
    // distinctly, because "ranged the whole element" and "ranged a run inside it" are not the same
    // question and collapsing them would hide the one that matters.
    const whole = this.startOffset === 0 && this.endOffset === this.startContainer.childNodes.length
    asked.push(whole ? nameOf(this.startContainer) : `run:${nameOf(this.startContainer)}[${this.startOffset},${this.endOffset})`)
    const list = (whole ? rectsByNode.get(this.startContainer) : undefined) ?? []
    return Object.assign(list.slice(), { item: (i: number) => list[i] }) as unknown as DOMRectList
  }
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return boundingByNode.get(this) ?? R(0, 0, 0)
  }
})
afterEach(() => {
  Range.prototype.getClientRects = realGetClientRects
  Element.prototype.getBoundingClientRect = realGetBoundingClientRect
  delete (window as unknown as { __iwStaticLineRule?: string }).__iwStaticLineRule
})

const mount = (html: string): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

describe('staticLineRects — the pane never ranges over a container', () => {
  it('a bulletList is ranged PER ITEM PARAGRAPH — never the <ul>, never the <li>s', () => {
    const host = mount('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>')
    const ul = host.querySelector('ul') as HTMLElement
    staticLineRects(ul)
    expect(asked).toEqual(['p', 'p', 'p'])
    expect(asked).not.toContain('ul')
    // The <li>s are the boxes that became phantom lines. They must never be ranged either.
    expect(asked).not.toContain('li')
  })

  it('a blockquote is ranged at its inner paragraph — the same container shape, the same rule', () => {
    const host = mount('<blockquote><p>quoted</p></blockquote>')
    staticLineRects(host.querySelector('blockquote') as HTMLElement)
    expect(asked).toEqual(['p'])
    expect(asked).not.toContain('blockquote')
  })

  // THE LOAD-BEARING CONTROL. A paragraph takes ONE range over itself — the byte-identical pre-fix
  // call. If this ever changes, every prose document's page breaks change, and prose is Peter's
  // thesis. breaks.prove.mjs is the live counterpart: [2403,4856,7205,9476,…], identical.
  it('a PARAGRAPH with inline marks takes the identical single whole-element range', () => {
    const host = mount('<p>plain <em>emph</em> and <span class="x">span</span> text</p>')
    staticLineRects(host.querySelector('p') as HTMLElement)
    expect(asked).toEqual(['p'])
  })

  it('a heading and a codeBlock are textblocks too — one range each, no descent', () => {
    const host = mount('<h2>head</h2><pre><code>const x = 1</code></pre>')
    staticLineRects(host.querySelector('h2') as HTMLElement)
    expect(asked).toEqual(['h2'])
    asked = []
    staticLineRects(host.querySelector('pre') as HTMLElement)
    expect(asked).toEqual(['pre'])
  })

  it('a NESTED list descends all the way to the leaf paragraphs', () => {
    const host = mount('<ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul>')
    staticLineRects(host.querySelector('ul') as HTMLElement)
    expect(asked).toEqual(['p', 'p'])
    expect(asked.filter((a) => a === 'ul' || a === 'li')).toEqual([])
  })

  it('an EMPTY textblock still yields a line — a missing block is not a smaller block', () => {
    const host = mount('<ul><li><p></p></li><li><p>two</p></li></ul>')
    const ul = host.querySelector('ul') as HTMLElement
    const ps = Array.from(host.querySelectorAll('p'))
    // THE BLANK ITEM: its range yields NOTHING (no text to make a line fragment from) while its box
    // still occupies a line. That asymmetry IS the branch under test — hence the two maps.
    rectsByNode.set(ps[0], [])
    boundingByNode.set(ps[0], R(100, 29.109))
    rectsByNode.set(ps[1], [R(129.109, 23)])
    boundingByNode.set(ps[1], R(129.109, 29.109))
    const out = staticLineRects(ul)
    expect(out).toHaveLength(2)
    expect(out[0].top).toBeCloseTo(100, 3) // the blank item's own line, via getBoundingClientRect
    expect(out[0].height).toBeCloseTo(29.109, 3)
    expect(out[1].top).toBeCloseTo(129.109, 3)
  })

  it('…and a zero-height empty textblock contributes NOTHING — the height>=1 guard is real', () => {
    // The other side of the same branch. Without it the guard could be deleted and the test above
    // would still pass, which is how a half-tested branch looks green.
    const host = mount('<ul><li><p></p></li></ul>')
    const p = host.querySelector('p') as HTMLElement
    rectsByNode.set(p, [])
    boundingByNode.set(p, R(100, 0))
    expect(staticLineRects(host.querySelector('ul') as HTMLElement)).toEqual([])
  })

  it('MIXED content: a container\'s loose text is ranged as a run, not lost', () => {
    // An anonymous block box has no element to ask, so descending into block children ALONE would
    // silently drop the loose text's lines. DocView cannot produce this today — and "it cannot
    // arise today" is exactly the reasoning that let this rule rot in three copies.
    const host = mount('<blockquote>loose text<p>para</p>more loose</blockquote>')
    staticLineRects(host.querySelector('blockquote') as HTMLElement)
    expect(asked).toEqual(['run:blockquote[0,1)', 'p', 'run:blockquote[2,3)'])
  })

  it('the rects returned are the TEXTBLOCKS’ own — the container box is never among them', () => {
    const host = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
    const ul = host.querySelector('ul') as HTMLElement
    const ps = Array.from(host.querySelectorAll('p'))
    // The REAL measurement (panerect.mjs, canonical 18px): a 2-line item — its two text lines.
    rectsByNode.set(ps[0], [R(728.188, 23), R(757.297, 23)])
    rectsByNode.set(ps[1], [R(786.406, 23), R(815.516, 23)])
    const out = staticLineRects(ul)
    expect(out.map((r) => +r.top.toFixed(3))).toEqual([728.188, 757.297, 786.406, 815.516])
    // 58.219 is the <li>'s border box — the rect that became a phantom line. It must be absent.
    expect(out.some((r) => Math.abs(r.height - 58.219) < 0.01)).toBe(false)
  })
})

// ── THE KNOWN-NEGATIVE. Without it, "the rule never ranges a container" could mean "this fixture
// cannot tell the difference" — which is precisely how three self-consistent copies stayed green.
// `__iwStaticLineRule='range'` is production's own seam restoring the pre-fix rule, so the negative
// runs the REAL shipped code path rather than a re-description of it.
describe('the KNOWN-NEGATIVE fires — these fixtures really do discriminate', () => {
  it('the pre-fix rule ranges the <ul> ITSELF, and that is what handed it the <li> boxes', () => {
    ;(window as unknown as { __iwStaticLineRule?: string }).__iwStaticLineRule = 'range'
    const host = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
    const ul = host.querySelector('ul') as HTMLElement
    // The RAW rects the real pane hands the collector for a `<ul>` whose first item is 2 lines
    // (panerect.mjs, verbatim): the li's 58.219px box, then its own first text rect 3.000px below.
    rectsByNode.set(ul, [R(725.188, 58.219), R(728.188, 23), R(757.297, 23)])
    const out = staticLineRects(ul)
    expect(asked).toEqual(['ul']) // ONE range, over the container — the bug, exactly
    expect(out.some((r) => Math.abs(r.height - 58.219) < 0.01)).toBe(true) // the container's box, admitted
    // …and it is under the 80px cut, so collectStaticLines' filter lets it through, 3.000px above
    // the real line it then deletes via the dedup.
    expect(58.219).toBeLessThan(80)
    expect(728.188 - 725.188).toBeCloseTo(3.0, 3)
  })

  it('the shipped rule, on the IDENTICAL input, never sees that box', () => {
    const host = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
    const ul = host.querySelector('ul') as HTMLElement
    rectsByNode.set(ul, [R(725.188, 58.219), R(728.188, 23), R(757.297, 23)])
    const ps = Array.from(host.querySelectorAll('p'))
    rectsByNode.set(ps[0], [R(728.188, 23), R(757.297, 23)])
    rectsByNode.set(ps[1], [R(786.406, 23)])
    const out = staticLineRects(ul)
    expect(asked).toEqual(['p', 'p'])
    expect(out.some((r) => Math.abs(r.height - 58.219) < 0.01)).toBe(false)
    expect(out[0].top).toBeCloseTo(728.188, 3) // the item's FIRST real line — the one the bug deleted
  })
})
