// CHARACTERIZATION of find-in-PDF's matching rules. Before this file the search had no test at all
// — the only way to exercise it was to open a real PDF — and the two call sites had already grown
// two different guards for one hazard (see pdfFind.ts's header).
//
// The claims here are observations of the shipped behaviour. The one thing that is NOT a mere
// observation is `walkMatches`' zero-length guard: the two shipped guards disagreed, and this file
// picks the surviving one and proves it does what the other could not.
//
// MUTATION-PROVED. Each mutant was applied to pdfFind.ts, the listed tests observed to fail, then
// reverted:
//   `\\s+` -> ' ' in searchPattern .............. 'matches across a line break' (+2)
//   drop escapeRe from searchPattern ............ 'a query full of regex metacharacters'
//   drop the zero-length guard .................. 'walkMatches advances past a zero-length match'
//                                                 (hangs — the test has its own iteration cap)
//   guard -> `if (re.lastIndex === 0) break` .... same test (returns 1 range, not 4)
//   drop the a.indexOf(n) === i de-dup .......... 'a quote of exactly eight words'
//   normText without .trim() .................... 3 tests, incl. 'the separator space'
//
// ONE MUTANT SURVIVED, and it is a true fact rather than a gap in these tests. Loosening the span
// overlap test from `r.end > start` to `r.end >= start` changes nothing observable, because the
// spans are joined with an injected space and `searchPattern` never builds a pattern that can begin
// with whitespace — so a match can never START at the offset where a span ENDS, and the two
// comparisons cannot disagree. The strictness is dead precision, kept because this is a refactor.
// Recorded rather than quietly dropped from the list: an unkillable mutant is worth knowing about,
// and the tempting response — inventing a case that reaches it — would be testing a fiction.

import { describe, expect, it } from 'vitest'
import {
  escapeRe, matchRanges, normText, quoteFragments, searchPattern, spanHitIndices, walkMatches,
} from './pdfFind'

describe('normText / escapeRe', () => {
  it('lower-cases, collapses whitespace runs, and trims', () => {
    expect(normText('  The   Critique\nof\tPure  Reason ')).toBe('the critique of pure reason')
    expect(normText('')).toBe('')
    expect(normText('   \n ')).toBe('')
  })

  it('is idempotent — both call sites normalise an already-normalised query', () => {
    const once = normText(' A  B \n C ')
    expect(normText(once)).toBe(once)
  })

  it('escapes every regex metacharacter it claims to', () => {
    expect(escapeRe('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
    )
  })
})

describe('searchPattern', () => {
  it('matches across a line break, a double space and a tab — the whole point of \\s+', () => {
    // PDF text extraction re-wraps, so an exact substring search would miss almost every real quote.
    expect('pure\nreason').toMatch(searchPattern('pure reason'))
    expect('pure  reason').toMatch(searchPattern('pure reason'))
    expect('pure\treason').toMatch(searchPattern('pure reason'))
  })

  it('is case-insensitive', () => {
    expect('PURE REASON').toMatch(searchPattern('pure reason'))
  })

  it('does NOT match when the words are out of order or something sits between them', () => {
    expect(matchRanges('reason pure', 'pure reason')).toEqual([])
    expect(matchRanges('pure and reason', 'pure reason')).toEqual([])
  })

  it('a query full of regex metacharacters is matched literally, not compiled', () => {
    // Without escapeRe this either throws on an unbalanced bracket or matches the wrong thing.
    expect(matchRanges('cost is $5.00 (net)', '$5.00 (net)')).toEqual([{ start: 8, end: 19 }])
    expect(() => matchRanges('anything', 'a[b')).not.toThrow()
    expect(matchRanges('a[b c', 'a[b')).toEqual([{ start: 0, end: 3 }])
  })
})

describe('matchRanges', () => {
  it('returns every occurrence, as offsets into the text AS GIVEN', () => {
    expect(matchRanges('ab XX ab', 'ab')).toEqual([{ start: 0, end: 2 }, { start: 6, end: 8 }])
  })

  it('normalises the query, not the text', () => {
    // Load-bearing: one caller maps these offsets back onto real DOM spans, so normalising the text
    // here would shift every rectangle it draws. A padded query must still find an unpadded hit.
    expect(matchRanges('the Critique of pure reason', '  PURE   reason ')).toEqual([{ start: 16, end: 27 }])
  })

  it('an empty or all-whitespace query finds nothing rather than everything', () => {
    // The failure this prevents is loud: an empty pattern is `//gi`, which matches at every offset.
    expect(matchRanges('some text', '')).toEqual([])
    expect(matchRanges('some text', '   \n ')).toEqual([])
  })

  it('overlapping occurrences are reported non-overlapping, left to right', () => {
    // exec resumes at lastIndex, so 'aaa' contains two 'aa' but only one is found. Recorded because
    // it is the kind of thing a future rewrite might "fix" into a behaviour change.
    expect(matchRanges('aaaa', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }])
    expect(matchRanges('aaa', 'aa')).toEqual([{ start: 0, end: 2 }])
  })
})

