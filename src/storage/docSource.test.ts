// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDocumentDirtyAt, getRecognisedSave, markDocumentDirty, markRecognisedSave, recognisedSaveIsLive, setDocSource, shouldWarnBeforeDocumentChange } from './docSource'

describe('recognised document save heartbeat', () => {
  beforeEach(() => localStorage.clear())

  it('keeps an unchanged destination save current, then gives a changed doc 20 seconds to sync', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T00:00:00Z'))
    markRecognisedSave('doc-a', 'download')
    expect(getRecognisedSave('doc-a')).toEqual({ at: Date.now(), destination: 'download' })
    expect(recognisedSaveIsLive('doc-a', Date.now() + 60_000)).toBe(true)
    markDocumentDirty('doc-a', Date.now() + 1)
    expect(getDocumentDirtyAt('doc-a')).toBe(Date.now() + 1)
    expect(recognisedSaveIsLive('doc-a', Date.now() + 20_001)).toBe(true)
    expect(recognisedSaveIsLive('doc-a', Date.now() + 20_002)).toBe(false)
    vi.setSystemTime(new Date('2026-09-06T00:01:00Z'))
    markRecognisedSave('doc-a', 'download')
    expect(recognisedSaveIsLive('doc-a', Date.now() + 60_000)).toBe(true)
    vi.useRealTimers()
  })

  it('treats a successful linked-source save as a recognised heartbeat', () => {
    setDocSource('doc-b', 'gdrive')
    expect(getRecognisedSave('doc-b')?.destination).toBe('gdrive')
  })

  it('never warns when the current editor session did not change the document', () => {
    expect(shouldWarnBeforeDocumentChange('untouched', false, Date.now() + 60_000)).toBe(false)
  })

  it('warns only when changed work lacks a current recognised save', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T00:00:00Z'))
    expect(shouldWarnBeforeDocumentChange('changed', true)).toBe(true)
    markRecognisedSave('changed', 'download')
    expect(shouldWarnBeforeDocumentChange('changed', true, Date.now() + 60_000)).toBe(false)
    markDocumentDirty('changed', Date.now() + 60_001)
    expect(shouldWarnBeforeDocumentChange('changed', true, Date.now() + 80_003)).toBe(true)
    vi.useRealTimers()
  })
})
