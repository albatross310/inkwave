// @vitest-environment jsdom
// THE MID-LINE BREAK REGRESSION (2026-07-17) — inline-atom NodeViews must collapse to ONE rect.
//
// `range.selectNodeContents(block).getClientRects()` DESCENDS INTO NodeView subtrees, so a
// citation's ⤵ biblink button (display:inline-flex, ~6px below the text line — MORE than the 3px
// same-line dedup tolerance) survived as a PHANTOM LINE. A page break attributed to it lands
// mid-line, opening a gap in the middle of a rendered line: measured 6 of 55 live breaks on
// thesis-shaped citation prose before the fix, 0 after (scripts/textrender-probe/midline.prove.mjs).
//
// THE FIXTURE IS THE POINT. It is a MULTI-LINE paragraph with the NodeView MID-PARAGRAPH, built from
// the REAL geometry measured in the running app (rect tops 3.00/32.11/61.22/90.33/119.44/148.55/
// 177.66 at 29.109px leading; the arrow's phantom box at top 96.69 h 16). A fixture of single-line
// blocks — or one without a NodeView inside a line — makes the buggy branch a no-op and the test
// passes through the bug reporting nothing. So each test below asserts the KNOWN-POSITIVE first:
// the unfixed path must SEE the phantom, or the test is not testing anything.
import { describe, it, expect } from 'vitest'
import { blockLineRects, keepLineRects } from './PaginationExtension'

const LINE_TOPS = [3, 32.11, 61.22, 90.33, 119.44, 148.55, 177.66] // 7 real lines, 29.109px apart
const ARROW_TOP = 96.69 // the ⤵ button: +6.36px off its line — past the 3px dedup tolerance
const CITE_LINE = 90.33 // the citation's own outer box sits exactly ON line 4

const rect = (top: number, left: number, w: number, h: number): DOMRect =>
  ({ top, left, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => ({}) }) as DOMRect

// A faithful model of the ONE browser behaviour under test: a Range descends into every descendant
// and returns each leaf's own box. Rects are attached per node; a range over (parent, i..j) returns
// the rects of childNodes[i..j-1] and all their descendants, in document order.
const boxes = new WeakMap<Node, DOMRect[]>()

function build(): { p: HTMLElement; atom: HTMLElement; arrow: DOMRect } {
  const p = document.createElement('p')
  const textA = document.createTextNode('lines 1-3 and the start of line 4 ')
  // Lines 1-3 plus the part of line 4 that precedes the citation.
  boxes.set(textA, [
    rect(LINE_TOPS[0], 0, 528.2, 23), rect(LINE_TOPS[1], 0, 560.22, 23),
    rect(LINE_TOPS[2], 0, 559.48, 23), rect(LINE_TOPS[3], 0, 349.97, 23),
  ])
  // THE NODEVIEW: an inline atom, MID-line-4. Its outer box is one line-height box on line 4; its
  // INTERIOR holds the label box plus the offset ⤵ arrow box — the phantom.
  const atom = document.createElement('span')
  atom.className = 'react-renderer node-citation'
  const label = document.createTextNode('(Mercer, 1994, ')
  boxes.set(label, [rect(CITE_LINE, 357.64, 91.19, 23)])
  const button = document.createElement('button')
  const arrowText = document.createTextNode('⤵')
  const arrow = rect(ARROW_TOP, 467.09, 5.94, 16)
  boxes.set(arrowText, [arrow])
  button.appendChild(arrowText)
  atom.appendChild(label)
  atom.appendChild(button)
  boxes.set(atom, [rect(CITE_LINE, 357.64, 141.25, 23)]) // the atom's OWN outer box
  const textB = document.createTextNode('rest of line 4 then lines 5-7')
  boxes.set(textB, [
    rect(LINE_TOPS[3], 491.22, 66.38, 23), rect(LINE_TOPS[4], 0, 292.25, 23),
    rect(LINE_TOPS[5], 0, 586.86, 23), rect(LINE_TOPS[6], 0, 446.25, 23),
  ])
  p.appendChild(textA); p.appendChild(atom); p.appendChild(textB)
  ;(atom as HTMLElement).getBoundingClientRect = () => boxes.get(atom)![0]
  return { p, atom, arrow }
}

function collectFrom(node: Node): DOMRect[] {
  const own = boxes.get(node) ?? []
  if (node.nodeType === 3) return own
  const out: DOMRect[] = []
  for (const c of Array.from(node.childNodes)) out.push(...collectFrom(c))
  return out.length ? out : own
}