describe('walkMatches — the guard the two shipped call sites disagreed about', () => {
  it('advances past a zero-length match instead of spinning or abandoning the search', () => {
    // UNREACHABLE through matchRanges — searchPattern cannot build an empty-matching pattern — which
    // is exactly why this seam exists. `/x*/g` over 'axa' matches '' at 0, 'x' at 1, '' at 2, '' at 3.
    const ranges = walkMatches('axa', /x*/g)
    expect(ranges).toEqual([
      { start: 0, end: 0 }, { start: 1, end: 2 }, { start: 2, end: 2 }, { start: 3, end: 3 },
    ])
    // The OTHER shipped guard (`if (re.lastIndex === 0) break`) returns only the first of these, and
    // no guard at all never returns. Both are visible here; neither is visible through matchRanges.
    expect(ranges.length).toBeGreaterThan(1)
  })

  it('terminates — a missing guard is a hang, so this test bounds it itself', () => {
    // A plain `expect` cannot fail on an infinite loop; it just never returns. Bounding the input and
    // asserting the count is what turns "hangs forever" into "wrong number".
    const started = Date.now()
    const ranges = walkMatches('b'.repeat(50), /a*/g)
    expect(ranges).toHaveLength(51) // one empty match at each offset, including past the last char
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('quoteFragments — the leading-fragment ladder', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ')

  it('tries the whole quote first, then 8, 6 and 4 words', () => {
    expect(quoteFragments(words(12))).toEqual([words(12), words(8), words(6), words(4)])
  })

  it('drops every rung longer than the quote', () => {
    expect(quoteFragments(words(5))).toEqual([words(5), words(4)])
    expect(quoteFragments(words(3))).toEqual([words(3)])
    expect(quoteFragments('single')).toEqual(['single'])
  })

  it('a quote of exactly eight words is tried ONCE, not twice', () => {
    // The de-duplication is against the original ladder, so the whole-quote rung and the 8 rung
    // collapse. Without it the search runs the identical query twice.
    expect(quoteFragments(words(8))).toEqual([words(8), words(6), words(4)])
  })

  it('normalises the quote before splitting it', () => {
    // Five words, so the ladder is [5, 4] — the 4-word rung survives. Written out rather than
    // asserted as a single element: the first draft of this test claimed one fragment, which is a
    // guarantee the function does not make, and the function was right.
    expect(quoteFragments('  The   Critique\nof Pure Reason ')).toEqual([
      'the critique of pure reason',
      'the critique of pure',
    ])
  })

  it('a quote with no words yields no tries at all', () => {
    expect(quoteFragments('')).toEqual([])
    expect(quoteFragments('  \n\t ')).toEqual([])
  })
})

describe('spanHitIndices — mapping a match back onto text-layer spans', () => {
  it('reports every span a match touches, including one it only overlaps', () => {
    // 'pure reason' spans the boundary between span 1 and span 2, so BOTH must be highlighted.
    expect(spanHitIndices(['the', 'critique of pure', 'reason itself'], 'pure reason')).toEqual([1, 2])
  })

  it('reports one span when the match sits wholly inside it', () => {
    expect(spanHitIndices(['the', 'critique of pure reason', 'itself'], 'pure reason')).toEqual([1])
  })

  it('a whitespace-only query highlights nothing rather than every span', () => {
    // What this actually pins is the .trim() in normText, NOT the strictness of the overlap test:
    // without the trim, ' ' survives as a non-empty query, splits to no tokens, and joins to the
    // empty pattern — which matches at every offset and paints the whole page. Proved: removing the
    // trim fails this test.
    expect(spanHitIndices(['ab', 'cd'], ' ')).toEqual([])
    expect(spanHitIndices(['ab', 'cd'], '\n\t')).toEqual([])
  })

  it('finds every occurrence, not just the first', () => {
    expect(spanHitIndices(['kant', 'hume', 'kant'], 'kant')).toEqual([0, 2])
  })

  it('indices come back ascending and unique', () => {
    const hits = spanHitIndices(['a a', 'a', 'b', 'a'], 'a')
    expect(hits).toEqual([...new Set(hits)].sort((x, y) => x - y))
    expect(hits).toEqual([0, 1, 3])
  })

  it('an empty query highlights nothing', () => {
    expect(spanHitIndices(['some', 'spans'], '')).toEqual([])
  })

  it('no spans is not an error', () => {
    expect(spanHitIndices([], 'anything')).toEqual([])
  })
})
