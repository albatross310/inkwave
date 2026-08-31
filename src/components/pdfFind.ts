// FIND IN PDF — the text-matching rules, as pure functions over strings.
//
// Extracted from PdfViewer.tsx. Nothing here touches pdf.js, the DOM or React: the component still
// owns fetching each page's text, drawing the hit rectangles and scrolling to them. What it no
// longer owns is the matching, which had never been tested and had already drifted into two
// versions of one rule (below).
//
// ─── THE DRIFT THIS CLOSES ───────────────────────────────────────────────────────────────────────
// Both call sites walked a `gi` regex with `exec` in a while-loop, and both carried a guard against
// the zero-length-match infinite loop — but DIFFERENT guards:
//
//     runSearch:         while (re.exec(text)) { …; if (re.lastIndex === 0) break }
//     flashQueryOnPage:  while ((m = re.exec(full))) { …; if (re.lastIndex === m.index) re.lastIndex++ }
//
// One bails out of the whole search, the other skips a character and continues. They can only
// disagree on a pattern that matches the empty string, and `searchPattern` cannot build one — the
// query is split on spaces and `.filter(Boolean)`ed, so every alternative is at least one literal
// character, and both call sites return early when the normalised query is ''. So the two guards
// were unreachable, which is precisely why nobody noticed there were two: the difference could not
// show up as a bug, only as a divergence waiting for the day the pattern changes.
//
// `matchRanges` is now the single walk, with a single guard that is correct for BOTH cases (advance
// past a zero-length match rather than abandoning the search), and it is pinned by a test that
// feeds it a pattern the shipped one cannot produce — because a guard nothing can reach is a guard
// nothing can keep.

/** Lower-case, collapse every whitespace run to one space, trim. */
export function normText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The query as a regex: each word literal, any whitespace between them.
 *
 * `\s+` between the words is what lets a quote match across a line break or a re-wrap, which is the
 * whole reason PDF text search cannot just be `indexOf`. Case-insensitive and global.
 */
export function searchPattern(q: string): RegExp {
  return new RegExp(normText(q).split(' ').filter(Boolean).map(escapeRe).join('\\s+'), 'gi')
}

export interface MatchRange { start: number; end: number }

/**
 * The walk itself, over a regex the caller supplies.
 *
 * Separate from `matchRanges` for one reason, and it is the point of this module: the zero-length
 * guard below is UNREACHABLE through `matchRanges`, because `searchPattern` cannot build a pattern
 * that matches the empty string. A guard no test can reach is not a guard — so the seam exists so
 * the test can hand in a star-quantified pattern and watch it advance instead of spinning.
 * (Not written as a regex literal here: its closing delimiter would end this comment.)
 */
export function walkMatches(text: string, re: RegExp): MatchRange[] {
  const out: MatchRange[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length })
    // The one guard, for both callers: a zero-length match leaves lastIndex where it was and would
    // spin forever. Step past it rather than abandoning the search.
    if (re.lastIndex === m.index) re.lastIndex++
  }
  return out
}

/**
 * Every occurrence of `query` in `text`, as [start, end) offsets INTO `text` AS GIVEN.
 *
 * It deliberately does not normalise `text`: one caller needs offsets that map back to real DOM
 * spans, so normalising here would silently shift every rectangle it draws. Normalising the text is
 * the caller's decision; normalising the QUERY is this module's, and `searchPattern` does it.
 */
export function matchRanges(text: string, query: string): MatchRange[] {
  const nq = normText(query)
  if (!nq) return []
  return walkMatches(text, searchPattern(nq))
}

/**
 * The leading fragments to try when hunting a cited sentence, longest first.
 *
 * PDF text extraction drops and re-wraps words, so a long exact quote often will not match while a
 * leading fragment reliably does. The ladder is [whole quote, 8, 6, 4] words, dropping any rung
 * longer than the quote and any duplicate — note the de-duplication is against the ORIGINAL ladder,
 * so a quote of exactly 8 words yields one 8-word try, not two.
 *
 * Returns [] for a quote with no words, which is the caller's "nothing to look for".
 */
export function quoteFragments(quote: string): string[] {
  const words = normText(quote).split(' ').filter(Boolean)
  if (!words.length) return []
  return [words.length, 8, 6, 4]
    .filter((n, i, a) => n <= words.length && a.indexOf(n) === i)
    .map((n) => words.slice(0, n).join(' '))
}

/**
 * Which of a text layer's spans a query touches.
 *
 * The spans are joined with a single space between them — the same string the component used to
 * build inline — and a span counts as hit when its own [start, end) range OVERLAPS a match. The
 * separator space is deliberately NOT part of any span's range, so a match that lands entirely in
 * the gap between two spans touches neither, exactly as before.
 *
 * Returns span INDICES, ascending and unique, so the caller can map them back to its own elements.
 */
export function spanHitIndices(spanTexts: string[], query: string): number[] {
  let full = ''
  const ranges: MatchRange[] = []
  for (const t of spanTexts) {
    ranges.push({ start: full.length, end: full.length + t.length })
    full += t + ' '
  }
  const hit = new Set<number>()
  for (const { start, end } of matchRanges(full, query)) {
    for (let i = 0; i < ranges.length; i++) {
      if (ranges[i].end > start && ranges[i].start < end) hit.add(i)
    }
  }
  return [...hit].sort((a, b) => a - b)
}
