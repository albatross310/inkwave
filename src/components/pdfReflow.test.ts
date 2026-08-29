import { describe, it, expect } from 'vitest'
import {
  buildPageReflow, anchorInPage, rectsForRange, nearestBlock, blockBox, noteAnchorText,
  type PlacedItem, type PageReflow,
} from './pdfReflow'
import { locateMark, type ReaderMark } from '../reader/marks'

// ── a synthetic page ─────────────────────────────────────────────────────────────────────────────
// Real PDFs are not in the repo (and Peter's sources never are), so the fixture is generated the way
// the music module's is: the builder KNOWS where it put every word, which is the only way to have a
// ground truth to score against. It emits one item per word, at a whole-page geometry, exactly as
// pdf.js reports them — separate items with no space characters between, the arrangement that makes
// naive extraction produce "wordsrunningtogether".

const CHAR = 6      // px per character at the body size
const SIZE = 12     // glyph height
const PITCH = 16    // baseline-to-baseline within a paragraph
const LEFT = 60
const PAGE_W = 600, PAGE_H = 800

type LineSpec = { words: string[]; x?: number; y: number; size?: number }

function lineItems({ words, x = LEFT, y, size = SIZE }: LineSpec): PlacedItem[] {
  const out: PlacedItem[] = []
  let cx = x
  for (const w of words) {
    const width = w.length * (CHAR * size / SIZE)
    out.push({ str: w, x: cx, y, w: width, h: size })
    cx += width + size * 0.3 // a real word gap the PDF draws by moving, not by a space glyph
  }
  return out
}

function page(specs: LineSpec[]): PageReflow {
  return buildPageReflow(specs.flatMap(lineItems), PAGE_W, PAGE_H)
}

/** Lines whose right edges land within a word of each other — ordinary ragged-right body text. */
function para(y0: number, lines: string[][], x = LEFT): LineSpec[] {
  return lines.map((words, i) => ({ words, x, y: y0 + i * PITCH }))
}

describe('buildPageReflow — lines', () => {
  it('joins items on one printed line into one line of text, inserting the spaces the PDF only drew', () => {
    const r = page(para(100, [['The', 'question', 'of', 'relative', 'identity']]))
    expect(r.blocks).toHaveLength(1)
    expect(r.blocks[0].text).toBe('The question of relative identity')
  })

  it('a superscript on the line does not start a new line (overlap, not equal tops)', () => {
    const items = [
      ...lineItems({ words: ['Frege', 'says'], y: 100 }),
      { str: '12', x: 160, y: 97, w: 7, h: 7 },       // footnote marker, raised and smaller
      ...lineItems({ words: ['so.'], x: 175, y: 100 }),
    ]
    const r = buildPageReflow(items, PAGE_W, PAGE_H)
    expect(r.blocks).toHaveLength(1)
    expect(r.blocks[0].text).toBe('Frege says 12 so.')
  })

  it('IS A FUNCTION OF ITS INPUT — shuffling the item order cannot change the text', () => {
    // The first cut sorted with an overlap-based comparator, which is not transitive, so Array.sort
    // was free to return different orders for the same page.
    const specs = para(100, [
      ['A', 'first', 'line', 'of', 'ordinary', 'prose', 'here'],
      ['and', 'a', 'second', 'line', 'that', 'runs', 'along'],
    ])
    const straight = specs.flatMap(lineItems)
    const shuffled = [...straight].reverse()
    expect(buildPageReflow(shuffled, PAGE_W, PAGE_H).blocks.map(b => b.text))
      .toEqual(buildPageReflow(straight, PAGE_W, PAGE_H).blocks.map(b => b.text))
  })
})

