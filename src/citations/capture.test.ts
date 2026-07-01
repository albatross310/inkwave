import { describe, it, expect } from 'vitest'
import { parseAuthor, parseDate, extractToCsl, type ExtractResponse } from './capture'

describe('parseAuthor', () => {
  it('splits on comma', () => {
    const a = parseAuthor('Smith, Jane')
    expect(a).toHaveLength(2)
    expect(a![0]).toEqual({ literal: 'Smith' })
    expect(a![1]).toEqual({ literal: 'Jane' })
  })

  it('splits on " and "', () => {
    const a = parseAuthor('Jane Smith and Bob Jones')
    expect(a).toHaveLength(2)
    expect(a![0]).toEqual({ family: 'Smith', given: 'Jane' })
    expect(a![1]).toEqual({ family: 'Jones', given: 'Bob' })
  })

  it('splits on &', () => {
    const a = parseAuthor('Alice Brown & Carlos Ruiz')
    expect(a).toHaveLength(2)
    expect(a![0]).toEqual({ family: 'Brown', given: 'Alice' })
    expect(a![1]).toEqual({ family: 'Ruiz', given: 'Carlos' })
  })

  it('uses literal for a single-word name', () => {
    expect(parseAuthor('Plato')).toEqual([{ literal: 'Plato' }])
  })

  it('treats last word as family name', () => {
    expect(parseAuthor('Mary A. Jones')).toEqual([{ family: 'Jones', given: 'Mary A.' }])
  })
})

describe('parseDate', () => {
  it('parses a full YYYY-MM-DD date', () => {
    expect(parseDate('2024-03-15')).toEqual({ 'date-parts': [[2024, 3, 15]] })
  })

  it('parses YYYY-MM', () => {
    expect(parseDate('2023-07')).toEqual({ 'date-parts': [[2023, 7]] })
  })

  it('parses YYYY only', () => {
    expect(parseDate('2021')).toEqual({ 'date-parts': [[2021]] })
  })

  it('extracts year from prose', () => {
    expect(parseDate('Published in 2020.')).toEqual({ 'date-parts': [[2020]] })
  })

  it('returns undefined when no year found', () => {
    expect(parseDate('no date here')).toBeUndefined()
  })
})

describe('extractToCsl', () => {
  const URL = 'https://example.com/post'

  it('builds a CSL item from a full AI response', () => {
    const res: ExtractResponse = {
      itemType: 'blogPost',
      confidence: 'high',
      fields: {
        title: { value: 'How Attention Works', quote: 'How Attention Works — A Blog' },
        author: { value: 'Jane Smith', quote: 'Jane Smith' },
        date: { value: '2024-03-15', quote: '2024-03-15' },
        publisher: { value: 'Example Blog', quote: null },
      },
    }
    const { item, fields } = extractToCsl(res, URL)
    expect(item.type).toBe('post-weblog')
    expect(item.title).toBe('How Attention Works')
    expect(item.author).toHaveLength(1)
    expect((item.author![0] as { family: string }).family).toBe('Smith')
    expect(item.issued).toEqual({ 'date-parts': [[2024, 3, 15]] })
    expect(item['container-title']).toBe('Example Blog')
    expect(item.URL).toBe(URL)
    expect(typeof item.id).toBe('string')
    expect(item.id.length).toBeGreaterThan(0)
    expect(Object.keys(fields)).toContain('title')
  })

  it('falls back to webpage type for unknown itemType', () => {
    const { item } = extractToCsl({ itemType: 'unknown', fields: {} }, URL)
    expect(item.type).toBe('webpage')
  })

  it('omits author/date when fields are empty', () => {
    const { item } = extractToCsl({ fields: { title: { value: 'A Post', quote: null } } }, URL)
    expect(item.author).toBeUndefined()
    expect(item.issued).toBeUndefined()
    expect(item.title).toBe('A Post')
  })

  it('maps itemType correctly for article/report/video', () => {
    expect(extractToCsl({ itemType: 'newsArticle', fields: {} }, URL).item.type).toBe('article-newspaper')
    expect(extractToCsl({ itemType: 'report', fields: {} }, URL).item.type).toBe('report')
    expect(extractToCsl({ itemType: 'video', fields: {} }, URL).item.type).toBe('motion_picture')
  })
})
