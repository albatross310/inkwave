// @vitest-environment jsdom
// THE CONTENT ANCHOR'S FIRST UNIT GUARD — the /snapshot scrub keeping the reading line on the same
// WORDS as you flip between versions. LIVE, no flag.
//
// This machinery was established in a real browser (round 11: anchor drift p50 186px -> 0px, max
// 374px -> 1px, exact 26/26) and then had NOTHING keeping it. CLAUDE.md's own headline: "a proof
// that ran once and convinced everyone is indistinguishable, six weeks later, from a proof that
// never ran — and the gate says green either way." The browser probe stays the truth; this is the
// ~40ms version that fails when someone breaks it.
//
// ─── THE LAYOUT MODEL, AND WHY THERE HAS TO BE ONE ───────────────────────────────────────────────
// jsdom lays nothing out: every getBoundingClientRect is zeros, so `scrollTopForSignature` would
// return null on EVERY input and a suite built on it would pass while proving nothing — the
// empty-instrument trap. So the rects are stubbed with the simplest honest model of a block flow:
// text wraps every LINE_CHARS characters, each line is LINE_H tall, and a character's top is a
// function of its GLOBAL offset. That is the only property the anchor arithmetic actually relies on
// (text lays out monotonically down the flow, which is what licenses the binary search).
//
// The model is proved to discriminate before any verdict is read — see the VOID GUARD below.
//
// MUTATION-PROVED, 6 mutants, all die. Each applied to snapshotAnchor.ts, the listed tests observed
// to fail, then reverted:
//   midlineSignature drops the offsetAtContentY fallback ... 4  (this is round 11's actual bug)
//   the binary search compares the wrong way ............... 4
//   scrollTopForSignature drops the midline centring ....... 3
//   the short-prefix retry is deleted ...................... 1
//   ANCHOR_MIN gate on the short prefix removed ............ 1
//   locateOffset uses `>` instead of `>=` .................. 1
//
// The ANCHOR_MIN one SURVIVED the first attempt, and the reason is worth keeping: my test asserted
// null for a signature whose short prefix was ALSO absent, so both the gate and the plain not-found
// path answered null and the mutant was invisible. Reaching the gate needs a prefix that is
// FINDABLE and MEANINGLESS. See that test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { globalOffsetOf, locateOffset, midlineSignature, scrollTopForSignature } from './snapshotAnchor'

const LINE_CHARS = 40
const LINE_H = 20
const PANE_H = 400

let el: HTMLElement
let realRangeRect: typeof Range.prototype.getBoundingClientRect
let realElRect: typeof HTMLElement.prototype.getBoundingClientRect

