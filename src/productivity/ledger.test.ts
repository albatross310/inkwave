import { describe, expect, it } from 'vitest'
import { attestLedger, buildAttestations, ledgerNameFor, mergeLedgerRows, verifyLedger } from './ledger'
import { LEDGER_PRIVATE_FIELDS, stripPrivateFields } from './types'
import type { MonthLedger, SessionRow } from './types'

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
    ...over,
  }
}

const A = row('a', '2026-07-17T09:00:00.000+10:00', { end: '2026-07-17T09:30:00.000+10:00' })
const B = row('b', '2026-07-17T11:00:00.000+10:00', { end: '2026-07-17T11:30:00.000+10:00' })
const C = row('c', '2026-07-18T09:00:00.000+10:00', { end: '2026-07-18T09:30:00.000+10:00' })

describe('ledgerNameFor', () => {
  it('names the per-month ledger as specced (§A3.1)', () => {
    expect(ledgerNameFor('2026-07')).toBe('inkwave-ledger-2026-07')
  })
})

describe('mergeLedgerRows — GROW-ONLY (§A9; the 2026-07-05 truncation incident)', () => {
  it('unions rows from two devices', () => {
    expect(mergeLedgerRows([A], [B]).map((r) => r.session_id)).toEqual(['a', 'b'])
  })

  it('A SHORT LOCAL SET CAN NEVER TRUNCATE THE TARGET — the incident, re-run', () => {
    // Device 2 (fresh sign-in) holds one row; the synced target holds three. A naive write-back
    // would leave one. The union must leave three.
    const target = [A, B, C]
    const freshDevice = [row('new', '2026-07-18T14:00:00.000+10:00')]
    const merged = mergeLedgerRows(target, freshDevice)
    expect(merged).toHaveLength(4)
    expect(merged.map((r) => r.session_id).sort()).toEqual(['a', 'b', 'c', 'new'])
    // PROVE THE NEGATIVE FIRES: the thing being prevented is real — writing the fresh device's rows
    // alone loses three sessions. If this assertion ever failed, the test above would be vacuous.
    expect(freshDevice).toHaveLength(1)
    expect(freshDevice.map((r) => r.session_id)).not.toContain('a')
  })

  it('an EMPTY incoming set cannot empty the ledger', () => {
    expect(mergeLedgerRows([A, B], [])).toHaveLength(2)
    expect(mergeLedgerRows([], [A, B])).toHaveLength(2)
  })

  it('last-writer-wins ONLY within one session_id: the later end wins', () => {
    const early = row('a', A.start, { end: '2026-07-17T09:30:00.000+10:00', edit_events: 10 })
    const later = row('a', A.start, { end: '2026-07-17T09:45:00.000+10:00', edit_events: 25 })
    expect(mergeLedgerRows([early], [later])[0].end).toBe(later.end)
    // ...and the direction of the merge does not decide it — the later end wins either way.
    expect(mergeLedgerRows([later], [early])[0].end).toBe(later.end)
    expect(mergeLedgerRows([later], [early])).toHaveLength(1) // never duplicated
  })

  it('LWW never leaks across sessions — a newer row cannot evict a DIFFERENT session', () => {
    const merged = mergeLedgerRows([A], [row('z', '2026-07-19T09:00:00.000+10:00')])
    expect(merged.map((r) => r.session_id).sort()).toEqual(['a', 'z'])
  })

  it('is confluent: two devices merging in opposite orders agree exactly', () => {
    const d1 = mergeLedgerRows(mergeLedgerRows([A], [B]), [C])
    const d2 = mergeLedgerRows(mergeLedgerRows([C], [B]), [A])
    expect(d1).toEqual(d2)
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2)) // identical serialisation ⇒ identical hashes
  })

  it('drops malformed rows rather than poisoning the ledger', () => {
    const bad = [null, undefined, {}] as unknown as SessionRow[]
    expect(mergeLedgerRows([A], bad)).toEqual([A])
  })

  it('A SYNCING PLAIN COPY CANNOT ERASE A DIARY NOTE — annotation does not change `end`', () => {
    // Device A writes a note on session `a`; device B still holds the plain row. Same session_id,
    // same end, same edit_events: without the richness tie-break the plain copy could win and the
    // writer's note would silently vanish on the next sync.
    const annotated = { ...A, note: 'finally cracked the Leibniz section', place: 'library' }
    expect(mergeLedgerRows([A], [annotated])[0].note).toBe('finally cracked the Leibniz section')
    expect(mergeLedgerRows([annotated], [A])[0].note).toBe('finally cracked the Leibniz section')
    expect(mergeLedgerRows([annotated], [A])[0].place).toBe('library')
    // PROVE THE NEGATIVE FIRES: the plain row genuinely lacks the note, so a merge that preferred
    // it would lose data. If this ever failed, the assertions above would be vacuous.
    expect('note' in A).toBe(false)
  })

  it('a LATER end still wins over a richer-but-older row (extension beats annotation)', () => {
    const annotated = { ...A, note: 'a note' }
    const extended = { ...A, end: '2026-07-17T09:45:00.000+10:00', edit_events: 99 }
    expect(mergeLedgerRows([annotated], [extended])[0].end).toBe(extended.end)
  })
})

