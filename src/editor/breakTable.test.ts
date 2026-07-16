// BREAK-TABLE STORE — the two bugs the layer's first execution caught, pinned.
//
// `opfs.prove.mjs` proves the round trip in the real app once. These pin the LOGIC forever, and both
// tests exist because the real thing was broken in exactly this way: the layer had ZERO CALLERS and
// had never executed, so nothing had ever disagreed with it.
//
// Each test carries its own KNOWN-NEGATIVE — an assertion that passes only because the code is right
// must be shown capable of failing, or it is decoration.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTable, putTable, tableStats, contextSig, _resetTables, type BreakTable } from './breakTable'

const table = (sig: string): BreakTable => ({
  v: 1, sig, pages: 3, starts: [1, 100, 200], reliable: true, reliablePages: 3,
})

// OPFS is not available in vitest; persist() is best-effort and swallows its own failure, which is
// exactly the production contract (a table is regenerable). These tests are about the INDEX logic.
vi.mock('../storage/opfsWrite', () => ({ writeOpfsFile: vi.fn(async () => {}) }))

describe('getTable — memory is authoritative for what it holds', () => {
  beforeEach(() => { _resetTables() })

  // THE BUG: getTable early-returned a MISS whenever `!i.loaded`, but putTable never sets `loaded`.
  // So a session that built its own tables missed EVERY lookup and rebuilt forever — a cache
  // reporting a full index while serving nothing. Silent, and indistinguishable from "the cache
  // isn't helping".
  it('serves a table put THIS session, before loadTables() has ever run', () => {
    const sig = 'ctx-A'
    putTable('doc1', 'snap-1', table(sig))
    // `loaded` is deliberately still false here — nothing hydrated from disk.
    expect(tableStats('doc1').loaded).toBe(false)
    const got = getTable('doc1', 'snap-1', sig)
    expect(got).not.toBeNull()
    expect(got?.starts).toEqual([1, 100, 200])
    expect(tableStats('doc1').hits).toBe(1)
  })

  // KNOWN-NEGATIVE for the above: absence must STILL miss. If the fix had simply removed the guard
  // and started returning something for everything, this is what would catch it.
  it('still MISSES a snapId it does not hold', () => {
    putTable('doc1', 'snap-1', table('ctx-A'))
    expect(getTable('doc1', 'snap-2', 'ctx-A')).toBeNull()
    expect(tableStats('doc1').misses).toBe(1)
  })

  it('misses (never throws) for a document it has never seen', () => {
    expect(getTable('unknown-doc', 'snap-1', 'ctx-A')).toBeNull()
    expect(tableStats('unknown-doc').misses).toBe(1)
  })
})

describe('getTable — a signature mismatch is a LOUD miss, never a silent reuse', () => {
  beforeEach(() => { _resetTables() })

  // A table from a different canonical context describes a different pagination. Reusing it does not
  // crash — it paints the WRONG WORDS on the page and reports success. That is what paginate()'s
  // retired orphan rule did to this project once already.
  it('refuses a stale signature and COUNTS it separately from a miss', () => {
    putTable('doc1', 'snap-1', table('ctx-A'))
    expect(getTable('doc1', 'snap-1', 'ctx-B')).toBeNull()
    const s = tableStats('doc1')
    expect(s.stale).toBe(1)
    expect(s.misses).toBe(0) // stale is its own category — a rebuild we can SEE
    expect(s.hits).toBe(0)
  })

  it('the correct signature still hits afterwards — the refusal DISCRIMINATES, not just breaks', () => {
    putTable('doc1', 'snap-1', table('ctx-A'))
    expect(getTable('doc1', 'snap-1', 'ctx-B')).toBeNull()
    expect(getTable('doc1', 'snap-1', 'ctx-A')).not.toBeNull()
  })
})

describe('contextSig — content-derived, never session-derived', () => {
  const geom = {
    pageWidthPx: 793.7, pageHeightPx: 1122.52, topMarginPx: 96, sideMarginPx: 96,
    contentWidthPx: 601.7, basePx: 18, ratio: 1.618, paraSpacingEm: 0.5,
  }

  // THE BUG THIS ENCODES: contextSig used to embed bibProvider.getVersion() — a monotonic counter of
  // notifications THIS SESSION. It read 15 before a reload and 2 after, on a byte-identical document,
  // so every hydrated table stale-missed and the OPFS layer could never score a hit. The signature
  // now takes a CONTENT signature of the bibliography, so identical inputs give identical output no
  // matter how many times anything was notified.
  it('is stable for identical inputs (it must survive a process boundary)', () => {
    expect(contextSig(geom, 'apa', '15:abc123', 'fonts')).toBe(contextSig(geom, 'apa', '15:abc123', 'fonts'))
  })

  it('moves when the BIBLIOGRAPHY CONTENT moves (a citation box changes the wrap)', () => {
    expect(contextSig(geom, 'apa', '15:abc123', 'f')).not.toBe(contextSig(geom, 'apa', '15:def456', 'f'))
  })

  it('moves when the citation STYLE moves', () => {
    expect(contextSig(geom, 'apa', '15:abc', 'f')).not.toBe(contextSig(geom, 'mla', '15:abc', 'f'))
  })

  it('moves when the canonical GEOMETRY moves (the known-negative the pane probes fire on)', () => {
    const narrow = { ...geom, sideMarginPx: 220, contentWidthPx: 353.7 }
    expect(contextSig(geom, 'apa', '15:abc', 'f')).not.toBe(contextSig(narrow, 'apa', '15:abc', 'f'))
  })

  // ZOOM AND DPR ARE DELIBERATELY ABSENT — proved on BOTH engines (panezoom.prove.mjs, Chromium and
  // WebKit: all zoom conditions leave the break offsets byte-identical, with the known-negative
  // firing on each engine's own text stack first). The signature takes no zoom argument AT ALL, so
  // this is structural rather than a value comparison: there is nothing to pass.
  it('takes no zoom/DPR input — the table is portable across zooms by construction', () => {
    expect(contextSig.length).toBe(4) // geom, citationStyle, bibSig, fontsKey
  })
})

describe('tableStats — bounded coverage must be VISIBLE', () => {
  beforeEach(() => { _resetTables() })

  it('reports bytes and an empty drop list at Peter-scale (eviction should not fire)', () => {
    for (let i = 0; i < 116; i++) putTable('doc1', `snap-${i}`, table('ctx-A'))
    const s = tableStats('doc1')
    expect(s.tables).toBe(116)
    expect(s.builds).toBe(116)
    expect(s.dropped).toEqual([]) // 116 × ~1.4KB is far under the 2MB budget
    expect(s.bytes).toBeGreaterThan(0)
    expect(s.bytes).toBeLessThan(s.budget)
  })

  // The drop list must NAME what was evicted. Silent truncation is how "we covered everything"
  // becomes false without anyone noticing — the grow-only snapshot incident, same lesson.
  it('NAMES evicted tables when the budget is genuinely exceeded', () => {
    const fat = (): BreakTable => ({
      v: 1, sig: 'ctx-A', pages: 40000, starts: new Array(40000).fill(0).map((_, i) => i),
      reliable: true, reliablePages: 40000,
    })
    for (let i = 0; i < 12; i++) putTable('doc2', `snap-${i}`, fat())
    const s = tableStats('doc2')
    expect(s.dropped.length).toBeGreaterThan(0)
    expect(s.dropped[0]).toBe('snap-0') // LRU: the oldest goes first
    expect(s.bytes).toBeLessThanOrEqual(s.budget)
  })
})
