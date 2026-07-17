// A FAILED LOCAL READ MUST NEVER DESTROY THE MONTH — the 2026-07-15 shape in the ledger's own store.
//
// `loadLedger` read through `readAppJson`, which answers `null` to BOTH "no ledger yet" and "the disk
// just failed". Every writer here is a read-modify-WRITE, so the lie was destructive: `flushMonth`
// unions against what it read and would write the buffered rows ALONE over a real month — its own
// comment says "Union first, always — never write `rows` alone" — and `saveReflection` would write a
// 0-row ledger, so SAVING A REFLECTION ERASED THE SESSIONS IT WAS ABOUT. One transient failure, no
// race required.
//
// These tests drive the REAL store (real debounce chain, real merge, real attest) against an OPFS
// whose read can be made to fail, and assert the one thing that matters: THE FILE ON DISK IS
// UNCHANGED. They assert the disk, not the return value — a writer that "handled" the error and
// still wrote is exactly the bug.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonthLedger, SessionRow } from './types'

const MONTH = '2026-07'
const FILE = `inkwave-ledger-${MONTH}.json`

// The fake disk. `failRead` makes reads THROW the way a real transient OPFS failure does — which is
// exactly what `readAppJsonStrict` propagates and `readAppJson` used to swallow.
const disk = new Map<string, unknown>()
let failRead = false

vi.mock('../storage/opfs', () => ({
  readAppJsonStrict: async (name: string) => {
    if (failRead) throw new Error('OPFS read failed (transient)')
    return disk.has(name) ? structuredClone(disk.get(name)) : null
  },
  readAppJson: async (name: string) => (disk.has(name) ? structuredClone(disk.get(name)) : null),
  writeAppJson: async (name: string, data: unknown) => { disk.set(name, structuredClone(data)) },
}))
vi.mock('../provenance/ots', () => ({ stampBundle: async () => null, upgradeProof: async () => null }))

function row(id: string, start: string): SessionRow {
  return {
    session_id: id, doc_id: 'd1', start, end: start, active_minutes: 10,
    words_start: 0, words_end: 100, words_added: 100, words_deleted: 0, net_words: 100,
    edit_events: 50, break_before_min: 0, pomodoro: false, doc_type: 'essay', entered: 'timer',
  }
}
const A = row('a', '2026-07-17T09:00:00.000+10:00')
const B = row('b', '2026-07-17T11:00:00.000+10:00')

const rowsOnDisk = (): string[] => ((disk.get(FILE) as MonthLedger | undefined)?.rows ?? []).map(r => r.session_id).sort()

beforeEach(async () => {
  disk.clear()
  failRead = false
  vi.resetModules()
  const { _resetLedgerStore } = await import('./ledgerStore')
  _resetLedgerStore()
})

/** Seed a REAL month by driving the real write path, then make the next read fail. */
async function seedRealMonth(): Promise<void> {
  const { queueRow, flushLedgerNow, _resetLedgerStore } = await import('./ledgerStore')
  queueRow(MONTH, A)
  queueRow(MONTH, B)
  await flushLedgerNow()
  expect(rowsOnDisk()).toEqual(['a', 'b']) // the month is genuinely there before we break the read
  _resetLedgerStore()
}

describe('loadLedger — a failed read is not an empty ledger', () => {
  it('THROWS on a failed read rather than reporting an empty month', async () => {
    await seedRealMonth()
    failRead = true
    const { loadLedger } = await import('./ledgerStore')
    await expect(loadLedger(MONTH)).rejects.toThrow()
  })

  it('an ABSENT file is still an empty ledger — so the refusal above discriminates', async () => {
    // Without this, "it throws" would pass on a store that could never read anything at all.
    const { loadLedger } = await import('./ledgerStore')
    const l = await loadLedger(MONTH)
    expect(l.rows).toEqual([])
  })

  it('a PRESENT but unrecognised ledger THROWS — an older build must not flatten a newer one', async () => {
    // parseRemoteLedger has always called this an error for the REMOTE copy. The local copy read it
    // as empty and overwrote it — the far copy guarded, the near one not.
    disk.set(FILE, { v: 2, month: MONTH, rows: [{ session_id: 'x' }], somethingNew: true })
    const { loadLedger } = await import('./ledgerStore')
    await expect(loadLedger(MONTH)).rejects.toThrow(/unrecognised/)
  })
})

describe('the writers refuse rather than destroy', () => {
  // ─── THE LOAD-BEARING TEST ───────────────────────────────────────────────
  it('flushMonth does NOT write the buffered rows alone over a real month', async () => {
    await seedRealMonth()
    failRead = true
    const { queueRow, flushLedgerNow } = await import('./ledgerStore')
    queueRow(MONTH, row('c', '2026-07-17T13:00:00.000+10:00'))
    await flushLedgerNow()
    // The month is UNTOUCHED. The bug wrote ['c'] here, destroying a and b.
    expect(rowsOnDisk()).toEqual(['a', 'b'])
  })

  it('the rows are RETAINED and land once the read recovers (the recovery already existed)', async () => {
    // flushMonth's catch has always said "A failed write must not lose the rows — put them back for
    // the next flush." It was written for a failure the read swallowed before it could ever see it.
    await seedRealMonth()
    failRead = true
    const { queueRow, flushLedgerNow, hasPendingRows } = await import('./ledgerStore')
    queueRow(MONTH, row('c', '2026-07-17T13:00:00.000+10:00'))
    await flushLedgerNow()
    expect(hasPendingRows()).toBe(true) // not lost — waiting
    failRead = false
    await flushLedgerNow()
    expect(rowsOnDisk()).toEqual(['a', 'b', 'c']) // grow-only: the union, not the replacement
  })

  it('saveReflection does NOT erase the month it belongs to', async () => {
    await seedRealMonth()
    failRead = true
    const { saveReflection } = await import('./ledgerStore')
    await saveReflection(MONTH, { reflection_id: 'r1', day: '2026-07-17', text: 'good day' } as never)
    expect(rowsOnDisk()).toEqual(['a', 'b']) // the bug wrote a 0-row ledger here
  })

  it('mergeIntoLocalLedger does not replace local with the incoming copy', async () => {
    // The sync heal: a failed local read made `local` empty, so the union was the REMOTE alone and
    // this device's unsynced rows were overwritten with it.
    await seedRealMonth()
    failRead = true
    const { mergeIntoLocalLedger } = await import('./ledgerStore')
    const incoming: MonthLedger = { v: 1, month: MONTH, rows: [row('z', '2026-07-17T15:00:00.000+10:00')], attestations: [] }
    await mergeIntoLocalLedger(MONTH, incoming)
    expect(rowsOnDisk()).toEqual(['a', 'b'])
  })
})

describe('the ordinary paths still work — the guard is not an outage', () => {
  it('a healthy flush unions into the month', async () => {
    await seedRealMonth()
    const { queueRow, flushLedgerNow } = await import('./ledgerStore')
    queueRow(MONTH, row('c', '2026-07-17T13:00:00.000+10:00'))
    await flushLedgerNow()
    expect(rowsOnDisk()).toEqual(['a', 'b', 'c'])
  })

  it('a first-ever month writes from absent', async () => {
    const { queueRow, flushLedgerNow } = await import('./ledgerStore')
    queueRow(MONTH, A)
    await flushLedgerNow()
    expect(rowsOnDisk()).toEqual(['a'])
  })
})
