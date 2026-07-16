// The per-month master ledger (spec §A3.1) — merge-safety + provenance attestation. PURE.
//
// Storage/IO lives in ledgerStore.ts; this module is the arithmetic, so the two rules that matter
// most — GROW-ONLY merge and the attestation chain — are unit-testable without a disk.

import { hashCanonical } from '../provenance/hash'
import type { LedgerAttestation, MonthLedger, SessionRow } from './types'
import { localDayOf } from './sessionLogic'

/** The ledger's document name for a local month ('YYYY-MM') — e.g. `inkwave-ledger-2026-07`. */
export function ledgerNameFor(month: string): string {
  return `inkwave-ledger-${month}`
}

export function emptyLedger(month: string): MonthLedger {
  return { v: 1, month, rows: [], attestations: [] }
}

// ─── Merge-safety (§A9) ──────────────────────────────────────────────────────

/**
 * Union two row sets — GROW-ONLY, keyed by `session_id`.
 *
 * The ledger lives in the writer's own cloud sync, so two devices can append concurrently. Rows are
 * append-only; a write-back must NEVER shrink the target just because this device's copy is
 * momentarily short (a fresh sign-in, cleared site data, a save racing a restore). CLAUDE.md
 * documents the real 2026-07-05 incident where exactly that truncated the snapshot archive — the
 * ledger inherits the invariant: every write-back unions with the target's existing rows FIRST.
 *
 * LAST-WRITER-WINS APPLIES ONLY WITHIN ONE session_id (§A9). Two devices cannot legitimately hold
 * different rows for the same session, so on an id clash we take the LATER-ENDING row: a session is
 * only ever extended (an idle close can be superseded by a later close of the same session), so the
 * later `end` is the more complete record. Ties break deterministically on `edit_events` then on the
 * incoming row, so the merge is confluent — merge(a,b) and merge(b,a) agree on content.
 */
export function mergeLedgerRows(a: readonly SessionRow[], b: readonly SessionRow[]): SessionRow[] {
  const byId = new Map<string, SessionRow>()
  for (const r of a) if (r && r.session_id) byId.set(r.session_id, r)
  for (const r of b) {
    if (!r || !r.session_id) continue
    const prev = byId.get(r.session_id)
    if (!prev || winsOver(r, prev)) byId.set(r.session_id, r)
  }
  // Sort by start, then session_id — a total order, so two devices that merged the same rows in a
  // different arrival order still serialise (and therefore HASH) identically.
  return [...byId.values()].sort((x, y) =>
    x.start < y.start ? -1 : x.start > y.start ? 1 : x.session_id < y.session_id ? -1 : x.session_id > y.session_id ? 1 : 0,
  )
}

/**
 * The same-session tie-break. Later `end` wins (a session is only ever extended). On an equal end,
 * the RICHER row wins — more edit events, then a row carrying the writer's note/place over one that
 * doesn't. That last clause is load-bearing: annotating a session with a diary note does NOT change
 * its `end`, so without it a plain copy of the row syncing in from another device could silently
 * erase a note the writer had just written.
 */
function winsOver(next: SessionRow, prev: SessionRow): boolean {
  if (next.end !== prev.end) return next.end > prev.end
  if (next.edit_events !== prev.edit_events) return next.edit_events > prev.edit_events
  return annotationScore(next) >= annotationScore(prev)
}

const annotationScore = (r: SessionRow): number => (r.note ? 1 : 0) + (r.place ? 1 : 0)

/** Union a whole ledger with another copy of the same month (the write-back path). */
export function mergeLedgers(target: MonthLedger, local: MonthLedger): MonthLedger {
  return { v: 1, month: local.month, rows: mergeLedgerRows(target.rows, local.rows), attestations: [] }
}

// ─── Provenance attestation (§A3.1) ──────────────────────────────────────────
// Each daily block hashes into a chain, so the ledger is tamper-evident and OTS-anchorable. This
// reuses the existing spine's hashing (RFC 8785 JCS + SHA-256, provenance/hash.ts) — deliberately
// NOT a parallel mechanism. Anchoring is provenance/ots.ts, driven by ledgerStore.

/**
 * Recompute every daily attestation block from `rows` — deterministic, so any verifier (or a future
 * device) rebuilds it byte-identically from the rows alone.
 *
 * `existing` supplies OTS proofs to CARRY OVER: a proof is kept only when that day's blockHash is
 * unchanged, so an anchored day survives appends to OTHER days (the multi-device case), while a day
 * that gained or lost a row correctly loses its stale anchor — the old proof attests content that
 * block no longer has.
 */
export async function buildAttestations(
  month: string,
  rows: readonly SessionRow[],
  existing: readonly LedgerAttestation[] = [],
): Promise<LedgerAttestation[]> {
  const byDay = new Map<string, SessionRow[]>()
  for (const r of rows) {
    const day = localDayOf(r.start)
    const list = byDay.get(day)
    if (list) list.push(r)
    else byDay.set(day, [r])
  }
  const priorByDay = new Map(existing.map((a) => [a.day, a]))

  const out: LedgerAttestation[] = []
  for (const day of [...byDay.keys()].sort()) {
    const rowHashes = await Promise.all(byDay.get(day)!.map((r) => hashCanonical(r)))
    // Bound to month + day: a block cannot be lifted into another month or another date.
    const blockHash = await hashCanonical({ v: 1, month, day, rowHashes })
    const prior = priorByDay.get(day)
    out.push({
      v: 1,
      day,
      rowHashes,
      blockHash,
      // Carry the proof ONLY if it attests this exact block; otherwise the day is unstamped again.
      ots: prior && prior.blockHash === blockHash ? prior.ots : { status: 'unstamped' },
    })
  }
  return out
}

/** Rebuild `attestations` from `rows` (preserving still-valid OTS proofs). The write path's last step. */
export async function attestLedger(l: MonthLedger): Promise<MonthLedger> {
  return { ...l, attestations: await buildAttestations(l.month, l.rows, l.attestations) }
}

export interface LedgerVerifyReport {
  ok: boolean
  /** Days whose recomputed blockHash does not match the stored one (rows altered/added/removed). */
  badDays: string[]
  /** Days that have rows but no attestation block at all (the block was dropped). */
  missingBlocks: string[]
  blocks: number
}

/**
 * Verify the ledger is internally consistent: every day's rows still hash to its stored blockHash.
 * Tamper-evidence — a row edited, added or dropped after the fact fails here, and an OTS-anchored
 * blockHash additionally pins that day's rows to a Bitcoin time (so they cannot be backdated).
 */
export async function verifyLedger(l: MonthLedger): Promise<LedgerVerifyReport> {
  const recomputed = await buildAttestations(l.month, l.rows, [])
  const badDays: string[] = []
  const missingBlocks: string[] = []
  const storedByDay = new Map(l.attestations.map((a) => [a.day, a]))

  for (const r of recomputed) {
    const stored = storedByDay.get(r.day)
    if (!stored) missingBlocks.push(r.day)
    else if (stored.blockHash !== r.blockHash) badDays.push(r.day)
  }
  // A stored block whose day no longer has any rows = the day's rows were removed wholesale.
  for (const s of l.attestations) if (!recomputed.some((r) => r.day === s.day)) badDays.push(s.day)

  return { ok: badDays.length === 0 && missingBlocks.length === 0, badDays, missingBlocks, blocks: recomputed.length }
}
