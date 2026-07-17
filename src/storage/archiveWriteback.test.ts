// The guard that keeps "a failed read is not an empty remote" true in ~10ms, with no browser.
//
// WHY A UNIT TEST AND NOT A PROBE: the bug this pins is a LIVE data-loss path in the cloud sync of
// Peter's thesis, and CLAUDE.md's standing lesson is that a browser probe which ran once is
// indistinguishable, six weeks later, from one that never ran — the gate says green either way. The
// decision was extracted into a pure function precisely so the gate can hold it for free.
//
// THE MUTANTS THIS MUST KILL (each is a real line that shipped, or the "innocent" edit someone will
// one day make). Every one is asserted below to be reachable — a test that cannot feel the bug is
// decoration:
//   (a) `if (read.status === 'error') return { write: true, snapshots: local }`  ← the shipped bug
//   (b) treating 'error' as 'absent' (the 2026-07-15 collapse, relocated)
//   (c) dropping the union on 'ok' (`snapshots: local`)                          ← the 2026-07-05 shape
//   (d) merging the wrong way round in a way that loses the remote's rows

import { describe, it, expect } from 'vitest'
import { planWriteback, archiveSnapshotsOf, type ArchiveRead } from './archiveWriteback'
import type { Snapshot } from '../types/document'

const snap = (id: string, createdAt: string): Snapshot =>
  ({ id, createdAt, contentHash: `h-${id}`, receipts: [] } as unknown as Snapshot)

// A long archive on the remote and a SHORT local set — the exact 2026-07-05 truncation shape
// (fresh login / cleared data / a save racing ahead of restore).
const REMOTE = [snap('1', '2026-07-01T00:00:00Z'), snap('2', '2026-07-02T00:00:00Z'), snap('3', '2026-07-03T00:00:00Z')]
const LOCAL = [snap('4', '2026-07-04T00:00:00Z')]

const ids = (s: Snapshot[]) => s.map((x) => x.id).sort()