describe('buildPageReflow — paragraphs', () => {
  const P1 = [
    ['Identity', 'is', 'said', 'to', 'be', 'relative', 'when', 'a', 'thing'],
    ['may', 'be', 'the', 'same', 'F', 'as', 'another', 'without', 'being'],
    ['the', 'same', 'G', 'as', 'it', 'is', 'and', 'that', 'is', 'odd.'],
  ]
  const P2 = [
    ['Geach', 'defended', 'the', 'thesis', 'over', 'many', 'years', 'and'],
    ['his', 'critics', 'have', 'never', 'quite', 'settled', 'with', 'it.'],
  ]

  it('splits on a blank-line gap', () => {
    const r = page([...para(100, P1), ...para(100 + 3 * PITCH + PITCH, P2)])
    expect(r.blocks).toHaveLength(2)
    expect(r.blocks[0].text.startsWith('Identity is said')).toBe(true)
    expect(r.blocks[1].text.startsWith('Geach defended')).toBe(true)
  })

  it('splits on a first-line INDENT with no extra leading at all', () => {
    const r = page([
      ...para(100, P1),
      ...para(100 + 3 * PITCH, P2, LEFT).map((s, i) => (i === 0 ? { ...s, x: LEFT + 20 } : s)),
    ])
    expect(r.blocks).toHaveLength(2)
    expect(r.blocks[1].text.startsWith('Geach defended')).toBe(true)
  })

  it('KNOWN-NEGATIVE: ordinary ragged-right lines must NOT each become their own paragraph', () => {
    // A short-line rule tuned to catch every paragraph's last line shatters ragged prose into one
    // block per line — which reads fine but destroys paragraph anchoring. Lines here end up to a
    // whole word short of each other, as real unjustified text does.
    const ragged = page(para(100, [
      ['Identity', 'is', 'said', 'to', 'be', 'relative', 'when'],
      ['a', 'thing', 'may', 'be', 'the', 'same', 'F', 'as'],
      ['another', 'without', 'being', 'the', 'same', 'G.'],
    ]))
    expect(ragged.blocks).toHaveLength(1)
  })

  it('DE-HYPHENATES a word the typesetter split across lines', () => {
    const r = page([
      { words: ['the', 'question', 'of', 'iden-'], y: 100 },
      { words: ['tity', 'over', 'time', 'is', 'hard'], y: 100 + PITCH },
    ])
    expect(r.blocks[0].text).toContain('identity over time')
    expect(r.blocks[0].text).not.toContain('iden- tity')
  })

  it('a hyphen before a CAPITAL is a real hyphen, not a line break', () => {
    const r = page([
      { words: ['the', 'Anglo-'], y: 100 },
      { words: ['Saxon', 'view', 'of', 'it'], y: 100 + PITCH },
    ])
    expect(r.blocks[0].text).toContain('Anglo- Saxon')
  })

  it('a larger first line is flagged as a heading', () => {
    const r = page([
      { words: ['Relative', 'Identity'], y: 60, size: 20 },
      ...para(100, [['Identity', 'is', 'said', 'to', 'be', 'relative', 'when', 'a', 'thing', 'may']]),
    ])
    expect(r.blocks[0].heading).toBe(true)
    expect(r.blocks[1].heading).toBe(false)
  })
})

// ── the anchoring, which is the point of the whole file ──────────────────────────────────────────

