// THE TWO PAGE ANSWERS — ~5ms, no browser.
//
// `pageFromTops` replaced two loops that each read every page wrapper's rect on every scroll frame.
// The risk in that change is not the arithmetic, it is the TEMPTATION: the two answers are equal
// most of the time, so someone will eventually notice the duplication and return one number. These
// tests exist to make that fail, by pinning the case where they legitimately differ.

import { describe, it, expect } from 'vitest'
import { pageFromTops } from './pdfScrollPage'

/** Five 800px pages, laid out from a scroll offset. Page i top = -offset + i*800. */
const tops = (offset: number, n = 5) => Array.from({ length: n }, (_, i) => -offset + i * 800)
const answer = (offset: number, paneTop = 0, paneH = 900) =>
  pageFromTops(tops(offset), paneTop, paneTop + paneH * 0.35)

describe('pageFromTops', () => {
  it('at the very top both answers are page 1', () => {
    expect(answer(0)).toEqual({ nearest: 1, pageNow: 1 })
  })

  it('scrolled to page 3 exactly, both agree', () => {
    expect(answer(1600)).toEqual({ nearest: 3, pageNow: 3 })
  })

  // THE DISCRIMINATING CASE, and the reason both answers exist.
  it('just BEFORE a page reaches the reading line the two answers differ by one', () => {
    // Page 2's top sits 350px below the pane top: that is NEARER the pane top than page 1 (500px
    // above), so resume says page 2 — but it has not yet crossed the reading line at 315px, so the
    // indicator still says page 1. The page whose last line is scrolling away is not what you are
    // reading, and that one-page lag is the whole reason both answers exist.
    const a = pageFromTops([-500, 350, 1150], 0, 315)
    expect(a.nearest).toBe(2)
    expect(a.pageNow).toBe(1)
    expect(a.nearest).not.toBe(a.pageNow)   // if these ever collapse to one number, this fires
  })

  it('nearest looks BOTH ways — a page scrolled just past the top still wins', () => {
    // Page 2 is 30px ABOVE the pane top; page 3 is 770px below. Resume should be page 2.
    expect(pageFromTops([-830, -30, 770], 0, 315).nearest).toBe(2)
  })

  it('pageNow takes the LAST page past the line, not the first', () => {
    expect(pageFromTops([-100, -50, -10, 500], 0, 315).pageNow).toBe(3)
  })

  it('an empty document is page 1, never page 0', () => {
    expect(pageFromTops([], 0, 315)).toEqual({ nearest: 1, pageNow: 1 })
  })

  it('a non-zero pane top is handled — the panel is not always at y=0', () => {
    // Same geometry as the page-3 case, shifted down 200px along with the pane.
    expect(answer(1600, 200)).toEqual({ nearest: 3, pageNow: 3 })
  })
})
