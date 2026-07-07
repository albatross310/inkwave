import { describe, it, expect, vi, afterEach } from 'vitest'
import { reverifyEntry, applyReverify, revertField, type ReverifyResult } from './reverify'
import type { CSLItem, IwCitationMeta } from '../types/document'

// The AI leg is gated behind the URL-lookup opt-in (off by default; no localStorage in node).
// These tests exercise the leg itself, so run them with the feature enabled.
vi.mock('../editor/aiSettings', () => ({ urlLookupEnabled: () => true }))

function iw(item: CSLItem): IwCitationMeta {
  return (item as { _iw?: IwCitationMeta })._iw ?? {}
}

// An AI-captured blog entry (source URL that is NOT a detectable identifier → AI re-verify path).
function aiItem(overrides: Partial<CSLItem> = {}, fieldSources: Record<string, 'ai' | 'manual'> = {}): CSLItem {
  const base: CSLItem = {
    id: 'doe2020',
    type: 'post-weblog',
    title: 'Old Title',
    URL: 'https://blog.example.com/my-post',
    ...overrides,
  }
  const fields: Record<string, { source: 'ai' | 'manual' }> = { title: { source: 'ai' } }
  for (const [k, s] of Object.entries(fieldSources)) fields[k] = { source: s }
  ;(base as { _iw?: IwCitationMeta })._iw = { sourceUrl: 'https://blog.example.com/my-post', fields }
  return base
}

function mockExtract(body: unknown, ok = true, httpStatus = 200) {
  globalThis.fetch = vi.fn(async () => ({
    ok, status: httpStatus, json: async () => body,
  })) as unknown as typeof fetch
}

afterEach(() => vi.restoreAllMocks())

describe('reverifyEntry — AI path', () => {
  it('detects changed fields against a fresh extraction', async () => {
    mockExtract({ fields: { title: { value: 'New Title' }, author: { value: 'Jane Doe' } } })
    const res = await reverifyEntry(aiItem())
    expect(res.ok).toBe(true)
    expect(res.deadUrl).toBe(false)
    const titleDiff = res.diffs.find(d => d.field === 'title')
    expect(titleDiff?.new).toBe('New Title')
    expect(res.diffs.some(d => d.field === 'author')).toBe(true)
  })

  it('never re-verifies a manually-edited field', async () => {
    mockExtract({ fields: { title: { value: 'Auto Title' } } })
    const res = await reverifyEntry(aiItem({ title: 'My Hand Edit' }, { title: 'manual' }))
    expect(res.diffs.some(d => d.field === 'title')).toBe(false)
  })

  it('does not wipe a field the fresh source fails to produce', async () => {
    mockExtract({ fields: {} }) // extraction yielded nothing
    const res = await reverifyEntry(aiItem())
    expect(res.diffs).toHaveLength(0)
  })

  it('flags a dead source URL (404)', async () => {
    mockExtract({ error: 'page fetch failed (404)', status: 404 }, false, 502)
    const res = await reverifyEntry(aiItem())
    expect(res.ok).toBe(false)
    expect(res.deadUrl).toBe(true)
  })

  it('reports a transient error without flagging dead', async () => {
    mockExtract({ error: 'server 500', status: 500 }, false, 502)
    const res = await reverifyEntry(aiItem())
    expect(res.ok).toBe(false)
    expect(res.deadUrl).toBe(false)
    expect(res.error).toBeTruthy()
  })
})

describe('applyReverify', () => {
  it('overwrites fields, records a changelog with the old value, stamps lastVerified', () => {
    const item = aiItem()
    const result: ReverifyResult = {
      ok: true, deadUrl: false, checkedAt: '2026-07-02T00:00:00.000Z', source: 'ai',
      diffs: [{ field: 'title', old: 'Old Title', new: 'New Title' }],
    }
    const out = applyReverify(item, result)
    expect(out.title).toBe('New Title')
    const log = iw(out).changelog!
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ field: 'title', old: 'Old Title', new: 'New Title', source: 'ai' })
    expect(iw(out).lastVerified).toBe('2026-07-02T00:00:00.000Z')
    // pure — original untouched
    expect(item.title).toBe('Old Title')
  })

  it('stamps deadUrl and does not overwrite when the URL is dead', () => {
    const out = applyReverify(aiItem(), { ok: false, deadUrl: true, checkedAt: 'x', source: 'ai', diffs: [] })
    expect(iw(out).deadUrl).toBe(true)
    expect(out.title).toBe('Old Title')
  })
})

describe('revertField', () => {
  it('restores the old value and appends a manual-revert entry', () => {
    const item = applyReverify(aiItem(), {
      ok: true, deadUrl: false, checkedAt: 't', source: 'ai',
      diffs: [{ field: 'title', old: 'Old Title', new: 'New Title' }],
    })
    const reverted = revertField(item, 0)
    expect(reverted.title).toBe('Old Title')
    const log = iw(reverted).changelog!
    expect(log).toHaveLength(2)
    expect(log[1]).toMatchObject({ field: 'title', old: 'New Title', new: 'Old Title', source: 'manual' })
    // reverting marks the field as manual so a later re-check won't clobber it again
    expect(iw(reverted).fields?.title?.source).toBe('manual')
  })

  it('is a no-op on an invalid index', () => {
    const item = aiItem()
    expect(revertField(item, 5)).toBe(item)
  })
})
