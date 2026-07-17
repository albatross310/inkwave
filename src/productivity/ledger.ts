// The per-month master ledger (spec §A3.1) — merge-safety + provenance attestation. PURE.
//
// Storage/IO lives in ledgerStore.ts; this module is the arithmetic, so the two rules that matter
// most — GROW-ONLY merge and the attestation chain — are unit-testable without a disk.

import { hashCanonical } from '../provenance/hash'
import type { OtsProofState } from '../types/document'
import type { LedgerAttestation, MonthLedger, Reflection, SessionRow } from './types'
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

/**
 * Union two reflection sets — GROW-ONLY, keyed by `reflection_id`, exactly like rows.
 *
 * Same rule, same reason: two devices, an append-only record, and a write-back that must never
 * shrink the target. LWW within one id takes the RICHER copy (more categories commented on), so a
 * plain copy syncing in from another device cannot erase what the writer just wrote — the same
 * lesson the diary-note tie-break already paid for.
 */
export function mergeReflections(a: readonly Reflection[] = [], b: readonly Reflection[] = []): Reflection[] {
  const byId = new Map<string, Reflection>()
  for (const r of a) if (r && r.reflection_id) byId.set(r.reflection_id, r)
  for (const r of b) {
    if (!r || !r.reflection_id) continue
    const prev = byId.get(r.reflection_id)
    if (!prev || (r.notes?.length ?? 0) >= (prev.notes?.length ?? 0)) byId.set(r.reflection_id, r)
  }
  return [...byId.values()].sort((x, y) =>
    x.from < y.from ? -1 : x.from > y.from ? 1 : x.reflection_id < y.reflection_id ? -1 : 1)
}

/**
 * Union two copies of the SAME month — the write-back path (cloud sync, another device's file).
 *
 * F5 (test auditor, 2026-07-17): this returned `attestations: []`. Harmless only while nothing
 * called it — a PROOF-SHREDDER the moment sync wired it up, because every write-back would have
 * dropped every Bitcoin anchor both devices held and silently re-stamped the month. Fixed before
 * wiring, not after.
 *
 * Proofs from BOTH sides are offered to `buildAttestations`, which keeps one only where it still
 * attests the recomputed block. So a day the remote anchored and this device never saw arrives
 * WITH its proof intact; a day whose rows actually changed correctly loses its stale one.
 */
export async function mergeLedgers(a: MonthLedger, b: MonthLedger): Promise<MonthLedger> {
  const month = a.month || b.month
  const rows = mergeLedgerRows(a.rows, b.rows)
  const reflections = mergeReflections(a.reflections, b.reflections)
  return {
    v: 1, month, rows,
    ...(reflections.length ? { reflections } : {}),
    attestations: await buildAttestations(month, rows, [...a.attestations, ...b.attestations], reflections),
  }
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
 *
 * `existing` MAY carry several candidates for one day (a merge offers both devices' copies). The
 * strongest STILL-VALID proof wins: a Bitcoin-confirmed anchor from either device outranks a
 * pending one, and neither can be dropped merely for arriving second in the array.
 */
export async function buildAttestations(
  month: string,
  rows: readonly SessionRow[],
  existing: readonly LedgerAttestation[] = [],
  reflections: readonly Reflection[] = [],
): Promise<LedgerAttestation[]> {
  const byDay = new Map<string, SessionRow[]>()
  for (const r of rows) {
    const day = localDayOf(r.start)
    const list = byDay.get(day)
    if (list) list.push(r)
    else byDay.set(day, [r])
  }
  const priorByDay = new Map<string, LedgerAttestation[]>()
  for (const a of existing) {
    const list = priorByDay.get(a.day)
    if (list) list.push(a)
    else priorByDay.set(a.day, [a])
  }

  // A reflection is attested with the day it describes: the writer's account of the work and the
  // measurement of it are one record, so neither can be edited afterwards without the other noticing.
  const refByDay = new Map<string, Reflection[]>()
  for (const r of reflections) {
    const list = refByDay.get(r.day)
    if (list) list.push(r)
    else refByDay.set(r.day, [r])
  }
  for (const day of refByDay.keys()) if (!byDay.has(day)) byDay.set(day, [])

  const out: LedgerAttestation[] = []
  for (const day of [...byDay.keys()].sort()) {
    const rowHashes = await Promise.all(byDay.get(day)!.map((r) => hashCanonical(r)))
    const refHashes = await Promise.all((refByDay.get(day) ?? []).map((r) => hashCanonical(r)))
    // Bound to month + day: a block cannot be lifted into another month or another date.
    // v:1 with no reflections keeps the OLD hash byte-identical, so days attested before
    // reflections existed still verify.
    const blockHash = refHashes.length
      ? await hashCanonical({ v: 2, month, day, rowHashes, refHashes })
      : await hashCanonical({ v: 1, month, day, rowHashes })
    // Carry a proof ONLY if it attests this exact block; otherwise the day is unstamped again.
    const valid = (priorByDay.get(day) ?? []).filter((p) => p.blockHash === blockHash)
    const best = valid.sort((x, y) => otsRank(y.ots.status) - otsRank(x.ots.status))[0]
    out.push({ v: 1, day, rowHashes, blockHash, ots: best ? best.ots : { status: 'unstamped' } })
  }
  return out
}

const otsRank = (s: OtsProofState['status']): number => (s === 'confirmed' ? 2 : s === 'pending' ? 1 : 0)

/** Rebuild `attestations` from `rows` (preserving still-valid OTS proofs). The write path's last step. */
export async function attestLedger(l: MonthLedger): Promise<MonthLedger> {
  return { ...l, attestations: await buildAttestations(l.month, l.rows, l.attestations, l.reflections ?? []) }
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
  const recomputed = await buildAttestations(l.month, l.rows, [], l.reflections ?? [])
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
