import { describe, it, expect } from 'vitest'
import { crossrefToCsl, makeCitekey, tagProvenance } from './cslMap'

const CROSSREF_MESSAGE = {
  type: 'journal-article',
  title: ['Measured measurement'],
  'container-title': ['Nature Physics'],
  author: [{ given: 'Markus', family: 'Aspelmeyer' }],
  issued: { 'date-parts': [[2009, 1]] },
  DOI: '10.1038/nphys1170',
  volume: '5', issue: '1', page: '11-12',
  publisher: 'Springer Science and Business Media LLC',
}

describe('crossrefToCsl', () => {
  it('maps CrossRef fields into CSL-JSON', () => {
    const item = crossrefToCsl(CROSSREF_MESSAGE, 'aspelmeyer2009measured')
    expect(item).toMatchObject({
      id: 'aspelmeyer2009measured',
      type: 'article-journal',
      title: 'Measured measurement',
      'container-title': 'Nature Physics',
      author: [{ given: 'Markus', family: 'Aspelmeyer' }],
      issued: { 'date-parts': [[2009, 1]] },
      DOI: '10.1038/nphys1170',
      volume: '5', issue: '1', page: '11-12',
    })
  })
  it('maps unknown crossref types to document', () => {
    expect(crossrefToCsl({ type: 'weird-thing', title: ['X'] }, 'x').type).toBe('document')
  })
})

describe('makeCitekey', () => {
  it('builds <family><year><titleword>', () => {
    expect(makeCitekey({
      author: [{ family: 'Aspelmeyer' }],
      issued: { 'date-parts': [[2009]] },
      title: 'Measured measurement',
    })).toBe('aspelmeyer2009measured')
  })
  it('folds accents and lowercases', () => {
    expect(makeCitekey({ author: [{ family: 'Ćurić' }], issued: { 'date-parts': [[2020]] }, title: 'Über Alles' })).toBe('curic2020uber')
  })
  it('falls back gracefully with no author/year', () => {
    expect(makeCitekey({ title: 'Solo' }).startsWith('anonnd')).toBe(true)
  })
})

describe('tagProvenance', () => {
  it('tags every present metadata field with the source and records addedAt', () => {
    const tagged = tagProvenance({ id: 'x', type: 'book', title: 'T', DOI: '10.1/x' }, 'crossref', { sourceUrl: 'https://doi.org/10.1/x' })
    const meta = (tagged as { _iw: { fields: Record<string, { source: string }>; sourceUrl: string; addedAt: string } })._iw
    expect(meta.fields.title.source).toBe('crossref')
    expect(meta.fields.DOI.source).toBe('crossref')
    expect(meta.fields.id).toBeUndefined() // id/type are not tagged
    expect(meta.sourceUrl).toBe('https://doi.org/10.1/x')
    expect(typeof meta.addedAt).toBe('string')
  })
})