describe('anchorInPage', () => {
  const r = page([
    ...para(100, [
      ['Identity', 'is', 'said', 'to', 'be', 'relative', 'when', 'a', 'thing', 'may'],
      ['be', 'the', 'same', 'F', 'as', 'another', 'without', 'being', 'the', 'same'],
    ]),
    ...para(160, [['Geach', 'defended', 'the', 'thesis', 'for', 'many', 'years', 'of', 'his', 'life']]),
  ])

  it('finds a phrase and returns a LITERAL SLICE of the block', () => {
    const a = anchorInPage(r.blocks, 'said to be relative')
    expect(a).not.toBeNull()
    expect(a!.text).toBe('said to be relative')
    expect(r.blocks[a!.block].text.slice(a!.start, a!.start + a!.text.length)).toBe(a!.text)
  })

  it('finds it across a LINE BREAK, where the selection carries the page’s whitespace', () => {
    // What a real PDF selection hands you: a newline where the reflow has a single space.
    const a = anchorInPage(r.blocks, 'a thing may\nbe the same F')
    expect(a).not.toBeNull()
    expect(a!.text).toBe('a thing may be the same F')
  })

  it('finds it across a HYPHENATED break the reflow already healed', () => {
    const h = page([
      { words: ['the', 'question', 'of', 'iden-'], y: 100 },
      { words: ['tity', 'over', 'time'], y: 100 + PITCH },
    ])
    const a = anchorInPage(h.blocks, 'iden-\ntity over')
    expect(a).not.toBeNull()
    expect(h.blocks[a!.block].text.slice(a!.start, a!.start + a!.text.length)).toBe(a!.text)
    expect(a!.text).toContain('identity over')
  })

  it('THE REFUSAL: a phrase that is not on this page gets NO anchor, not a plausible one', () => {
    // The mark is still created and still drawn by the page view — it simply carries no text
    // anchor, and the reader view then says it could not place it. An offset invented here would
    // colour words the reader never marked, with nothing to tell them so.
    expect(anchorInPage(r.blocks, 'a sentence from a completely different source')).toBeNull()
  })

  it('resolves a repeated phrase to the copy NEAREST the hint block', () => {
    const dup = page([
      ...para(100, [['the', 'same', 'thing', 'again', 'and', 'again', 'in', 'this', 'first', 'part']]),
      ...para(160, [['a', 'middle', 'paragraph', 'that', 'sits', 'between', 'the', 'two', 'of', 'them']]),
      ...para(220, [['the', 'same', 'thing', 'again', 'but', 'now', 'down', 'here', 'at', 'bottom']]),
    ])
    expect(anchorInPage(dup.blocks, 'the same thing again', 2)!.block).toBe(2)
    expect(anchorInPage(dup.blocks, 'the same thing again', 0)!.block).toBe(0)
  })

  it('refuses a needle too short to identify anything', () => {
    expect(anchorInPage(r.blocks, 'a')).toBeNull()
    expect(anchorInPage(r.blocks, '   ')).toBeNull()
  })
})

describe('the anchor is one the reader-mark model can actually re-find', () => {
  // THE INTEROP THAT MATTERS. `locateMark` (src/reader/marks.ts) re-finds a mark with a plain
  // indexOf over the block text. If anchorInPage stored the CALLER'S string — the one carrying the
  // page's newline — locateMark would return null and every cross-line highlight would show up as
  // "could not be placed". This test is what makes the normalisation load-bearing rather than
  // decorative.
  const r = page(para(100, [
    ['Identity', 'is', 'said', 'to', 'be', 'relative', 'when', 'a', 'thing', 'may'],
    ['be', 'the', 'same', 'F', 'as', 'another', 'without', 'being', 'the', 'same'],
  ]))
  const texts = r.blocks.map(b => b.text)
  const selection = 'a thing may\nbe the same F'

  it('round-trips: anchorInPage → locateMark finds it at the same offsets', () => {
    const a = anchorInPage(r.blocks, selection)!
    const mark: ReaderMark = { id: 'm', kind: 'highlight', color: '#ffe066', block: a.block, start: a.start, text: a.text, createdAt: '' }
    const found = locateMark(mark, texts)
    expect(found).not.toBeNull()
    expect(found!.start).toBe(a.start)
    expect(texts[found!.block].slice(found!.start, found!.end)).toBe(a.text)
  })

  it('KNOWN-NEGATIVE: storing the raw selection instead is exactly what locateMark refuses', () => {
    const naive: ReaderMark = { id: 'm', kind: 'highlight', color: '#ffe066', block: 0, start: 0, text: selection, createdAt: '' }
    expect(locateMark(naive, texts)).toBeNull()
  })
})

