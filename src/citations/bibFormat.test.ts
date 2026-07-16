// The shared CSL-format cache — the contract a SYNCHRONOUS renderer depends on.
//
// What matters here is not "does a Map work". It is the three properties the renderer's honesty
// rests on: a miss is a MISS (never a guess), one key formats ONCE however many callers ask, and a
// FAILED format caches NOTHING (a document that has references must never be cached as one that has
// none).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CSLItem } from '../types/document'

const formatSpy = vi.hoisted(() => vi.fn())
vi.mock('./format', () => ({ formatReferenceEntries: formatSpy }))

import { bibEntries, ensureBibEntries, _clearBibFormat, subscribeBibFormat } from './bibFormat'

const item = (id: string): CSLItem => ({ id, type: 'book', title: `Title ${id}` } as CSLItem)

describe('bibFormat — the shared cache', () => {
  beforeEach(() => { _clearBibFormat(); formatSpy.mockReset() })
  afterEach(() => { _clearBibFormat() })

  it('a synchronous read MISSES before any format — it never blocks and never invents', () => {
    expect(bibEntries(['a'], 'apa', 1)).toBeNull()
    expect(formatSpy).not.toHaveBeenCalled() // a read must never trigger a format on the paint path
  })

  it('serves the formatted entries synchronously once the format has landed', async () => {
    formatSpy.mockResolvedValue([['a', '<div class="csl-entry">A</div>']])
    await ensureBibEntries([item('a')], 'apa', 1)
    expect(bibEntries(['a'], 'apa', 1)).toEqual([['a', '<div class="csl-entry">A</div>']])
  })

  it('formats a key ONCE however many callers race for it, and they all get the result', async () => {
    let resolve!: (v: unknown) => void
    formatSpy.mockReturnValue(new Promise(r => { resolve = r }))
    const a = ensureBibEntries([item('a')], 'apa', 1)
    const b = ensureBibEntries([item('a')], 'apa', 1)
    const c = ensureBibEntries([item('a')], 'apa', 1)
    resolve([['a', '<i>A</i>']])
    expect(await a).toEqual([['a', '<i>A</i>']])
    expect(await b).toEqual([['a', '<i>A</i>']])
    expect(await c).toEqual([['a', '<i>A</i>']])
    // The point of sharing the PROMISE rather than a busy-flag: three askers, one citeproc run.
    expect(formatSpy).toHaveBeenCalledTimes(1)
  })

  it('a different style or epoch is a DIFFERENT key — a stale bibliography can never be served', async () => {
    formatSpy.mockResolvedValue([['a', 'apa-v1']])
    await ensureBibEntries([item('a')], 'apa', 1)
    expect(bibEntries(['a'], 'apa', 1)).not.toBeNull()
    expect(bibEntries(['a'], 'mla', 1)).toBeNull() // style changed ⇒ defer, don't reuse
    expect(bibEntries(['a'], 'apa', 2)).toBeNull() // library changed ⇒ defer, don't reuse
  })

  it('a FAILED format caches nothing — a doc with references never becomes one with none', async () => {
    formatSpy.mockRejectedValue(new Error('csl engine down'))
    expect(await ensureBibEntries([item('a')], 'apa', 1)).toBeNull()
    expect(bibEntries(['a'], 'apa', 1)).toBeNull() // still a miss ⇒ the caller defers, honestly
    // ...and it must be RETRYABLE, not poisoned by the failure.
    formatSpy.mockResolvedValue([['a', 'recovered']])
    await ensureBibEntries([item('a')], 'apa', 1)
    expect(bibEntries(['a'], 'apa', 1)).toEqual([['a', 'recovered']])
  })

  it('notifies subscribers when a format lands, so a deferred renderer can rebuild', async () => {
    formatSpy.mockResolvedValue([['a', 'A']])
    const cb = vi.fn()
    const un = subscribeBibFormat(cb)
    await ensureBibEntries([item('a')], 'apa', 1)
    expect(cb).toHaveBeenCalled()
    un()
    cb.mockReset()
    await ensureBibEntries([item('b')], 'apa', 1)
    expect(cb).not.toHaveBeenCalled()
  })

  it('an empty bibliography is a real answer (no entries), not a miss', async () => {
    expect(await ensureBibEntries([], 'apa', 1)).toEqual([])
    expect(bibEntries([], 'apa', 1)).toEqual([])
    expect(formatSpy).not.toHaveBeenCalled() // nothing to format
  })
})