/** The pane's own box: pinned at the viewport origin so content-y and viewport-y differ only by scrollTop. */
function stubLayout() {
  realRangeRect = Range.prototype.getBoundingClientRect
  realElRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, right: 600, bottom: PANE_H, width: 600, height: PANE_H, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
  Range.prototype.getBoundingClientRect = function (this: Range) {
    const node = this.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return new DOMRect(0, 0, 0, 0)
    const g = globalOffsetOf(el, node as Text, this.startOffset)
    const top = Math.floor(g / LINE_CHARS) * LINE_H - el.scrollTop
    return { top, left: 0, right: 8, bottom: top + LINE_H, width: 8, height: LINE_H, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  }
}

/** A pane of `n` characters of distinguishable text, split across several element children — the
 *  real pane is a handful of giant [data-opidx] spans, not one text node. */
function makePane(text: string, chunks = 3): HTMLElement {
  const root = document.createElement('div')
  const size = Math.ceil(text.length / chunks)
  for (let i = 0; i < text.length; i += size) {
    const span = document.createElement('span')
    span.textContent = text.slice(i, i + size)
    root.appendChild(span)
  }
  Object.defineProperty(root, 'clientHeight', { value: PANE_H, configurable: true })
  Object.defineProperty(root, 'offsetWidth', { value: 600, configurable: true })
  root.scrollTop = 0
  document.body.appendChild(root)
  return root
}

/** Exactly `n` characters of prose whose every 8-character window is unique, so a signature
 *  identifies ONE place. The +1 matters: at 8 characters per word, `ceil(n / 8)` words come up
 *  short of `n` after the slice, which is a helper bug that reads as a broken locateOffset. */
const prose = (n: number) => Array.from({ length: Math.ceil(n / 8) + 1 },
  (_, i) => `w${String(i).padStart(6, '0')} `).join('').slice(0, n)

beforeEach(() => { stubLayout() })
afterEach(() => {
  Range.prototype.getBoundingClientRect = realRangeRect
  HTMLElement.prototype.getBoundingClientRect = realElRect
  document.body.innerHTML = ''
})

describe('VOID GUARD — the stubbed layout must be able to say "no"', () => {
  it('the model gives different offsets different tops, and jsdom alone would not', () => {
    // Without this, every assertion below could be satisfied by a stub that returns a constant, and
    // a suite that cannot distinguish two positions cannot prove anything about anchoring.
    el = makePane(prose(2000))
    const r = document.createRange()
    const a = locateOffset(el, 0)!, b = locateOffset(el, 800)!
    r.setStart(a.node, a.offset); r.setEnd(a.node, a.offset + 1)
    const topA = r.getBoundingClientRect().top
    r.setStart(b.node, b.offset); r.setEnd(b.node, b.offset + 1)
    const topB = r.getBoundingClientRect().top
    expect(topA).toBe(0)
    expect(topB).toBe((800 / LINE_CHARS) * LINE_H)
    expect(topB).not.toBe(topA)
  })
})

describe('globalOffsetOf / locateOffset — the offset walk across several spans', () => {
  it('round-trips an offset through the middle of a later span', () => {
    el = makePane(prose(300), 3)
    for (const g of [0, 1, 99, 100, 150, 299]) {
      const loc = locateOffset(el, g)!
      expect(globalOffsetOf(el, loc.node, loc.offset)).toBe(g)
    }
  })

  it('locateOffset lands on the span BOUNDARY rather than running past it', () => {
    // `acc + len >= globalOffset` (not >) is what puts an offset exactly at a span's end on that
    // span rather than the next one. With `>` the first span is skipped and every offset shifts.
    el = makePane('abcde', 5) // five one-character spans
    expect(locateOffset(el, 0)).toMatchObject({ offset: 0 })
    expect(locateOffset(el, 1)!.node.data).toBe('a')   // the boundary belongs to the span it ends
    expect(locateOffset(el, 2)!.node.data).toBe('b')
  })

  it('an offset past the end of the text has nowhere to land', () => {
    el = makePane('abcde', 1)
    expect(locateOffset(el, 99)).toBeNull()
  })

  it('globalOffsetOf on a node that is not in the tree returns the total length', () => {
    // Observation, not a guarantee: the walk falls off the end and returns the accumulator.
    el = makePane('abcdef', 2)
    const stray = document.createTextNode('zz')
    expect(globalOffsetOf(el, stray, 0)).toBe(6)
  })
})

describe('midlineSignature — what is on the reading line', () => {
  it('reads the text at the midline, not at the top of the pane', () => {
    el = makePane(prose(4000))
    el.scrollTop = 0
    // Midline is content-y 200 => line 10 => offset 400.
    expect(midlineSignature(el)).toBe(prose(4000).slice(400, 480))
  })

  it('follows the scroll', () => {
    el = makePane(prose(4000))
    el.scrollTop = 600 // midline content-y 800 => line 40 => offset 1600
    expect(midlineSignature(el)).toBe(prose(4000).slice(1600, 1680))
  })

  it('ROUND 11: it works with NO caret hit-test available at all', () => {
    // The bug this guards. `caretAtPoint` reads the TOPMOST element, and at mount the LoadingVeil
    // covers this pane — so it returned the veil, the signature came back null, and the anchor
    // stayed null for the WHOLE SESSION unless the reader happened to scroll (probed: 23/23 warm
    // layers took `ratio.nosig`). jsdom implements neither caretPositionFromPoint nor
    // caretRangeFromPoint, so every test in this file exercises exactly that covered-pane path.
    expect((document as unknown as Record<string, unknown>).caretPositionFromPoint).toBeUndefined()
    expect((document as unknown as Record<string, unknown>).caretRangeFromPoint).toBeUndefined()
    el = makePane(prose(4000))
    expect(midlineSignature(el)).not.toBeNull()
  })

  it('refuses to anchor on text too short to identify a place', () => {
    el = makePane('short')
    expect(midlineSignature(el)).toBeNull()
  })

  it('an empty pane has no signature', () => {
    el = makePane('')
    expect(midlineSignature(el)).toBeNull()
  })
})

describe('scrollTopForSignature — putting those words back on the line', () => {
  it('ROUND-TRIPS: capture at a scroll position, restore, and you are back where you were', () => {
    // The property the whole mechanism exists for, and the one the browser probe measured as drift
    // in px. Here it is exact because the model is exact.
    const text = prose(4000)
    el = makePane(text)
    for (const at of [0, 200, 600, 1000]) {
      el.scrollTop = at
      const sig = midlineSignature(el)!
      expect(scrollTopForSignature(el, sig, at / (text.length * LINE_H / LINE_CHARS))).toBe(at)
    }
  })

  it('lands the signature ON the midline, not at the top of the pane', () => {
    // Dropping the `- el.clientHeight / 2` scrolls the anchor to the pane's top edge: the reader's
    // line jumps half a screen on every version step, which is what "registration" means here.
    const text = prose(4000)
    el = makePane(text)
    const sig = text.slice(800, 880)               // line 20 => content-y 400
    expect(scrollTopForSignature(el, sig, 0.2)).toBe(400 - PANE_H / 2)
  })

  it('prefers the occurrence nearest the bias — the same tie-break the provenance half uses', () => {
    // Delegated to offsetOfNearest (provenance/anchorMap.ts) rather than reimplemented; this proves
    // the delegation is wired, not that the rule works (anchorMap.test.ts owns that).
    const filler = 'x'.repeat(1000)
    const text = `${'ANCHORTEXTHERE'}${filler}${'ANCHORTEXTHERE'}`
    el = makePane(text)
    const near = scrollTopForSignature(el, 'ANCHORTEXTHERE', 0)!
    const far = scrollTopForSignature(el, 'ANCHORTEXTHERE', 1)!
    expect(far).toBeGreaterThan(near)
  })

  it('a lightly edited anchor still lands, via the short-prefix retry', () => {
    const text = prose(4000)
    el = makePane(text)
    const sig = text.slice(800, 880)
    const edited = sig.slice(0, 40) + 'THIS WAS TYPED AFTER THE ANCHOR WAS TAKEN'
    // The full signature is absent, but its first 28 characters are not.
    expect(text.includes(edited)).toBe(false)
    expect(scrollTopForSignature(el, edited, 0.2)).toBe(400 - PANE_H / 2)
  })

  it('refuses a prefix too weak to anchor rather than guessing a place', () => {
    // The ANCHOR_MIN gate on the RETRY, and reaching it takes care: the prefix must be findable but
    // meaningless. A pane with a long run of whitespace gives exactly that — the full signature is
    // absent, but its first 28 characters are all spaces, which occur in the pane and identify
    // nothing. Landing there would throw the reader somewhere arbitrary; falling back to the ratio
    // is the honest answer.
    //
    // My first version of this test asserted the same null for a signature whose prefix was ALSO
    // absent, so it passed with the gate removed — it was scoring the not-found path, not the gate.
    el = makePane(`${prose(1000)}${' '.repeat(30)}${prose(1000)}`)
    const unfindableAfterWhitespace = `${' '.repeat(30)}MISSINGTAIL`
    expect(scrollTopForSignature(el, unfindableAfterWhitespace, 0.5)).toBeNull()
  })

  it('an anchor that has vanished entirely returns null, so the caller can fall back', () => {
    el = makePane(prose(4000))
    expect(scrollTopForSignature(el, 'NOTHING LIKE THIS APPEARS ANYWHERE IN THE PANE', 0.5)).toBeNull()
  })
})