describe('planWriteback — a failed read is not an empty remote', () => {
  // ─── THE LOAD-BEARING TEST ────────────────────────────────────────────────
  // Mutant (a)/(b) die here. This is the whole finding: an unreadable remote must not be written.
  it('REFUSES TO WRITE when the archive could not be read', () => {
    const plan = planWriteback({ status: 'error', reason: 'Graph GET 500' }, LOCAL)
    expect(plan.write).toBe(false)
  })

  it('names the reason it refused (a silent skip is how this class hides)', () => {
    const plan = planWriteback({ status: 'error', reason: 'Graph GET 429' }, LOCAL)
    expect(plan).toMatchObject({ write: false })
    if (plan.write === false) expect(plan.reason).toContain('429')
  })

  // Each of these is a DIFFERENT real failure that the shipped code funnelled into "write local
  // as-is": a throttle, an expired token, a server fault, a corrupt body, an offline device.
  it.each([
    ['a 500 server fault', 'Graph GET 500'],
    ['a 429 throttle', 'Graph GET 429'],
    ['an expired token', 'not signed in'],
    ['a corrupt download', 'trace file is not valid JSON'],
    ['an offline device', 'network error'],
  ])('refuses on %s', (_label, reason) => {
    expect(planWriteback({ status: 'error', reason }, LOCAL).write).toBe(false)
  })

  // ─── The other two arms must still WORK, or the fix is just a disabled feature ──
  // A guard that refuses everything is not a guard; it is an outage. These are the positive
  // controls, and they are what stop the fix from being "never sync again".
  it('WRITES on a genuine absence — a first upload can lose nothing', () => {
    const plan = planWriteback({ status: 'absent' }, LOCAL)
    expect(plan).toMatchObject({ write: true })
    if (plan.write) expect(ids(plan.snapshots)).toEqual(['4'])
  })

  it('WRITES THE UNION when the remote was read — grow-only (mutant (c)/(d) die here)', () => {
    const plan = planWriteback({ status: 'ok', snapshots: REMOTE }, LOCAL)
    expect(plan).toMatchObject({ write: true })
    // The remote's three snapshots SURVIVE alongside the local one. Dropping the union, or
    // merging so the short side wins, loses ids 1-3 — the 2026-07-05 incident.
    if (plan.write) expect(ids(plan.snapshots)).toEqual(['1', '2', '3', '4'])
  })

  it('writes on an EMPTY read — an established emptiness is not a guess', () => {
    // The distinction that matters: `{status:'ok', snapshots:[]}` means we LOOKED and it was empty.
    // That licenses a write. `{status:'error'}` means we never found out, and does not.
    const plan = planWriteback({ status: 'ok', snapshots: [] }, LOCAL)
    expect(plan).toMatchObject({ write: true })
    if (plan.write) expect(ids(plan.snapshots)).toEqual(['4'])
  })

  // ─── The property, stated once ────────────────────────────────────────────
  it('never shrinks the archive on any readable outcome', () => {
    const readable: ArchiveRead[] = [{ status: 'ok', snapshots: REMOTE }, { status: 'absent' }]
    for (const read of readable) {
      const plan = planWriteback(read, LOCAL)
      if (!plan.write) throw new Error('a readable remote must be writable')
      const remoteRows = read.status === 'ok' ? read.snapshots.length : 0
      expect(plan.snapshots.length).toBeGreaterThanOrEqual(remoteRows)
    }
  })

  it('is PURE — it does not mutate the arrays it is handed', () => {
    const local = [...LOCAL]
    const remote = [...REMOTE]
    planWriteback({ status: 'ok', snapshots: remote }, local)
    expect(local).toHaveLength(1)
    expect(remote).toHaveLength(3)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// `archiveSnapshotsOf` — "the body parsed" is not "we know what the remote holds".
//
// PROBED (2026-07-17, `cloudWriteback.test.ts`): all three providers ended their read with
// `remote.snapshots ?? []`, and `parseTraceFile` is JSON.parse with no shape check — so a 200
// carrying `"just a string"` produced `{ status: 'ok', snapshots: [] }`, the one answer that
// licenses planWriteback to overwrite, and the local set went over a 4-snapshot archive.
describe('archiveSnapshotsOf — a parsed body is not an understood body', () => {
  const S = (id: string) => ({ id, createdAt: '2026-07-17T10:00:00.000Z' }) as unknown as Snapshot

  it('reads the archive out of a real record', () => {
    expect(archiveSnapshotsOf({ v: 1, snapshots: [S('a'), S('b')] })?.map((s) => s.id)).toEqual(['a', 'b'])
  })

  // THE OUTAGE DIRECTION, and it sets the predicate's floor: a record that has never been
  // snapshotted (and every pre-snapshot-era file) MUST read as an established emptiness, or the
  // guard refuses to sync to it forever.
  it('an ABSENT snapshots field is an established emptiness, not a refusal', () => {
    expect(archiveSnapshotsOf({ v: 1, document: {} })).toEqual([])
    expect(archiveSnapshotsOf({ v: 1, snapshots: null })).toEqual([])
    expect(archiveSnapshotsOf({ v: 1, snapshots: [] })).toEqual([])
  })

  // THE LOSS DIRECTION. Each of these is valid JSON that `parseTraceFile` returns happily.
  it.each([
    ['a string', '"just a string"'],
    ['a number', '42'],
    ['a boolean', 'true'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
  ])('REFUSES %s — it is not a record, and we established nothing', (_label, json) => {
    expect(archiveSnapshotsOf(JSON.parse(json))).toBeNull()
  })

  // The same hole one field down, and `?? []` cannot see it: a string is not nullish, so it passes
  // through, mergeSnapshots iterates its CHARACTERS, none has an `id`, and the union silently comes
  // out local-only — a truncation with no error anywhere.
  it('REFUSES a non-array snapshots field (?? [] passes a string straight through)', () => {
    expect(archiveSnapshotsOf({ v: 1, snapshots: 'nope' })).toBeNull()
    expect(archiveSnapshotsOf({ v: 1, snapshots: 7 })).toBeNull()
    expect(archiveSnapshotsOf({ v: 1, snapshots: { 0: S('a') } })).toBeNull()
  })

  it('the refusal reaches planWriteback as an ERROR, never an absence (the whole point)', () => {
    const snaps = archiveSnapshotsOf(JSON.parse('"just a string"'))
    expect(snaps).toBeNull()
    // What the adapters now do with it. The mistake it replaces was `{ status:'ok', snapshots: [] }`.
    const plan = planWriteback({ status: 'error', reason: 'not an Inkwave record' }, [S('local')])
    expect(plan.write).toBe(false)
  })
})
