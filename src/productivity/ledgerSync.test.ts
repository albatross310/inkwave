// Ledger cloud sync — the 2026-07-15 shape, tested.
//
// The bug that cost Peter real thesis work was a write that did not first reconcile with what it
// was about to replace. These tests exist to make that unrepresentable here, so most of them are
// about what sync REFUSES to do.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attestLedger, emptyLedger } from './ledger'
import { _resetLedgerStore, loadLedger } from './ledgerStore'
import { ledgerFileName, parseRemoteLedger, syncLedgerMonth, type LedgerRemote, type RemoteRead } from './ledgerSync'
import type { MonthLedger, SessionRow } from './types'

const MONTH = '2026-07'

function row(id: string, start: string, over: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: id,
    doc_id: 'd1',
    start,
    end: start,
    active_minutes: 10,
    words_start: 0,
    words_end: 100,
    words_added: 100,
    words_deleted: 0,
    net_words: 100,
    edit_events: 50,
    break_before_min: 0,
    pomodoro: false,
    doc_type: 'essay',
    entered: 'timer',
    ...over,
  }
}

const A = row('a', '2026-07-17T09:00:00.000+10:00')
const B = row('b', '2026-07-17T11:00:00.000+10:00')
const C = row('c', '2026-07-18T09:00:00.000+10:00')

const ledgerOf = (rows: SessionRow[]): Promise<MonthLedger> =>
  attestLedger({ v: 1, month: MONTH, rows, attestations: [] })

// ── An in-memory OPFS for the local half ─────────────────────────────────────
// storage/opfs's readAppJson/writeAppJson are the local store; stub them so the test drives the
// REAL ledgerStore chain (queue → merge → attest → write) rather than a fiction.
const disk = new Map<string, unknown>()
vi.mock('../storage/opfs', () => ({
  readAppJson: async (name: string) => (disk.has(name) ? structuredClone(disk.get(name)) : null),
  writeAppJson: async (name: string, data: unknown) => { disk.set(name, structuredClone(data)) },
}))
// Never let a test reach the OTS relay.
vi.mock('../provenance/ots', () => ({ stampBundle: async () => null, upgradeProof: async () => null }))

/** A scriptable remote that RECORDS every write, so "it never wrote" is assertable. */
function fakeRemote(read: () => Promise<RemoteRead>, writeOk = true) {
  const writes: MonthLedger[] = []
  const remote: LedgerRemote = {
    name: 'fake',
    read,
    async write(_f, l) { writes.push(structuredClone(l)); return writeOk },
  }
  return { remote, writes }
}

async function seedLocal(rows: SessionRow[]): Promise<void> {
  disk.set(ledgerFileName(MONTH), await ledgerOf(rows))
}

beforeEach(() => {
  disk.clear()
  _resetLedgerStore()
})

describe('parseRemoteLedger — a bad read is an ERROR, never an empty ledger', () => {
  it('parses a good ledger', async () => {
    const res = parseRemoteLedger(JSON.stringify(await ledgerOf([A])), MONTH)
    expect(res.status).toBe('ok')
    if (res.status === 'ok') expect(res.ledger.rows).toHaveLength(1)
  })

  it('TRUNCATED JSON is an error — the single most dangerous misreading', () => {
    // If this returned an empty ledger, the next write would replace a real remote with ours.
    const res = parseRemoteLedger('{"v":1,"month":"2026-07","rows":[{"sess', MONTH)
    expect(res.status).toBe('error')
  })

  it('a wrong-shaped body is an error, not an empty ledger', () => {
    expect(parseRemoteLedger('null', MONTH).status).toBe('error')
    expect(parseRemoteLedger('{"hello":"world"}', MONTH).status).toBe('error')
    expect(parseRemoteLedger('[]', MONTH).status).toBe('error')
  })

  it('a ledger for the WRONG MONTH is an error — never merged into this one', async () => {
    const other = await attestLedger({ v: 1, month: '2026-06', rows: [A], attestations: [] })
    const res = parseRemoteLedger(JSON.stringify(other), MONTH)
    expect(res.status).toBe('error')
  })
})