// ── the other direction: text range → page rectangles ────────────────────────────────────────────

describe('rectsForRange', () => {
  const r = page(para(100, [
    ['Identity', 'is', 'said', 'to', 'be', 'relative', 'when', 'a', 'thing', 'may'],
    ['be', 'the', 'same', 'F', 'as', 'another', 'without', 'being', 'the', 'same'],
  ]))
  const text = r.blocks[0].text

  it('one printed line yields ONE rect, not one per word', () => {
    const at = text.indexOf('is said to be')
    const rects = rectsForRange(r, 0, at, at + 'is said to be'.length)
    expect(rects).toHaveLength(1)
  })

  it('a range spanning two printed lines yields one rect per line', () => {
    const at = text.indexOf('a thing may')
    const rects = rectsForRange(r, 0, at, text.indexOf('same F') + 6)
    expect(rects).toHaveLength(2)
    expect(rects[0].y).toBeLessThan(rects[1].y)
  })

  it('rects are NORMALISED to the page box and sit where the words are', () => {
    const at = text.indexOf('relative')
    const [rect] = rectsForRange(r, 0, at, at + 'relative'.length)
    expect(rect.x).toBeGreaterThan(0); expect(rect.x).toBeLessThan(1)
    expect(rect.y).toBeGreaterThan(0); expect(rect.y).toBeLessThan(1)
    // The word starts to the right of the page's left margin and is narrower than the whole line.
    expect(rect.x * PAGE_W).toBeGreaterThan(LEFT)
    expect(rect.w * PAGE_W).toBeLessThan(120)
  })

  it('a range covering nothing real produces no rects (never a zero-size ghost)', () => {
    expect(rectsForRange(r, 0, 5, 5)).toEqual([])
    expect(rectsForRange(r, 99, 0, 4)).toEqual([])
  })

  it('KNOWN-NEGATIVE: the rect tracks the OFFSET — a different range is a different rect', () => {
    // Guards against the obvious wrong implementation (return the whole block's box), which would
    // pass every "there is a rect" assertion while highlighting the entire paragraph.
    const a = rectsForRange(r, 0, 0, 8)                                    // "Identity"
    const b = rectsForRange(r, 0, text.indexOf('relative'), text.indexOf('relative') + 8)
    expect(a[0].x).toBeLessThan(b[0].x)
    expect(blockBox(r, 0)!.w).toBeGreaterThan(a[0].w * 2)
  })
})

describe('nearestBlock — where a text box anchors', () => {
  const r = page([
    ...para(100, [['The', 'first', 'paragraph', 'sits', 'up', 'here', 'near', 'the', 'top', 'edge']]),
    ...para(300, [['The', 'second', 'paragraph', 'sits', 'lower', 'down', 'the', 'page', 'than', 'that']]),
  ])

  it('a note dropped in the RIGHT MARGIN belongs to the paragraph beside it', () => {
    const b2 = blockBox(r, 1)!
    expect(nearestBlock(r, 0.93, b2.y + b2.h / 2)).toBe(1)
  })

  it('a note dropped on a paragraph belongs to that paragraph', () => {
    const b1 = blockBox(r, 0)!
    expect(nearestBlock(r, b1.x + 0.05, b1.y + b1.h / 2)).toBe(0)
  })

  it('a page with no text has no block to anchor to, and says so', () => {
    expect(nearestBlock(buildPageReflow([], PAGE_W, PAGE_H), 0.5, 0.5)).toBeNull()
  })
})

describe('noteAnchorText', () => {
  it('takes the head of the paragraph, whitespace collapsed', () => {
    expect(noteAnchorText('  Identity   is\nsaid to be relative  ')).toBe('Identity is said to be relative')
  })
  it('caps its length so a note is not anchored to a whole page of prose', () => {
    expect(noteAnchorText('x'.repeat(500)).length).toBe(60)
  })
})
