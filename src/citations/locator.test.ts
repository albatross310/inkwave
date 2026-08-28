import { describe, it, expect } from 'vitest'
import { formatLocator, isSelfLabelled, isPlural, mergesWithPdfPages, asLocatorKind, LOCATOR_KINDS } from './locator'

describe('formatLocator', () => {
  it('keeps the page behaviour byte-identical to the rule it replaces', () => {
    // The old inline rule: a comma or a dash ⇒ "pp.", else "p.". Every existing citation must read
    // exactly as it did before — this is what makes the change display-only in practice as well as
    // in principle.
    expect(formatLocator('5')).toBe('p. 5')
    expect(formatLocator('3–7')).toBe('pp. 3–7')
    expect(formatLocator('2, 4–6')).toBe('pp. 2, 4–6')
    expect(formatLocator('')).toBe('')
    expect(formatLocator(null)).toBe('')
  })

  it('cites a section or a paragraph, which is the whole point', () => {
    expect(formatLocator('2.1', 'section')).toBe('§2.1')
    expect(formatLocator('2.1, 3', 'section')).toBe('§§2.1, 3')
    expect(formatLocator('4', 'paragraph')).toBe('¶4')
    expect(formatLocator('2', 'chapter')).toBe('ch. 2')
    expect(formatLocator('2–3', 'chapter')).toBe('chs. 2–3')
    expect(formatLocator('15', 'line')).toBe('l. 15')
    expect(formatLocator('3', 'note')).toBe('n. 3')
  })

  it('WRITING IT OUT: a value that labels itself is never re-prefixed', () => {
    // Peter asked for both input paths. This is the one that needs no interaction: type what you
    // mean and it is left alone, whatever the picker happens to say.
    expect(formatLocator('§2.1')).toBe('§2.1')
    expect(formatLocator('¶4')).toBe('¶4')
    expect(formatLocator('ch. 2')).toBe('ch. 2')
    expect(formatLocator('sec. 3', 'page')).toBe('sec. 3')
    expect(formatLocator('p. 5', 'page')).toBe('p. 5')       // never "p. p. 5"
    expect(formatLocator('chapter 2', 'page')).toBe('chapter 2')
  })

  it('only the FIRST token counts as a self-label', () => {
    // "the argument of chapter 2" is prose the writer put in `prefix`; it must still take a page
    // label rather than being silently passed through.
    expect(isSelfLabelled('the argument of chapter 2')).toBe(false)
    expect(formatLocator('12 and see chapter 4')).toBe('p. 12 and see chapter 4')
  })

  it('KNOWN-NEGATIVE: a bare number is NOT self-labelled, so the prefixes really do apply', () => {
    // If this were true, every assertion above would pass by passing the value straight through.
    expect(isSelfLabelled('5')).toBe(false)
    expect(isSelfLabelled('2.1')).toBe(false)
    expect(isSelfLabelled('2, 4–6')).toBe(false)
  })

  it('verbatim leaves anything alone', () => {
    expect(formatLocator('the appendix', 'verbatim')).toBe('the appendix')
  })
})

describe('plurality', () => {
  it('reads ranges and lists', () => {
    expect(isPlural('3–7')).toBe(true)
    expect(isPlural('3-7')).toBe(true)
    expect(isPlural('2, 4')).toBe(true)
    expect(isPlural('5')).toBe(false)
    expect(isPlural('2.1')).toBe(false)   // a decimal section number is ONE section
  })
})

describe('pdf page merging', () => {
  it('only pages merge with highlight-derived pages', () => {
    // A section number and a page number are different quantities; unioning them prints "§2.1, 7".
    expect(mergesWithPdfPages('page')).toBe(true)
    for (const k of LOCATOR_KINDS.filter((k) => k.kind !== 'page')) {
      expect(mergesWithPdfPages(k.kind)).toBe(false)
    }
  })
})

describe('asLocatorKind', () => {
  it('falls back to page for anything unrecognised — including legacy null', () => {
    expect(asLocatorKind(null)).toBe('page')
    expect(asLocatorKind(undefined)).toBe('page')
    expect(asLocatorKind('nonsense')).toBe('page')
    expect(asLocatorKind('section')).toBe('section')
  })
})
