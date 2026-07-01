import { describe, it, expect, beforeEach } from 'vitest'
import type { CSLItem } from '../types/document'

// Import the real singleton but reset between tests by calling setEntries([])
import { bibProvider } from './bibProvider'

function entry(id: string, overrides: Partial<CSLItem> = {}): CSLItem {
  return {
    id,
    type: 'article-journal',
    title: `Title for ${id}`,
    author: [{ family: 'Smith', given: 'Jane' }],
    issued: { 'date-parts': [[2023]] },
    ...overrides,
  }
}

beforeEach(() => {
  bibProvider.setEntries([], 'library')
})

describe('BibProvider — crud', () => {
  it('upsert adds a new entry and increments count', () => {
    bibProvider.upsert(entry('smith2023'), 'library')
    expect(bibProvider.get('smith2023')).toBeDefined()
    expect(bibProvider.status().entries).toBe(1)
  })

  it('upsert replaces an existing entry with the same id', () => {
    bibProvider.upsert(entry('a', { title: 'Old title' }))
    bibProvider.upsert(entry('a', { title: 'New title' }))
    expect(bibProvider.get('a')?.title).toBe('New title')
    expect(bibProvider.status().entries).toBe(1)
  })

  it('remove returns true and deletes the entry', () => {
    bibProvider.upsert(entry('x'))
    expect(bibProvider.remove('x')).toBe(true)
    expect(bibProvider.get('x')).toBeUndefined()
  })

  it('remove returns false when entry absent', () => {
    expect(bibProvider.remove('nonexistent')).toBe(false)
  })

  it('setEntries replaces all entries', () => {
    bibProvider.upsert(entry('old'))
    bibProvider.setEntries([entry('new1'), entry('new2')], 'library')
    expect(bibProvider.get('old')).toBeUndefined()
    expect(bibProvider.status().entries).toBe(2)
  })

  it('getAll returns every entry', () => {
    bibProvider.setEntries([entry('a'), entry('b'), entry('c')])
    expect(bibProvider.getAll().length).toBe(3)
  })
})

describe('BibProvider — status', () => {
  it('initial status after setEntries([]) is {channel:"library", entries:0}', () => {
    const s = bibProvider.status()
    expect(s.channel).toBe('library')
    expect(s.entries).toBe(0)
  })

  it('status.entries tracks the count correctly across operations', () => {
    bibProvider.upsert(entry('a'))
    bibProvider.upsert(entry('b'))
    expect(bibProvider.status().entries).toBe(2)
    bibProvider.remove('a')
    expect(bibProvider.status().entries).toBe(1)
  })
})

describe('BibProvider — search', () => {
  beforeEach(() => {
    bibProvider.setEntries([
      entry('smith2023', { title: 'Quantum mechanics and philosophy' }),
      entry('jones2021', { title: 'Machine learning in science', author: [{ family: 'Jones', given: 'Bob' }], issued: { 'date-parts': [[2021]] } }),
      entry('doe2019',   { title: 'Nature of consciousness', author: [{ family: 'Doe', given: 'Alice' }], issued: { 'date-parts': [[2019]] } }),
    ])
  })

  it('empty query returns all entries', () => {
    expect(bibProvider.search('').length).toBe(3)
  })

  it('matches title substring', () => {
    const r = bibProvider.search('quantum')
    expect(r.length).toBe(1)
    expect(r[0].id).toBe('smith2023')
  })

  it('matches citekey', () => {
    const r = bibProvider.search('jones')
    expect(r.map(e => e.id)).toContain('jones2021')
  })

  it('matches author family name', () => {
    const r = bibProvider.search('doe')
    expect(r.length).toBe(1)
    expect(r[0].id).toBe('doe2019')
  })

  it('matches year', () => {
    const r = bibProvider.search('2021')
    expect(r.length).toBe(1)
    expect(r[0].id).toBe('jones2021')
  })

  it('returns empty array when no match', () => {
    expect(bibProvider.search('zzznomatch')).toHaveLength(0)
  })

  it('higher-scoring entries appear first (citekey match beats year match)', () => {
    // 'smith' matches the citekey (score +3) vs author name (score +2) if both apply.
    // jones2021 is only matched by author — let's check smith2023 ranks first for 'smith'.
    const r = bibProvider.search('smith')
    expect(r[0].id).toBe('smith2023')
  })
})

describe('BibProvider — subscribe', () => {
  it('notifies subscribers on upsert and remove', () => {
    let calls = 0
    const unsub = bibProvider.subscribe(() => { calls++ })
    bibProvider.upsert(entry('e1'))
    bibProvider.remove('e1')
    expect(calls).toBe(2)
    unsub()
    bibProvider.upsert(entry('e2'))
    expect(calls).toBe(2) // no more calls after unsubscribe
  })

  it('notifies on setEntries', () => {
    let calls = 0
    const unsub = bibProvider.subscribe(() => { calls++ })
    bibProvider.setEntries([entry('a'), entry('b')])
    expect(calls).toBe(1)
    unsub()
  })
})