describe('stripPrivateFields (§A7.3 — the AI-export seam)', () => {
  it('removes the user-authored fields entirely, leaving no trace', () => {
    const r: SessionRow = { ...A, note: 'felt scattered today', place: 'home' }
    const pub = stripPrivateFields(r)
    expect('note' in pub).toBe(false)
    expect('place' in pub).toBe(false)
    const blob = JSON.stringify(pub)
    expect(blob).not.toContain('scattered')
    expect(blob).not.toContain('home')
    // ...while every MEASURED field survives — this is a filter, not a redaction of the work.
    expect(pub.session_id).toBe('a')
    expect(pub.active_minutes).toBe(10)
    expect(pub.words_added).toBe(100)
  })

  it('is a no-op on a row that never had them', () => {
    expect(stripPrivateFields(A)).toEqual(A)
  })

  it('names exactly the fields it strips (the contract the AI-report path reads)', () => {
    expect([...LEDGER_PRIVATE_FIELDS]).toEqual(['note', 'place'])
  })
})

describe('attestation chain (§A3.1 — tamper-evident, OTS-anchorable)', () => {
  const ledger = (rows: SessionRow[]): MonthLedger => ({ v: 1, month: '2026-07', rows, attestations: [] })

  it('builds one block per LOCAL day', async () => {
    const blocks = await buildAttestations('2026-07', [A, B, C])
    expect(blocks.map((b) => b.day)).toEqual(['2026-07-17', '2026-07-18'])
    expect(blocks[0].rowHashes).toHaveLength(2) // A + B are the same local day
    expect(blocks[1].rowHashes).toHaveLength(1)
  })

  it('binds a block to its DAY — a block cannot be replayed onto another date', async () => {
    const d17 = await buildAttestations('2026-07', [A])
    const moved = await buildAttestations('2026-07', [{ ...A, start: C.start, end: C.end }])
    expect(moved[0].day).toBe('2026-07-18')
    expect(moved[0].blockHash).not.toBe(d17[0].blockHash)
  })

  it('is deterministic — the same rows rebuild the same hashes', async () => {
    expect(await buildAttestations('2026-07', [A, B])).toEqual(await buildAttestations('2026-07', [A, B]))
  })

  it('binds blocks to their month — a block cannot be replayed into another month', async () => {
    const jul = await buildAttestations('2026-07', [A])
    const aug = await buildAttestations('2026-08', [A])
    expect(jul[0].blockHash).not.toBe(aug[0].blockHash)
  })

  it('verifies a clean ledger (the negative is NOT always-true)', async () => {
    const rep = await verifyLedger(await attestLedger(ledger([A, B, C])))
    expect(rep.ok).toBe(true)
    expect(rep.badDays).toEqual([])
    expect(rep.blocks).toBe(2)
  })

  it('CATCHES a tampered row — the whole point of attesting', async () => {
    const l = await attestLedger(ledger([A, B, C]))
    // Someone inflates a session's word count after the fact.
    l.rows = l.rows.map((r) => (r.session_id === 'a' ? { ...r, words_end: 99_999 } : r))
    const rep = await verifyLedger(l)
    expect(rep.ok).toBe(false)
    expect(rep.badDays).toContain('2026-07-17')
  })

  it('CATCHES a removed row', async () => {
    const l = await attestLedger(ledger([A, B, C]))
    l.rows = l.rows.filter((r) => r.session_id !== 'b')
    expect((await verifyLedger(l)).ok).toBe(false)
  })

  it('CATCHES a whole removed day', async () => {
    const l = await attestLedger(ledger([A, B, C]))
    l.rows = l.rows.filter((r) => r.session_id !== 'c')
    const rep = await verifyLedger(l)
    expect(rep.ok).toBe(false)
    expect(rep.badDays).toContain('2026-07-18')
  })

  it('an OTS proof survives an append to a DIFFERENT day, and is dropped from a CHANGED day', async () => {
    const l = await attestLedger(ledger([A, C]))
    // Pretend both days got anchored.
    l.attestations = l.attestations.map((a) => ({ ...a, ots: { status: 'pending', proofBase64: `proof-${a.day}` } as const }))
    const day17 = l.attestations.find((a) => a.day === '2026-07-17')!.blockHash

    // A new row lands on the 17th only.
    const next = await attestLedger({ ...l, rows: mergeLedgerRows(l.rows, [B]) })
    const a17 = next.attestations.find((a) => a.day === '2026-07-17')!
    const a18 = next.attestations.find((a) => a.day === '2026-07-18')!

    expect(a17.blockHash).not.toBe(day17) // the 17th changed...
    expect(a17.ots.status).toBe('unstamped') // ...so its stale proof is correctly dropped
    // PROVE THE CARRY-OVER IS REAL (not "everything just gets dropped"): the 18th is untouched, so
    // its Bitcoin anchor must survive. Without this, the assertion above would be vacuous.
    expect(a18.ots.status).toBe('pending')
    expect(a18.ots.proofBase64).toBe('proof-2026-07-18')
  })

  it('A LATE APPEND TO AN EARLIER DAY LEAVES LATER DAYS ANCHORED — why days are not chained', async () => {
    // The multi-device case (§A9): a phone syncs in a row for the 17th on the 19th. Under a
    // cross-day prevHash chain this would invalidate the 18th and 19th and force a re-stamp of the
    // whole month. Independent daily blocks must leave them untouched.
    const D = row('d', '2026-07-19T09:00:00.000+10:00')
    const l = await attestLedger(ledger([A, C, D]))
    l.attestations = l.attestations.map((a) => ({ ...a, ots: { status: 'confirmed', bitcoinBlock: 900_000 } as const }))
    const before = new Map(l.attestations.map((a) => [a.day, a.blockHash]))

    const late = await attestLedger({ ...l, rows: mergeLedgerRows(l.rows, [B]) }) // B lands on the 17th
    const byDay = new Map(late.attestations.map((a) => [a.day, a]))

    expect(byDay.get('2026-07-17')!.blockHash).not.toBe(before.get('2026-07-17')) // the 17th changed
    expect(byDay.get('2026-07-17')!.ots.status).toBe('unstamped')
    for (const day of ['2026-07-18', '2026-07-19']) {
      expect(byDay.get(day)!.blockHash).toBe(before.get(day)) // untouched...
      expect(byDay.get(day)!.ots.status).toBe('confirmed') // ...and still anchored to Bitcoin
    }
  })

  it('re-attesting an unchanged ledger preserves every proof', async () => {
    const l = await attestLedger(ledger([A, C]))
    l.attestations = l.attestations.map((a) => ({ ...a, ots: { status: 'confirmed', bitcoinBlock: 1 } as const }))
    const again = await attestLedger(l)
    expect(again.attestations.every((a) => a.ots.status === 'confirmed')).toBe(true)
  })
})
