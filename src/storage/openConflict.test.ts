// Keepers for the blind-overwrite guard.
//
// The incident these exist to forbid: 2026-07-15 11:30:18, a stale .studio export replaced Peter's
// current honours-proposal content in OPFS, destroying a day of annotations. The guard's two
// properties are one-liners, so they get assertions that run on every `pnpm test` rather than
// living only in a browser probe someone has to remember to run (CLAUDE.md round 12: "a proof that
// ran once is indistinguishable from one that never ran").
//
// MUTATION-TESTED — each injected into classifyOpen; the named tests FAIL, so they are not
// decoration:
//   · `if (incomingIsPast) return 'incoming-stale'` deleted  → "refuses a stale file" fails
//   · the both-directions `diverged` clause moved AFTER the directional tests
//                                                            → "ambiguous history is never adopted" fails
//   · final `return 'diverged'` → `'incoming-newer'`         → "no shared history is never adopted" fails
//   · `localHash === incomingHash` → `!==`                   → "identical content is adopted" fails
//   · `mayOverwriteLocal` returns true for 'diverged'        → "only identical/newer may overwrite" fails

import { describe, it, expect } from 'vitest'
import { classifyOpen, mayOverwriteLocal, type OpenVerdict } from './openConflict'

// Synthetic hashes. Peter's real content never enters a fixture.
const OLD = 'aaaa0000'
const NEW = 'bbbb1111'
const OTHER = 'cccc2222'

describe('classifyOpen', () => {
  it('adopts when there is no local document — nothing can be lost', () => {
    expect(classifyOpen({ localHash: null, incomingHash: NEW, localSnapshotHashes: [], incomingSnapshotHashes: [] }))
      .toBe<OpenVerdict>('incoming-newer')
  })

  it('adopts identical content — re-opening your own synced file is the common case', () => {
    expect(classifyOpen({ localHash: NEW, incomingHash: NEW, localSnapshotHashes: [], incomingSnapshotHashes: [] }))
      .toBe<OpenVerdict>('identical')
  })

  it('REFUSES a stale file whose content is already in the local history — THE INCIDENT', () => {
    // Exactly 2026-07-15: local holds NEW; the export carries OLD, which this document has already
    // been through. Adopting it could only ever lose work.
    expect(classifyOpen({
      localHash: NEW,
      incomingHash: OLD,
      localSnapshotHashes: [OLD, NEW],
      incomingSnapshotHashes: [OLD],
    })).toBe<OpenVerdict>('incoming-stale')
  })

  it('adopts a genuine newer version — a sync-down from another device must not be blocked', () => {
    // The guard is worthless if it also breaks the legitimate case. Local's content is a past state
    // of the incoming file, so the file really is ahead.
    expect(classifyOpen({
      localHash: OLD,
      incomingHash: NEW,
      localSnapshotHashes: [OLD],
      incomingSnapshotHashes: [OLD, NEW],
    })).toBe<OpenVerdict>('incoming-newer')
  })

  it('ambiguous history is never adopted — each archive claiming the other is not a verdict', () => {
    expect(classifyOpen({
      localHash: NEW,
      incomingHash: OLD,
      localSnapshotHashes: [OLD, NEW],
      incomingSnapshotHashes: [OLD, NEW],
    })).toBe<OpenVerdict>('diverged')
  })

  it('no shared history is never adopted — with no evidence, keep both', () => {
    expect(classifyOpen({ localHash: NEW, incomingHash: OTHER, localSnapshotHashes: [], incomingSnapshotHashes: [] }))
      .toBe<OpenVerdict>('diverged')
    expect(classifyOpen({
      localHash: NEW, incomingHash: OTHER, localSnapshotHashes: [NEW], incomingSnapshotHashes: [OTHER],
    })).toBe<OpenVerdict>('diverged')
  })

  it('a stale file is refused even when the local archive is the ONLY evidence', () => {
    // The incoming bundle may carry no snapshots at all (a stripped/legacy export). The local
    // archive alone still proves the file is a past state.
    expect(classifyOpen({
      localHash: NEW, incomingHash: OLD, localSnapshotHashes: [OLD, NEW], incomingSnapshotHashes: [],
    })).toBe<OpenVerdict>('incoming-stale')
  })
})

describe('mayOverwriteLocal', () => {
  it('only identical/newer may overwrite — stale and diverged never touch the local body', () => {
    expect(mayOverwriteLocal('identical')).toBe(true)
    expect(mayOverwriteLocal('incoming-newer')).toBe(true)
    expect(mayOverwriteLocal('incoming-stale')).toBe(false)
    expect(mayOverwriteLocal('diverged')).toBe(false)
  })
})
