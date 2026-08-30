// THE CAPTURE PANEL'S FIELD HELPERS — CHARACTERIZATION FIRST, THEN THE MOVE.
//
// These five functions decide what the capture-verification panel offers as a HOVER TARGET: given
// a field the extractor produced ("2017-08-28", "Tyler Graham and Katie Collins"), which strings
// are worth searching the live page for. They shipped inside `extension-src/entrypoints/
// content-source.ts`, which `pnpm test` cannot reach at all — `vite.config.ts` includes only
// `src/**`, so 1,153 lines running with `<all_urls>` in the writer's browser had no gate over them.
//
// ⚠ WRITTEN AGAINST THE ORIGINAL, NOT THE COPY. Per CLAUDE.md's characterization rule, every
// assertion below was first run against a byte-exact extraction of the shipped functions and only
// then re-pointed at this module. Three of them CONTRADICTED me and they are marked ⚠ where they
// sit — a test written after the move would have agreed with my rewrite by construction and frozen
// the misunderstanding as the spec.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normNode, normText, authorCandidates, relativeDateCandidates, dateSearchCandidates, escAttr,
} from './sourceFields'

afterEach(() => { vi.useRealTimers() })

describe('normNode — the per-node normaliser', () => {
  it('does NOT trim, and the missing trim is the whole point', () => {
    // A name split across two inline elements contributes "Tyler " and "Graham". Trimming here
    // would weld them into "TylerGraham" in the flattened page string and the byline would never
    // be found. The comment in the original says exactly this; it is load-bearing, not tidiness.
    expect(normNode('Tyler ')).toBe('tyler ')
    expect(normNode('  spaced  ')).toBe(' spaced ')
  })

  it('lowercases, and folds en/em dashes and soft hyphens', () => {
    expect(normNode('pre–post')).toBe('pre-post')
    expect(normNode('em—dash')).toBe('em-dash')
    expect(normNode('soft­hyphen')).toBe('softhyphen')
    expect(normNode('MiXeD')).toBe('mixed')
  })

  it('folds the three non-breaking spaces the original names', () => {
    expect(normNode('a b')).toBe('a b')   // NBSP
    expect(normNode('a b')).toBe('a b')   // narrow NBSP
    expect(normNode('a b')).toBe('a b')   // thin space
  })

  it('collapses every run of whitespace to one space', () => {
    expect(normNode('a \t\n  b')).toBe('a b')
    expect(normNode('nb sp')).toBe('nb sp')
  })

  it('applies NFC, so a decomposed accent matches its composed form', () => {
    expect(normNode('école')).toBe(normNode('école'))
  })

  it('folds curly apostrophes and quotes — a page says O’Brien, the extractor says O\'Brien', () => {
    // THE DEFECT THIS REPLACES: both classes had been straightened to their ASCII form, so
    // /['']/ was '->' and /[""]/ was "->" — two no-ops that silently cost hover-to-verify a target
    // on most published prose. Pinned as broken for one commit so the move was provably inert.
    expect(normNode('O’Brien')).toBe("o'brien")
    expect(normNode('‛Odd’')).toBe("'odd'")
    expect(normNode('“Quoted”')).toBe('"quoted"')
    expect(normNode('‟Odd”')).toBe('"odd"')
  })

  it('KEEPER: no folding class holds a LITERAL non-ASCII character', () => {
    // This is the actual fix. Correcting the two broken classes leaves the mechanism that broke
    // them — a literal curly character in source, which any smart-quote-straightening tool silently
    // converts back to ASCII, turning a fold into a no-op with no error and no visible diff in most
    // editors. `\uXXXX` escapes cannot be straightened. The space, dash and soft-hyphen classes
    // were still literals and still WORKED; they are escaped too, because they are one careless
    // paste from the same fate and the behaviour is proved unchanged by the tests above.
    const body = readFileSync(join(process.cwd(), 'src/reader/sourceFields.ts'), 'utf8')
      .match(/export function normNode[\s\S]*?\n\}/)?.[0] ?? ''
    expect(body, 'normNode not found — re-aim this guard').not.toBe('')
    const literals = [...body].filter(c => c.codePointAt(0)! > 126)
      .map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase())
    expect(literals, `literal non-ASCII in normNode: ${literals.join(' ')}`).toEqual([])
  })

  it('normText is normNode plus a trim', () => {
    expect(normText('  Tyler  Graham  ')).toBe('tyler graham')
  })
})

