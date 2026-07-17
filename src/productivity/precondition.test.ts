// Finding E — the write PRECONDITION. The half that can be tested without a Microsoft account.
//
// The bug: READ-MERGE-WRITE reconciles against what it READ, then PUTs unconditionally. Two devices
// (Peter syncs an iPhone and a desktop) interleaving:
//
//     A reads {R} · B reads {R} · A writes {R ∪ localA} · B writes {R ∪ localB}   ← A's rows GONE
//
// Both merges are honest; rows are still lost, because each merged against a version that moved. The
// same window makes the 404 dangerous the other way: absent → create → clobbers a file made in flight.
//
// What is testable here is the DECISION (which precondition a read implies, and its Graph wire form).
// Whether Graph HONOURS it is STATED, NOT PROBED — see putFile. That split is deliberate: test what
// you can actually observe, and say plainly what you cannot.

import { describe, it, expect } from 'vitest'
import { preconditionFor, type RemoteRead } from './ledgerSync'
import { graphWriteOptions } from '../storage/onedrive'
import type { MonthLedger } from './types'

const ledger: MonthLedger = { v: 1, month: '2026-07', rows: [], attestations: [] }

describe('preconditionFor — the write pins what the read saw', () => {
  // THE LOAD-BEARING PAIR. A 404 must demand the file still not exist; anything weaker is a create
  // that can clobber. This is Finding E in one assertion.
  it('a 404 (absent) demands the file STILL not exist', () => {
    expect(preconditionFor({ status: 'absent' })).toEqual({ expect: 'absent' })
  })

  it('a read with a version demands that version is UNCHANGED', () => {
    const read: RemoteRead = { status: 'ok', ledger, etag: 'W/"v7"' }
    expect(preconditionFor(read)).toEqual({ expect: 'unchanged', etag: 'W/"v7"' })
  })

  // The honest degradation, and its BOUNDARY: only a read that genuinely returned no version may
  // produce 'any'. An absence must never reach it — that is exactly the unguarded create.
  it('a read with NO version degrades to unguarded, and says so', () => {
    expect(preconditionFor({ status: 'ok', ledger, etag: null })).toEqual({ expect: 'any' })
  })

  it("'absent' NEVER degrades to 'any' — the whole of Finding E", () => {
    // conflictBehavior=fail needs no etag, so a missing version can never excuse an unpinned create.
    expect(preconditionFor({ status: 'absent' }).expect).toBe('absent')
  })

  it('an empty etag string is treated as no version (never If-Match: "")', () => {
    // An If-Match of '' is not a weaker guard, it is a malformed request that would fail every write.
    expect(preconditionFor({ status: 'ok', ledger, etag: '' })).toEqual({ expect: 'any' })
  })
})

describe('graphWriteOptions — the wire form', () => {
  it("'absent' becomes conflictBehavior=fail (create-only)", () => {
    const { query, headers } = graphWriteOptions({ expect: 'absent' })
    expect(query).toContain('conflictBehavior=fail')
    expect(headers['If-Match']).toBeUndefined() // there is no version to match on a create
  })

  it("'unchanged' becomes If-Match", () => {
    const { query, headers } = graphWriteOptions({ expect: 'unchanged', etag: 'W/"v7"' })
    expect(headers['If-Match']).toBe('W/"v7"')
    expect(query).toBe('') // never both: conflictBehavior=fail would reject the update outright
  })

  it("'any' sends no precondition — the pre-existing posture, reachable only from a null etag", () => {
    expect(graphWriteOptions({ expect: 'any' })).toEqual({ query: '', headers: {} })
  })

  // A precondition that never reaches the wire is decoration. This is the pair that proves the two
  // guarded arms are DISTINGUISHABLE from the unguarded one — without it, a mutant returning a bare
  // {query:'',headers:{}} for everything would pass the two tests above by accident of shape.
  it('both guarded arms differ from the unguarded one', () => {
    const none = JSON.stringify(graphWriteOptions({ expect: 'any' }))
    expect(JSON.stringify(graphWriteOptions({ expect: 'absent' }))).not.toBe(none)
    expect(JSON.stringify(graphWriteOptions({ expect: 'unchanged', etag: 'x' }))).not.toBe(none)
  })
})
