import { describe, it, expect, beforeEach } from 'vitest'
import { bibProvider } from './bibProvider'
import { addToLibrary } from './library'
import type { CSLItem, IwCitationMeta, ChangelogEntry } from '../types/document'

const LOG: ChangelogEntry[] = [{ field: 'title', old: 'Old', new: 'New', at: '2026-07-01T00:00:00Z', source: 'crossref' }]

function withMeta(item: CSLItem, iw: IwCitationMeta): CSLItem {
  return { ...item, _iw: iw } as CSLItem
}
function metaOf(item?: CSLItem): IwCitationMeta | undefined {
  return (item as { _iw?: IwCitationMeta } | undefined)?._iw
}

beforeEach(() => bibProvider.setEntries([], 'library'))

describe('addToLibrary — preserves re-verification history across re-capture', () => {
  it('keeps an existing changelog when the same source is re-captured without one (extension re-flush)', async () => {
    bibProvider.setEntries([withMeta({ id: 'x', type: 'book', title: 'T', DOI: '10.1/x' }, { changelog: LOG, lastVerified: '2026-07-01T00:00:00Z', deadUrl: false })], 'library')
    // A fresh capture of the same DOI, carrying NO changelog.
    await addToLibrary({ id: 'x', type: 'book', title: 'T (updated)', DOI: '10.1/x' })
    const got = bibProvider.get('x')
    expect(got?.title).toBe('T (updated)')          // base fields updated
    expect(metaOf(got)?.changelog).toEqual(LOG)      // history preserved
    expect(metaOf(got)?.lastVerified).toBe('2026-07-01T00:00:00Z')
  })

  it('lets a real re-verify UPDATE the changelog (incoming history wins)', async () => {
    bibProvider.setEntries([withMeta({ id: 'x', type: 'book', title: 'T', DOI: '10.1/x' }, { changelog: LOG })], 'library')
    const longer: ChangelogEntry[] = [...LOG, { field: 'issued', old: null, new: { 'date-parts': [[2020]] }, at: '2026-07-02T00:00:00Z', source: 'crossref' }]
    await addToLibrary(withMeta({ id: 'x', type: 'book', title: 'T', DOI: '10.1/x' }, { changelog: longer }))
    expect(metaOf(bibProvider.get('x'))?.changelog).toHaveLength(2)
  })

  it('does not attach history to a genuinely different source that happens to share a citekey', async () => {
    bibProvider.setEntries([withMeta({ id: 'smith2020', type: 'book', title: 'Alpha', DOI: '10.1/a' }, { changelog: LOG })], 'library')
    const stored = await addToLibrary({ id: 'smith2020', type: 'book', title: 'Beta', DOI: '10.1/b' })
    expect(stored.id).not.toBe('smith2020')          // collision → suffixed citekey
    expect(metaOf(bibProvider.get(stored.id))?.changelog).toBeUndefined()
  })
})