describe('authorCandidates — whole value first, then each author', () => {
  it('offers the whole value first so a contiguous byline still wins', () => {
    // Order is the contract: the caller takes the FIRST candidate present on the page, and a page
    // that really does render "Tyler Graham and Katie Collins" contiguously should snap to that
    // rather than to the first author alone.
    expect(authorCandidates('Tyler Graham and Katie Collins'))
      .toEqual(['Tyler Graham and Katie Collins', 'Tyler Graham', 'Katie Collins'])
  })

  it('splits on comma, semicolon and ampersand as well as "and"', () => {
    expect(authorCandidates('Ann Lee, Bob Ray')).toEqual(['Ann Lee, Bob Ray', 'Ann Lee', 'Bob Ray'])
    expect(authorCandidates('Ann Lee; Bob Ray')).toEqual(['Ann Lee; Bob Ray', 'Ann Lee', 'Bob Ray'])
    expect(authorCandidates('Ann Lee & Bob Ray')).toEqual(['Ann Lee & Bob Ray', 'Ann Lee', 'Bob Ray'])
  })

  it('a single author is offered alone, never wrapped in a second copy', () => {
    expect(authorCandidates('Tyler Graham')).toEqual(['Tyler Graham'])
  })

  it('the word boundary keeps "and" INSIDE a name from splitting it', () => {
    // \band\b — "Alexander" and "Sandra" both contain the letters and must survive whole.
    expect(authorCandidates('Alexander Sandry')).toEqual(['Alexander Sandry'])
  })

  it('⚠ SHORT PARTS ARE DROPPED, AND DROPPING ENOUGH OF THEM COLLAPSES THE SPLIT ENTIRELY', () => {
    // This contradicted my reading and it is worth stating plainly, because it looks like a bug and
    // is defensible: the `>= 3` filter runs BEFORE the `parts.length > 1` test, so two initials-only
    // authors leave zero parts and the function falls back to the whole value. That is the right
    // fallback — a 2-character needle would match half the page — but it means the filter can
    // silently turn a multi-author value into a single candidate.
    expect(authorCandidates('Wu, Li')).toEqual(['Wu, Li'])
    // ⚠ AND MY FIRST ASSERTION HERE WAS WRONG — I expected the surviving long part to be offered
    // beside the whole value. It is not: `parts.length > 1` is tested on the FILTERED array, so
    // dropping one of two authors leaves one part, which fails the test, and the whole value is
    // returned alone. The code is defensible (a lone part is not obviously better than the whole
    // value) and it is NOT what the shape of the function suggests.
    expect(authorCandidates('Katie Collins, Wu')).toEqual(['Katie Collins, Wu'])
  })
})

describe('dateSearchCandidates — the renderings a page might actually show', () => {
  it('offers the ISO form first, then six human renderings', () => {
    expect(dateSearchCandidates('2017-08-28')).toEqual([
      '2017-08-28',
      'August 28, 2017',
      'Aug 28, 2017',
      '28 August 2017',
      '28 Aug 2017',
      'August 28',
      '2017',
    ])
  })

  it('drops the leading zero in the day-first forms but keeps it in the ISO original', () => {
    const out = dateSearchCandidates('2017-08-05')
    expect(out[0]).toBe('2017-08-05')
    expect(out).toContain('5 August 2017')
    expect(out).not.toContain('05 August 2017')
  })

  it('a value that is not a bare ISO date is passed through untouched', () => {
    // Including an ISO date with a time on it: the regex is anchored at both ends.
    expect(dateSearchCandidates('c. 1801')).toEqual(['c. 1801'])
    expect(dateSearchCandidates('2017-08-28T10:00:00Z')).toEqual(['2017-08-28T10:00:00Z'])
    expect(dateSearchCandidates('')).toEqual([''])
  })

  it('the year alone is offered LAST, so a more specific rendering always wins', () => {
    // "2017" occurs all over a page (copyright footers, other articles). It is a last resort, and
    // its position in the list is what keeps it one.
    const out = dateSearchCandidates('2017-08-28')
    expect(out[out.length - 1]).toBe('2017')
  })
})

