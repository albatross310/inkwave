import { describe, it, expect } from 'vitest'
import { detectIdentifier, normalizeIsbn, isUrl } from './identifiers'

describe('detectIdentifier', () => {
  it('detects a bare DOI', () => {
    expect(detectIdentifier('10.1038/nphys1170')).toEqual({ kind: 'doi', value: '10.1038/nphys1170' })
  })
  it('detects a DOI inside a doi.org URL and trims trailing punctuation', () => {
    expect(detectIdentifier('see https://doi.org/10.1038/nphys1170.')).toEqual({ kind: 'doi', value: '10.1038/nphys1170' })
  })
  it('detects a DOI inside prose with brackets', () => {
    expect(detectIdentifier('(doi:10.1103/PhysRevLett.116.061102)')).toEqual({ kind: 'doi', value: '10.1103/PhysRevLett.116.061102' })
  })
  it('detects a new-scheme arXiv id from an abs URL', () => {
    expect(detectIdentifier('https://arxiv.org/abs/2401.12345')).toEqual({ kind: 'arxiv', value: '2401.12345' })
  })
  it('detects a standalone new-scheme arXiv id with version', () => {
    expect(detectIdentifier('2401.12345v2')).toEqual({ kind: 'arxiv', value: '2401.12345v2' })
  })
  it('detects a legacy arXiv id with context', () => {
    expect(detectIdentifier('arXiv:hep-th/0603057')).toEqual({ kind: 'arxiv', value: 'hep-th/0603057' })
  })
  it('detects a PMID', () => {
    expect(detectIdentifier('PMID: 29939664')).toEqual({ kind: 'pmid', value: '29939664' })
  })
  it('detects a PMID from a pubmed URL', () => {
    expect(detectIdentifier('https://pubmed.ncbi.nlm.nih.gov/29939664/')).toEqual({ kind: 'pmid', value: '29939664' })
  })
  it('detects a valid ISBN-13 with label', () => {
    expect(detectIdentifier('ISBN: 978-0-262-03384-8')).toEqual({ kind: 'isbn', value: '9780262033848' })
  })
  it('detects a valid ISBN-10', () => {
    expect(detectIdentifier('0262033844')).toEqual({ kind: 'isbn', value: '0262033844' })
  })
  it('prefers a DOI over other identifiers when both present', () => {
    expect(detectIdentifier('10.1000/xyz and PMID: 12345678')?.kind).toBe('doi')
  })
  it('returns null for plain prose', () => {
    expect(detectIdentifier('the quick brown fox')).toBeNull()
  })
})

describe('normalizeIsbn', () => {
  it('validates a correct ISBN-13 checksum', () => {
    expect(normalizeIsbn('978-0-262-03384-8')).toBe('9780262033848')
  })
  it('rejects a bad ISBN-13 checksum', () => {
    expect(normalizeIsbn('978-0-262-03384-9')).toBeNull()
  })
  it('validates an ISBN-10 with X check digit', () => {
    expect(normalizeIsbn('0-8044-2957-X')).toBe('080442957X')
  })
})

describe('isUrl', () => {
  it('recognises http(s) URLs', () => {
    expect(isUrl('https://example.com/post')).toBe(true)
    expect(isUrl('http://x.io')).toBe(true)
  })
  it('rejects non-URLs', () => {
    expect(isUrl('10.1038/nphys1170')).toBe(false)
    expect(isUrl('hello world')).toBe(false)
  })
})
