import { describe, it, expect } from 'vitest'
import { crossrefToCsl, arxivToCsl, openLibraryToCsl, googleBooksToCsl, makeCitekey, tagProvenance } from './cslMap'

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
  it('uses literal when no family name is present', () => {
    expect(makeCitekey({ author: [{ literal: 'WHO' }], issued: { 'date-parts': [[2021]] }, title: 'Global Report' })).toBe('who2021global')
  })
  it('reads year from issued.raw when date-parts is absent', () => {
    expect(makeCitekey({ author: [{ family: 'Smith' }], issued: { raw: '2018' }, title: 'Long Paper Title' })).toBe('smith2018long')
  })
  it('omits title word when all words are 3 chars or fewer', () => {
    const key = makeCitekey({ author: [{ family: 'Lee' }], issued: { 'date-parts': [[2022]] }, title: 'On the Art' })
    expect(key).toBe('lee2022')
  })
  it('caps the citekey at 40 characters', () => {
    const key = makeCitekey({ author: [{ family: 'Abcdefghijklmnopqrstuvwxyzabcde' }], issued: { 'date-parts': [[2020]] }, title: 'Long Title Word' })
    expect(key.length).toBeLessThanOrEqual(40)
  })
})

describe('arxivToCsl', () => {
  it('maps arXiv entry fields to CSL', () => {
    const item = arxivToCsl(
      { title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], published: '2017-06-12T00:00:00Z', id: 'http://arxiv.org/abs/1706.03762v7', doi: '10.48550/arXiv.1706.03762' },
      'vaswani2017attention',
    )
    expect(item.id).toBe('vaswani2017attention')
    expect(item.type).toBe('article')
    expect(item.title).toBe('Attention Is All You Need')
    expect(item.author).toHaveLength(2)
    expect((item.author![0] as { family: string }).family).toBe('Vaswani')
    expect(item.issued).toEqual({ 'date-parts': [[2017]] })
    expect(item.DOI).toBe('10.48550/arXiv.1706.03762')
  })

  it('omits DOI when not present', () => {
    const item = arxivToCsl({ title: 'X', authors: [], published: '2020-01-01Z' }, 'x')
    expect(item.DOI).toBeUndefined()
  })
})

describe('openLibraryToCsl', () => {
  it('maps OpenLibrary record to CSL book', () => {
    const rec = {
      title: 'Being and Time',
      authors: [{ name: 'Martin Heidegger' }],
      publish_date: '1927',
      publishers: [{ name: 'Max Niemeyer' }],
      number_of_pages: 589,
    }
    const item = openLibraryToCsl(rec, 'heidegger1927being')
    expect(item.id).toBe('heidegger1927being')
    expect(item.type).toBe('book')
    expect(item.title).toBe('Being and Time')
    expect(item.author).toHaveLength(1)
    expect(item.author![0]).toEqual({ family: 'Heidegger', given: 'Martin' })
    expect(item.issued).toEqual({ 'date-parts': [[1927]] })
    expect(item.publisher).toBe('Max Niemeyer')
  })
})

describe('googleBooksToCsl', () => {
  it('maps volumeInfo → book CSL with subtitle, authors, year, publisher, ISBN', () => {
    const info = {
      title: 'Introduction to Algorithms',
      subtitle: 'Third Edition',
      authors: ['Thomas H. Cormen', 'Charles E. Leiserson'],
      publishedDate: '2009-07-31',
      publisher: 'MIT Press',
      pageCount: 1292,
    }
    const item = googleBooksToCsl(info, 'cormen2009introduction', '9780262033848')
    expect(item.type).toBe('book')
    expect(item.title).toBe('Introduction to Algorithms: Third Edition')
    expect(item.author).toEqual([
      { family: 'Cormen', given: 'Thomas H.' },
      { family: 'Leiserson', given: 'Charles E.' },
    ])
    expect(item.issued).toEqual({ 'date-parts': [[2009]] })
    expect(item.publisher).toBe('MIT Press')
    expect(item.ISBN).toBe('9780262033848')
    expect(item['number-of-pages']).toBe('1292')
  })
})

describe('tagProvenance', () => {
  it('tags every present metadata field with the source and records addedAt', () => {
    const tagged = tagProvenance({ id: 'x', type: 'book', title: 'T', DOI: '10.1/x' }, 'crossref', { sourceUrl: 'https://doi.org/10.1/x' })
    const meta = (tagged as unknown as { _iw: { fields: Record<string, { source: string }>; sourceUrl: string; addedAt: string } })._iw
    expect(meta.fields.title.source).toBe('crossref')
    expect(meta.fields.DOI.source).toBe('crossref')
    expect(meta.fields.id).toBeUndefined() // id/type are not tagged
    expect(meta.sourceUrl).toBe('https://doi.org/10.1/x')
    expect(typeof meta.addedAt).toBe('string')
  })
})
