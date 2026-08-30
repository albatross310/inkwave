// WHICH PAGE ARE WE ON — the two answers the PDF scroll reporter needs, from one pass.
//
// ⚠ THESE ARE TWO DIFFERENT QUESTIONS AND BOTH ARE WANTED. They were computed by two separate loops
// over the same page rects, and it would be an easy and wrong "simplification" to collapse them
// into one number:
//   · `nearest`  — the page whose top is CLOSEST to the pane's top, in either direction. This is
//                  the RESUME position: reopen the source and you land where you left off, and a
//                  page scrolled just past the top is the right answer for that.
//   · `pageNow`  — the LAST page whose top has passed the pane's upper third. This is the READING
//                  indicator ("page 7 of 40"), and it deliberately lags `nearest`: the page whose
//                  last line is scrolling away is not the page you are reading.
// On a boundary they disagree by one, which is correct in both cases and is pinned by a test.
//
// WHY IT IS PURE. The caller reads each wrapper's `top` ONCE per scroll frame and passes the array.
// Before this existed the reporter ran two `getBoundingClientRect()` loops over every page plus two
// reads of the pane's own rect — 2N+2 layout reads per frame, on a surface that is deliberately
// supersampled and lazily rendered. It is N+1 now, and the rule can be tested without a browser.

export interface ScrollPageAnswer {
  /** 1-based page whose top is nearest the pane top — the resume position. */
  nearest: number
  /** 1-based page for the "page n of x" indicator — the last one past the reading line. */
  pageNow: number
}

/**
 * @param tops     each page wrapper's viewport `top`, in page order, read once by the caller.
 * @param paneTop  the scroller's own viewport `top`.
 * @param readLine the y below which a page counts as "being read" (pane top + 35% of its height).
 */
export function pageFromTops(tops: readonly number[], paneTop: number, readLine: number): ScrollPageAnswer {
  // An empty document is page 1, not page 0 — the indicator is 1-based and "page 0 of 0" is a bug
  // the reader would report, not a state.
  let nearest = 1
  let bestDist = Infinity
  let pageNow = 1
  for (let i = 0; i < tops.length; i++) {
    const t = tops[i]
    const d = Math.abs(t - paneTop)
    if (d < bestDist) { bestDist = d; nearest = i + 1 }
    if (t <= readLine) pageNow = i + 1
  }
  return { nearest, pageNow }
}