describe('syncLedgerMonth — READ-MERGE-WRITE', () => {
  it('unions both sides and writes the union', async () => {
    await seedLocal([A, B])
    const { remote, writes } = fakeRemote(async () => ({ status: 'ok', ledger: await ledgerOf([C]) }))

    const out = await syncLedgerMonth(remote, MONTH)
    expect(out).toMatchObject({ ok: true, action: 'wrote', rows: 3 })
    expect(writes).toHaveLength(1)
    expect(writes[0].rows.map((r) => r.session_id)).toEqual(['a', 'b', 'c'])

    // ...and the LOCAL copy is healed with the remote's row.
    expect((await loadLedger(MONTH)).rows.map((r) => r.session_id)).toEqual(['a', 'b', 'c'])
  })

  it('a FAILED READ WRITES NOTHING — the 2026-07-15 branch', async () => {
    // The remote holds three sessions; this device holds one. If a failed read were treated as an
    // empty remote, this write would destroy two of Peter's sessions.
    await seedLocal([A])
    const { remote, writes } = fakeRemote(async () => ({ status: 'error', reason: 'network down' }))

    const out = await syncLedgerMonth(remote, MONTH)
    expect(out.ok).toBe(false)
    expect(writes).toEqual([]) // ← the whole point
    if (!out.ok) expect(out.reason).toContain('network down')
    // Local is untouched and still safe.
    expect((await loadLedger(MONTH)).rows).toHaveLength(1)
  })

  it('an ABSENT remote (first sync) IS written — so the refusal above is not just "never writes"', async () => {
    // PROVE THE NEGATIVE DISCRIMINATES. Without this, the test above would pass on a sync that
    // never wrote anything at all.
    await seedLocal([A, B])
    const { remote, writes } = fakeRemote(async () => ({ status: 'absent' }))

    const out = await syncLedgerMonth(remote, MONTH)
    expect(out).toMatchObject({ ok: true, action: 'wrote' })
    expect(writes).toHaveLength(1)
    expect(writes[0].rows).toHaveLength(2)
  })

  it('A SHORT LOCAL CANNOT TRUNCATE A LONG REMOTE — grow-only across devices', async () => {
    // The fresh-device case: this browser has one row, the remote has three.
    await seedLocal([A])
    const { remote, writes } = fakeRemote(async () => ({ status: 'ok', ledger: await ledgerOf([A, B, C]) }))

    const out = await syncLedgerMonth(remote, MONTH)
    expect(out.ok).toBe(true)
    // Whatever was written must be the UNION — never the short local set.
    if (writes.length) expect(writes[0].rows).toHaveLength(3)
    expect((await loadLedger(MONTH)).rows).toHaveLength(3) // local healed, not truncated
  })

  it('an EMPTY local (cleared site data) cannot wipe the remote', async () => {
    const { remote, writes } = fakeRemote(async () => ({ status: 'ok', ledger: await ledgerOf([A, B, C]) }))
    const out = await syncLedgerMonth(remote, MONTH)
    expect(out.ok).toBe(true)
    if (writes.length) expect(writes[0].rows).toHaveLength(3)
    expect((await loadLedger(MONTH)).rows).toHaveLength(3)
  })

  it('does not touch the remote when nothing changed', async () => {
    await seedLocal([A, B])
    const { remote, writes } = fakeRemote(async () => ({ status: 'ok', ledger: await ledgerOf([A, B]) }))
    const out = await syncLedgerMonth(remote, MONTH)
    expect(out).toMatchObject({ ok: true, action: 'up-to-date', rows: 2 })
    expect(writes).toEqual([]) // a no-op write is a chance to corrupt for nothing
  })

  it('a failed WRITE leaves local intact and says so', async () => {
    await seedLocal([A, B])
    const { remote } = fakeRemote(async () => ({ status: 'absent' }), false)
    const out = await syncLedgerMonth(remote, MONTH)
    expect(out.ok).toBe(false)
    expect((await loadLedger(MONTH)).rows).toHaveLength(2)
  })

  it('preserves the remote\'s Bitcoin anchor for a day this device never saw', async () => {
    await seedLocal([A])
    const anchored = await ledgerOf([C])
    anchored.attestations = anchored.attestations.map((a) => ({ ...a, ots: { status: 'confirmed', bitcoinBlock: 900_001 } as const }))
    const { remote, writes } = fakeRemote(async () => ({ status: 'ok', ledger: anchored }))

    await syncLedgerMonth(remote, MONTH)
    const day18 = writes[0].attestations.find((a) => a.day === '2026-07-18')
    expect(day18?.ots.status).toBe('confirmed') // F5 would have shredded this
  })

  it('a row written DURING the sync is not lost (the read-to-write gap)', async () => {
    await seedLocal([A])
    // The remote read resolves only after we have queued another local row — the interleaving that
    // a naive "load, then write what I loaded" would drop.
    const { remote } = fakeRemote(async () => {
      const { queueRow, flushLedgerNow } = await import('./ledgerStore')
      queueRow(MONTH, B)
      await flushLedgerNow()
      return { status: 'ok', ledger: await ledgerOf([C]) }
    })

    await syncLedgerMonth(remote, MONTH)
    // The local file must still hold B: mergeIntoLocalLedger re-reads INSIDE the write chain.
    const local = await loadLedger(MONTH)
    expect(local.rows.map((r) => r.session_id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('the ledger file is its own file, not part of the .studio', () => {
  it('is named per month', () => {
    expect(ledgerFileName('2026-07')).toBe('inkwave-ledger-2026-07.json')
  })

  it('an empty ledger round-trips through the remote parser', () => {
    const res = parseRemoteLedger(JSON.stringify(emptyLedger(MONTH)), MONTH)
    expect(res.status).toBe('ok')
  })
})
