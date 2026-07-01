import { describe, it, expect } from 'vitest'
import { simpleInText, simpleRefList } from './format'
import type { CSLItem } from '../types/document'

function item(overrides: Partial<CSLItem> = {}): CSLItem {
  return {
    id: 'test-1',
    type: 'article-journal',
    title: 'Default Title',
    author: [{ family: 'Smith', given: 'John' }],
    issued: { 'date-parts': [[2023]] },
    ...overrides,
  }
}

describe('simpleInText', () => {
  it('formats a single author + year', () => {
    expect(simpleInText([item()])).toBe('(Smith, 2023)')
  })

  it('formats multiple items with semicolons', () => {
    const a = item({ id: 'a', author: [{ family: 'Smith', given: 'John' }], issued: { 'date-parts': [[2023]] } })
    const b = item({ id: 'b', author: [{ family: 'Jones', given: 'Alice' }], issued: { 'date-parts': [[2021]] } })
    expect(simpleInText([a, b])).toBe('(Smith, 2023; Jones, 2021)')
  })

  it('falls back to literal author name', () => {
    const i = item({ author: [{ literal: 'World Health Organization' }] })
    expect(simpleInText([i])).toBe('(World Health Organization, 2023)')
  })

  it('uses ? for missing author', () => {
    expect(simpleInText([item({ author: undefined })])).toBe('(?, 2023)')
  })

  it('uses ? for missing year', () => {
    expect(simpleInText([item({ issued: undefined })])).toBe('(Smith, ?)')
  })

  it('returns empty string for empty array', () => {
    expect(simpleInText([])).toBe('()')
  })
})

describe('simpleRefList', () => {
  it('formats a basic journal article', () => {
    const i = item({ 'container-title': 'Nature' })
    const result = simpleRefList([i])
    expect(result).toContain('Smith, John')
    expect(result).toContain('(2023)')
    expect(result).toContain('Default Title')
    expect(result).toContain('Nature')
  })

  it('omits container-title when absent', () => {
    const result = simpleRefList([item()])
    expect(result).not.toContain('undefined')
    expect(result.endsWith('.')).toBe(true)
  })

  it('formats multiple items with blank lines between them', () => {
    const a = item({ id: 'a', title: 'First Work' })
    const b = item({ id: 'b', title: 'Second Work' })
    const result = simpleRefList([a, b])
    expect(result).toContain('First Work')
    expect(result).toContain('Second Work')
    expect(result).toContain('\n\n')
  })

  it('formats a literal author (no family/given)', () => {
    const i = item({ author: [{ literal: 'United Nations' }] })
    expect(simpleRefList([i])).toContain('United Nations')
  })

  it('handles multiple authors', () => {
    const i = item({ author: [{ family: 'Doe', given: 'Jane' }, { family: 'Roe', given: 'Mary' }] })
    const result = simpleRefList([i])
    expect(result).toContain('Doe, Jane')
    expect(result).toContain('Roe, Mary')
  })

  it('returns empty string for empty array', () => {
    expect(simpleRefList([])).toBe('')
  })
})