// Stub Range.getClientRects with the descend-into-everything semantics that CAUSE the bug.
function installRangeStub() {
  Range.prototype.getClientRects = function (this: Range) {
    const sc = this.startContainer, ec = this.endContainer
    const out: DOMRect[] = []
    if (sc.nodeType === 3 && sc === ec) return out as unknown as DOMRectList
    const kids = Array.from(sc.childNodes)
    const from = this.startOffset, to = ec === sc ? this.endOffset : kids.length
    for (let i = from; i < to; i++) out.push(...collectFrom(kids[i]))
    return Object.assign(out, { item: (i: number) => out[i] }) as unknown as DOMRectList
  }
}

describe('collectLines: inline-atom NodeViews collapse to a single rect', () => {
  it('KNOWN-POSITIVE: the old whole-block range DOES pick up the NodeView interior (else this test is blind)', () => {
    installRangeStub()
    const { p, arrow } = build()
    const r = document.createRange()
    r.selectNodeContents(p)
    const old = Array.from(r.getClientRects())
    // The instrument must reproduce the bug before it can verify the fix.
    expect(old.some((x) => x.top === arrow.top)).toBe(true)
    // 7 real lines, but the phantom makes the filter report 8 — the artifact, in one number.
    expect(keepLineRects(old, 1)).toHaveLength(8)
  })

  it('collapses the atom to ONE rect: the phantom is gone and the block measures its real 7 lines', () => {
    installRangeStub()
    const { p, atom, arrow } = build()
    const rects = blockLineRects(p, [atom])
    expect(rects.some((x) => x.top === arrow.top)).toBe(false) // no interior box survives
    expect(rects.filter((x) => x.top === CITE_LINE && x.width === 141.25)).toHaveLength(1) // exactly one atom box
    const lines = keepLineRects(rects, 1)
    expect(lines).toHaveLength(7)
    expect(lines.map((l) => l.top)).toEqual(LINE_TOPS)
  })

  it('a block with NO atoms takes the byte-identical old path', () => {
    installRangeStub()
    const { p } = build()
    const r = document.createRange()
    r.selectNodeContents(p)
    const old = Array.from(r.getClientRects())
    // This is what keeps plain/headings/lists bit-for-bit unchanged: same call, same rects.
    expect(blockLineRects(p, [])).toEqual(old)
  })

  it('keeps rects in DOCUMENT order so the same-line dedup still works', () => {
    installRangeStub()
    const { p, atom } = build()
    const rects = blockLineRects(p, [atom])
    const line4 = rects.filter((x) => Math.abs(x.top - CITE_LINE) < 1)
    expect(line4.map((x) => x.left)).toEqual([0, 357.64, 491.22]) // text, atom, text — left to right
  })

  it('nested atoms collapse to the OUTERMOST box only', () => {
    installRangeStub()
    const { p, atom } = build()
    const inner = atom.querySelector('button') as HTMLElement
    inner.getBoundingClientRect = () => boxes.get(inner.firstChild!)![0]
    // Passing both: the inner one is inside the outer, so only the outer contributes.
    const rects = blockLineRects(p, [atom, inner])
    expect(rects.filter((x) => Math.abs(x.top - CITE_LINE) < 1 && x.width === 141.25)).toHaveLength(1)
    expect(rects.some((x) => x.top === ARROW_TOP)).toBe(false)
  })
})

describe('keepLineRects (the real filter collectLines uses)', () => {
  it('drops a box within 3px of the current line, keeps one past it — the tolerance the arrow beat', () => {
    const near = [rect(90.33, 0, 300, 23), rect(92.5, 300, 40, 23)] // +2.17px ⇒ same line
    expect(keepLineRects(near, 1)).toHaveLength(1)
    const past = [rect(90.33, 0, 300, 23), rect(96.69, 300, 6, 16)] // +6.36px ⇒ counted as a line
    expect(keepLineRects(past, 1)).toHaveLength(2)
  })

  it('skips zero-size boxes and tall widgets (scaled by magnify)', () => {
    expect(keepLineRects([rect(0, 0, 0, 0)], 1)).toHaveLength(0)
    expect(keepLineRects([rect(0, 0, 500, 200)], 1)).toHaveLength(0) // > 80px ⇒ a gap widget
    expect(keepLineRects([rect(0, 0, 500, 200)], 3)).toHaveLength(1) // 80*3 ⇒ a real magnified line
  })
})
