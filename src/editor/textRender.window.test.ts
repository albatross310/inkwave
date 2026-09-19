// THE CRUX: A PAGE CAN BE LAID OUT EXACTLY WITHOUT LAYING OUT THE PAGES BEFORE IT. ~40ms, no browser.
//
// A break `at` IS a line start, and greedy wrap restarts deterministically at a line start — so GIVEN
// the break position, the page's own layout is prefix-independent. That is what lets /snapshot lay out
// a window (`from`/`maxHeight`) in O(window) instead of O(doc) (→ docs/archive/snapshot-scrub-rounds.md
// #tr-window, #trp-window). `window.prove.mjs` (retired to docs/archive/probes/) held it in a browser.
//
// THE TEST MUST DISCRIMINATE, and the probe's first version did not: it scored a deliberately-wrong
// cut at 29/30, identical to the correct cut, for two reasons — (a) an off-by-one (cut at `at-1`, want
// `pos-cutAt+1`) mismatched line 0 ALWAYS; (b) a 2-char-off cut is not a real negative, because dropping
// 2 chars from the first word leaves every LATER line starting at the same original position. So: cut
// at `at`, rebase to ORIGINAL positions, and use MID-LINE negatives, which force the wrap to cascade.
// GATE: the correct cut must STRICTLY beat every negative.

import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { buildRenderModel, anchorPosOfPage, type RenderGeom } from './textRender'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
  },
})
const GEOM: RenderGeom = {
  pageWidthPx: 794, pageHeightPx: 1123, topMarginPx: 96, sideMarginPx: 96,
  contentWidthPx: 602, basePx: 18, ratio: 1.618, paraSpacingEm: 0.5,
}
const measure = (t: string, font: string) => {
  const m = font.match(/(\d+(?:\.\d+)?)px/); const size = m ? parseFloat(m[1]) : 18
  let w = 0
  for (const ch of t) w += (ch === ' ' ? 5 : 6 + (ch.charCodeAt(0) % 5)) * (size / 18)
  return w
}
const fontLoaded = () => true

function rng(seed: number) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 }
const W = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon'.split(' ')
function longDoc(seed: number, paras = 60): PMNode {
  const rnd = rng(seed)
  const content: unknown[] = []
  for (let p = 0; p < paras; p++) {
    const n = 60 + Math.floor(rnd() * 120)
    const o: string[] = []
    for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)])
    content.push({ type: 'paragraph', content: [{ type: 'text', text: o.join(' ') + '.' }] })
  }
  return schema.nodeFromJSON({ type: 'doc', content })
}

describe('prefix-independent window layout', () => {
  const doc = longDoc(19)
  const full = buildRenderModel(doc, GEOM, measure, fontLoaded, {})

  /** Lay out the TAIL from `cutAt` with no prefix knowledge and score its line starts against page
   *  `pageIdx` of the full model, rebased to original positions (tail pos 1 IS cutAt ⇒ +cutAt−1). */
  const cmp = (cutAt: number, pageIdx: number) => {
    const tail = doc.cut(cutAt)
    const m = buildRenderModel(tail, GEOM, measure, fontLoaded, {})
    const want = full.lines.filter((_, i) => full.pageOfLine[i] === pageIdx).map((l) => l.pos)
    const got = m.lines.map((l) => l.pos + cutAt - 1)
    const n = Math.min(got.length, want.length)
    let match = 0
    for (let i = 0; i < n; i++) if (got[i] === want[i]) match++
    return { compared: n, match, exact: n > 0 && match === n }
  }

  it('the fixture spans several pages (or "every page" below is vacuous)', () => {
    expect(full.pages).toBeGreaterThanOrEqual(4)
  })

  for (const p of [1, 2, 3]) {
    it(`page ${p}: laid out from its own break position, every line start is EXACT`, () => {
      const at = anchorPosOfPage(full, p)
      const good = cmp(at, p)
      expect(good.compared).toBeGreaterThan(20)
      expect(good.exact).toBe(true)
    })

    it(`page ${p}: the correct cut STRICTLY beats every MID-LINE negative (the wrap cascades from a wrong start)`, () => {
      const at = anchorPosOfPage(full, p)
      const good = cmp(at, p)
      const negs = [at + 25, at + 40, at + 80].map((c) => cmp(c, p))
      for (const n of negs) expect(good.match).toBeGreaterThan(n.match)
      // And the negatives compared a REAL page's worth of lines — a tail that laid out nothing would
      // "lose" 0 < N by construction.
      for (const n of negs) expect(n.compared).toBeGreaterThan(20)
    })
  }

  it('the `from` window option gives the same page as cutting the document there', () => {
    const p = 2
    const at = anchorPosOfPage(full, p)
    const win = buildRenderModel(doc, GEOM, measure, fontLoaded, { from: at, maxHeight: GEOM.pageHeightPx * 2 })
    const want = full.lines.filter((_, i) => full.pageOfLine[i] === p).map((l) => l.pos)
    const got = win.lines.map((l) => l.pos).slice(0, want.length)
    expect(got).toEqual(want)
  })
})