describe('relativeDateCandidates — YouTube shows "13 days ago", not the date', () => {
  // The original reads the wall clock, so every case here pins a fixed one.
  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  it('⚠ "today" NEEDS THE CLOCK TO BE NEAR MIDNIGHT — this is rounding, not a bug', () => {
    // `then` is LOCAL MIDNIGHT of the ISO date and `now` is the actual instant, and the difference
    // is ROUNDED. So at 14:00 on the day of upload the gap is 0.583 days, which rounds to 1 and the
    // function answers "yesterday". I expected 'today' and was wrong. It is the documented ±1
    // tolerance doing its job: YouTube's own relative string is computed from a TIMESTAMP while we
    // only have a DATE, so being one unit out is expected and both forms get offered.
    at('2026-08-30T02:00:00')
    expect(relativeDateCandidates('2026-08-30')).toEqual(['today'])
    at('2026-08-30T14:00:00')
    expect(relativeDateCandidates('2026-08-30')).toEqual(['yesterday', '1 day ago'])
  })

  it('yesterday offers both spellings a page might use', () => {
    at('2026-08-31T02:00:00')
    expect(relativeDateCandidates('2026-08-30')).toEqual(['yesterday', '1 day ago'])
  })

  it('under a fortnight the primary form is days, and it is the ONLY form', () => {
    at('2026-08-30T02:00:00')
    // 13 days: weeks rounds to 2 and months/years to 0, so only the day form survives the >= 1
    // guards — and the trailing `ago(days,'day')` is deduped away by the Set.
    expect(relativeDateCandidates('2026-08-17')).toEqual(['13 days ago', '2 weeks ago'])
  })

  it('past a fortnight the WEEK form leads and the day form falls to last', () => {
    at('2026-08-30T02:00:00')
    // 21 days. The ordering is the contract: a comment's day-stamp must never outrank the video's
    // own metadata, so the coarse form the player actually renders comes first.
    const out = relativeDateCandidates('2026-08-09')
    expect(out[0]).toBe('3 weeks ago')
    expect(out[out.length - 1]).toBe('21 days ago')
  })

  it('past two months the MONTH form leads', () => {
    at('2026-08-30T02:00:00')
    const out = relativeDateCandidates('2026-06-01')  // 90 days
    expect(out[0]).toBe('3 months ago')
    expect(out).toContain('13 weeks ago')
    expect(out[out.length - 1]).toBe('90 days ago')
  })

  it('past a year the YEAR form leads, and singular/plural are spelled correctly', () => {
    at('2026-08-30T02:00:00')
    const out = relativeDateCandidates('2025-08-30')  // 365 days
    expect(out[0]).toBe('1 year ago')
    expect(out).not.toContain('1 years ago')
  })

  it('a FUTURE date yields nothing rather than a negative count', () => {
    at('2026-08-30T02:00:00')
    expect(relativeDateCandidates('2027-01-01')).toEqual([])
  })

  it('a non-ISO value yields nothing — this list is only ever derived, never guessed', () => {
    at('2026-08-30T02:00:00')
    expect(relativeDateCandidates('c. 1801')).toEqual([])
    expect(relativeDateCandidates('')).toEqual([])
  })

  it('⚠ IT ACCEPTS A PREFIX, NOT AN EXACT ISO DATE — unlike dateSearchCandidates', () => {
    // The two regexes differ: this one is anchored only at the START (`^`), so a datetime is
    // accepted and its time-of-day silently ignored. Its sibling is anchored at both ends and
    // passes the same string straight through. Neither is wrong for its own job; they are simply
    // not the same predicate, and a caller that assumes one rule for both would be surprised.
    at('2026-08-30T02:00:00')
    expect(relativeDateCandidates('2026-08-29T23:59:00Z')).toEqual(['yesterday', '1 day ago'])
    expect(dateSearchCandidates('2026-08-29T23:59:00Z')).toEqual(['2026-08-29T23:59:00Z'])
  })
})

describe('escAttr — and the precondition that makes it sufficient', () => {
  it('escapes the four characters that can break out of a double-quoted attribute', () => {
    expect(escAttr('a & b')).toBe('a &amp; b')
    expect(escAttr('<script>')).toBe('&lt;script&gt;')
    expect(escAttr('say "hi"')).toBe('say &quot;hi&quot;')
  })

  it('escapes the ampersand FIRST, so an escape is never double-escaped', () => {
    // Order matters: `<` → `&lt;` after `&` → `&amp;` would otherwise yield `&amp;lt;`.
    expect(escAttr('&<')).toBe('&amp;&lt;')
  })

  it('⚠ IT DOES NOT ESCAPE THE APOSTROPHE, WHICH IS SAFE ONLY BECAUSE OF THE RULE BELOW', () => {
    expect(escAttr("it's")).toBe("it's")
  })

  it('KEEPER: every attribute interpolating it in the panel is DOUBLE-quoted', () => {
    // The values passed through here are page-controlled — an extractor reads them off whatever
    // site the writer is citing — and they are interpolated into `innerHTML` inside a content
    // script running at `<all_urls>`. A single-quoted attribute would let `'` close it and add an
    // event handler. The escape is not going to grow an apostrophe case (that would change the
    // rendered text of every legitimate value), so the DOUBLE QUOTE is the actual invariant, and
    // this is what watches it.
    //
    // Judge what the code DOES, never prose about it: comments are stripped first, because the
    // paragraph above necessarily contains a single-quoted example in order to forbid it.
    const src = readFileSync(
      join(process.cwd(), 'extension-src/entrypoints/content-source.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    // ATTR='${esc(...)}'  — an attribute opened with a single quote whose value is interpolated.
    const singleQuoted = src.match(/[a-zA-Z-]+='\$\{[^}]*escAttr\(/g) ?? []
    expect(singleQuoted, `single-quoted attribute(s) interpolating esc(): ${singleQuoted.join(', ')}`)
      .toEqual([])

    // VOID GUARD: the sweep must be looking at the real panel. If the double-quoted form has gone,
    // the file moved or was rewritten and a clean result above means nothing.
    const doubleQuoted = src.match(/[a-zA-Z-]+="\$\{[^}]*escAttr\(/g) ?? []
    expect(doubleQuoted.length, 'sweep found no esc()-interpolated attributes at all').toBeGreaterThan(4)
  })
})
