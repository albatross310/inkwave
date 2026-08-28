import { describe, it, expect } from 'vitest'
import { locatorForHeading } from './types'

describe('locatorForHeading', () => {
  it('takes the NUMBER out of a numbered heading — that is what a reader can look up', () => {
    // Real SEP headings, verbatim from plato.stanford.edu/entries/identity/.
    expect(locatorForHeading('2. The Logic of Identity')).toEqual({ kind: 'section', value: '2' })
    expect(locatorForHeading('4.1 Criteria of identity')).toEqual({ kind: 'section', value: '4.1' })
    expect(locatorForHeading('§3 Relative Identity')).toEqual({ kind: 'section', value: '3' })
    expect(locatorForHeading('Chapter 4 — Persons')).toEqual({ kind: 'chapter', value: '4' })
  })

  it('an UNNUMBERED heading travels as its title, never as an invented number', () => {
    // Numbering it by position would put a number in the citation that is not in the source — the
    // same fabrication the music lane refused when it would not mint a bar index from a bar label.
    expect(locatorForHeading('Bibliography')).toEqual({ kind: 'verbatim', value: 'Bibliography' })
    expect(locatorForHeading('Identity')).toEqual({ kind: 'verbatim', value: 'Identity' })
  })

  it('a bare number with no title is not a section heading', () => {
    // "1958" is a year in a heading, not "§1958". The pattern requires a number FOLLOWED by words.
    expect(locatorForHeading('1958').kind).toBe('verbatim')
  })

  it('collapses whitespace, which real HTML headings are full of', () => {
    expect(locatorForHeading('\n  2.1   Relative  Identity \n')).toEqual({ kind: 'section', value: '2.1' })
  })
})
