// The forgiving parser, tested against what models actually do to a CSV.
//
// The house rule (CLAUDE.md): a negative that cannot fail is not a negative. So the strictness
// tests here assert a REJECTION and are paired with a variant proven to pass — a parser that
// returned [] for everything would satisfy "rejects malformed input" and be worthless.

import { describe, expect, it } from 'vitest'
import { candidateCsvBlocks, findFencedBlocks, looksLikePipeTable, parseDelimited } from './csv'

describe('findFencedBlocks', () => {
  it('finds a plain ```csv block among prose', () => {
    const reply = 'Here is your week.\n\n```csv\nday,phase\n2026-07-06,deep\n```\n\nHope that helps!'
    const b = findFencedBlocks(reply)
    expect(b).toHaveLength(1)
    expect(b[0].tag).toBe('csv')
    expect(b[0].closed).toBe(true)
    expect(b[0].text).toBe('day,phase\n2026-07-06,deep')
  })

  it('handles ~~~, uppercase tags, indentation and long fences', () => {
    expect(findFencedBlocks('~~~CSV\na,b\n~~~')[0].tag).toBe('csv')
    expect(findFencedBlocks('  ```csv\na,b\n  ```')[0].text).toBe('a,b')
    expect(findFencedBlocks('````csv\na,b\n````')[0].text).toBe('a,b')
  })

  it('marks a truncated block unclosed rather than losing it', () => {
    const b = findFencedBlocks('```csv\nday,phase\n2026-07-06,deep')
    expect(b).toHaveLength(1)
    expect(b[0].closed).toBe(false)
    expect(b[0].text).toContain('2026-07-06,deep')
  })

  it('keeps multiple blocks in order and ranks csv-tagged ones first', () => {
    const reply = '```\nnot the table\n```\n\n```csv\nday,phase\n```'
    expect(findFencedBlocks(reply)).toHaveLength(2)
    const ranked = candidateCsvBlocks(reply)
    expect(ranked[0].tag).toBe('csv')
    expect(ranked[1].text).toBe('not the table')
  })

  it('does not treat inline code as a fence', () => {
    expect(findFencedBlocks('Use the `csv` block please.')).toHaveLength(0)
  })
})

describe('parseDelimited', () => {
  it('parses the plain case', () => {
    expect(parseDelimited('day,phase\n2026-07-06,deep')).toEqual([
      ['day', 'phase'], ['2026-07-06', 'deep'],
    ])
  })

  it('handles CRLF, blank lines and padding around fields', () => {
    expect(parseDelimited('day , phase\r\n\r\n 2026-07-06 ,  deep  \r\n')).toEqual([
      ['day', 'phase'], ['2026-07-06', 'deep'],
    ])
  })

  it('keeps commas inside quoted fields', () => {
    const rows = parseDelimited('day,note\n2026-07-06,"a slower day, and that is fine"')
    expect(rows[1]).toEqual(['2026-07-06', 'a slower day, and that is fine'])
  })

  it('handles RFC-4180 doubled quotes', () => {
    const rows = parseDelimited('day,note\n2026-07-06,"you called it ""the middle bit"""')
    expect(rows[1][1]).toBe('you called it "the middle bit"')
  })

  it('handles curly quotes as field delimiters but not mid-sentence', () => {
    // A model that prose-styled its own table.
    expect(parseDelimited('day,note\n2026-07-06,“a long, warm note”')[1])
      .toEqual(['2026-07-06', 'a long, warm note'])
    // ...while a curly-quoted phrase INSIDE an ordinary field stays put.
    expect(parseDelimited('day,note\n2026-07-06,the “middle bit” again')[1])
      .toEqual(['2026-07-06', 'the “middle bit” again'])
  })

  it('handles newlines inside a quoted field', () => {
    const rows = parseDelimited('day,note\n2026-07-06,"first line\nsecond line"')
    expect(rows).toHaveLength(2)
    expect(rows[1][1]).toBe('first line\nsecond line')
  })

  it('preserves interior whitespace of a quoted field but trims an unquoted one', () => {
    expect(parseDelimited('a,b\n"  spaced  ",  bare  ')[1]).toEqual(['  spaced  ', 'bare'])
  })

  it('recovers the last row from a reply truncated mid-quote', () => {
    const rows = parseDelimited('day,note\n2026-07-06,"a note that stops')
    expect(rows[1]).toEqual(['2026-07-06', 'a note that stops'])
  })

  it('keeps prose lines as rows rather than guessing (validation decides)', () => {
    // Forgiveness about SHAPE must not become a judgement about MEANING here.
    const rows = parseDelimited('Sure, here you go:\nday,phase\n2026-07-06,deep')
    expect(rows[0]).toEqual(['Sure', ' here you go:'.trim()])
    expect(rows).toHaveLength(3)
  })
})

describe('pipe tables', () => {
  it('detects and parses a markdown table a model emitted instead of CSV', () => {
    const md = '| day | phase |\n|---|---|\n| 2026-07-06 | deep |\n| 2026-07-07 | shallow |'
    expect(looksLikePipeTable(md)).toBe(true)
    expect(parseDelimited(md)).toEqual([
      ['day', 'phase'], ['2026-07-06', 'deep'], ['2026-07-07', 'shallow'],
    ])
  })

  it('does NOT mistake real CSV containing a pipe for a pipe table', () => {
    const csv = 'day,note\n2026-07-06,"a | b"'
    expect(looksLikePipeTable(csv)).toBe(false)
    expect(parseDelimited(csv)[1][1]).toBe('a | b')
  })
})
