// Ledger cloud sync (spec §A9) — provider-agnostic, READ-MERGE-WRITE, grow-only.
//
// ─── WHY THIS FILE IS SHAPED LIKE THIS, AND IT IS NOT THEORY ──────────────────────────────────
// Peter lost real thesis work on 2026-07-15 to a BLIND OVERWRITE: `openDoc.ts` writes `current.json`
// unconditionally with no staleness check, while the SAME file sends snapshots through the grow-only
// merge. That asymmetry is the whole story — his archive survived and his document did not.
//
// Ledger sync is the identical shape: a remote/older state meeting a local/newer one. So:
//
//   1. READ THE REMOTE FIRST, ALWAYS. Never write what we did not first reconcile against.
//   2. A FAILED READ IS NOT AN EMPTY REMOTE. This is THE distinction the 2026-07-15 bug turned on,
//      so the type SYSTEM enforces it: `RemoteRead` is a discriminated union with no `null`. A
//      provider cannot accidentally return "nothing" for "the network was down" — 'absent' and
//      'error' are different words, and only 'absent' licenses a first write. On 'error' we ABORT.
//   3. GROW-ONLY. `mergeLedgers` unions by session_id; a short local set can never shrink a long
//      remote (or vice versa), and OTS proofs from BOTH sides survive.
//   4. NO ONCE-PER-SESSION GATE. `syncToOneDrive` merges the remote's snapshots only ONCE per
//      session because re-reading a 20MB .studio per save is real lag. A month of ledger rows is
//      tens of KB, so that trade does not apply here and we take the safe path EVERY write. The
//      cheapness of the file is what buys the stronger invariant — do not copy the gate over.
//
// The ledger is its OWN file next to the .studio (`inkwave-ledger-2026-07.json`), never inside it:
// the .studio is per-document and the ledger spans every document, so embedding it would fork one
// global record into N conflicting per-document copies.

import { emptyLedger, ledgerNameFor, mergeLedgers } from './ledger'
import { loadLedger, mergeIntoLocalLedger } from './ledgerStore'
import type { MonthLedger } from './types'
import type { WritePrecondition } from '../storage/archiveWriteback'

export const ledgerFileName = (month: string): string => `${ledgerNameFor(month)}.json`

/**
 * What a provider's read produced. A UNION with no `null` member, deliberately: the one mistake this
 * whole module exists to prevent is treating a failure as an absence.
 */
export type RemoteRead =
  /** `etag` is the version we read, for the write's precondition. REQUIRED, not optional: a field
   *  only some providers write is a field that lies, and its absence here silently downgrades the
   *  write to unguarded. A provider with no version concept must say `null` out loud. */
  | { status: 'ok'; ledger: MonthLedger; etag: string | null }
  | { status: 'absent' } // the file genuinely does not exist yet → a first write is safe
  | { status: 'error'; reason: string } // network/auth/parse failed → we know NOTHING → never write

/** Re-exported so a LedgerRemote implementor imports its whole contract from one module. */
export type { WritePrecondition }

/**
 * Derive the write's precondition from what we actually read. PURE — this is the whole of Finding
 * E's fix that can be tested without a Microsoft account, so it is the part that is tested.
 */
export function preconditionFor(read: RemoteRead): WritePrecondition {
  if (read.status === 'absent') return { expect: 'absent' }
  if (read.status === 'ok' && read.etag) return { expect: 'unchanged', etag: read.etag }
  // 'error' never reaches a write (syncLedgerMonth returns first); an 'ok' with no etag is a
  // provider that cannot pin a version — we are no worse off than before, and we say so.
  return { expect: 'any' }
}

export interface LedgerRemote {
  /** Provider label, for diagnostics only. */
  readonly name: string
  read(file: string): Promise<RemoteRead>
  /**
   * Write the merged ledger, but ONLY if `pre` still holds. Returns false on failure OR on a
   * violated precondition (the caller keeps local; nothing is lost; the next sync re-reconciles).
   * `pre` is REQUIRED so a provider cannot quietly write unguarded.
   */
  write(file: string, ledger: MonthLedger, pre: WritePrecondition): Promise<boolean>
}

export type SyncOutcome =
  | { ok: true; action: 'wrote'; rows: number; grewLocalBy: number }
  | { ok: true; action: 'up-to-date'; rows: number }
  | { ok: false; reason: string }

function isLedger(v: unknown): v is MonthLedger {
  const l = v as MonthLedger | null
  return !!l && l.v === 1 && typeof l.month === 'string' && Array.isArray(l.rows)
}

/** Parse a remote body into a ledger. Malformed JSON is an ERROR, never an empty ledger. */
export function parseRemoteLedger(text: string, month: string): RemoteRead {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // A truncated/garbled download must NOT read as "the remote has nothing" — that would let the
    // next write replace a real ledger with ours.
    return { status: 'error', reason: 'remote ledger is not valid JSON' }
  }
  if (!isLedger(raw)) return { status: 'error', reason: 'remote ledger has an unrecognised shape' }
  if (raw.month !== month) return { status: 'error', reason: `remote ledger is for ${raw.month}, not ${month}` }
  // `etag: null` EXPLICITLY: this function parses a BODY and knows nothing about transport. The
  // adapter that made the HTTP call attaches the real version (ledgerRemotes). Saying null out loud
  // is the point of the field being required — an omitted etag would silently mean "unguarded".
  return { status: 'ok', etag: null, ledger: { v: 1, month, rows: raw.rows.filter((r) => r && r.session_id), attestations: raw.attestations ?? [] } }
}

/**
 * Sync ONE month, both ways: the union lands on the remote AND heals the local copy.
 *
 * Returns without writing when the remote could not be read — the correct, boring outcome. A device
 * that cannot see the remote has no business replacing it, and the rows are still safe locally.
 */
export async function syncLedgerMonth(remote: LedgerRemote, month: string): Promise<SyncOutcome> {
  const file = ledgerFileName(month)

  // THE LOCAL READ CAN FAIL TOO, and it is the same rule pointed the other way (auditor,
  // 2026-07-17). `loadLedger` now THROWS rather than answering "you have no rows" to a failed OPFS
  // read — because if it lied, `local` would be empty, the union would be the remote alone, and
  // step 5 would heal our own disk with it, DESTROYING every row this device had not yet synced.
  // A sync that cannot read its own ledger has nothing to reconcile with and must not write.
  let local: MonthLedger
  try {
    local = await loadLedger(month)
  } catch (e) {
    return { ok: false, reason: `local ledger unreadable (${(e as Error)?.message ?? String(e)}) — not syncing (nothing is lost)` }
  }

  // 1. READ FIRST.
  //
  // F16 (auditor, 2026-07-17): **the union guards the CONSUMER, not the PRODUCER.** `RemoteRead` makes
  // it impossible for ME to forget the failure branch — it cannot make an adapter honour its own
  // contract. A provider that THROWS (its token call rejects; a bug) hands us an exception this
  // function never wrote a branch for, and an unhandled rejection is not a safe default in a
  // function whose next act is a write. So the throw is converted to the answer it should have
  // been: `error` — which refuses the write. A broken adapter must fail SAFE, not fail open.
  let read: RemoteRead
  try {
    read = await remote.read(file)
  } catch (e) {
    return { ok: false, reason: `${remote.name}: read threw (${(e as Error)?.message ?? String(e)}) — not writing (local rows are safe)` }
  }
  if (read.status === 'error') {
    // THE LOAD-BEARING BRANCH. Do not "recover" by writing local — that is the 2026-07-15 bug.
    return { ok: false, reason: `${remote.name}: ${read.reason} — not writing (local rows are safe)` }
  }
  const remoteLedger = read.status === 'ok' ? read.ledger : emptyLedger(month)

  // 2. MERGE (grow-only, proofs from both sides preserved).
  const merged = await mergeLedgers(remoteLedger, local)

  // 3. Nothing to do? Don't touch the remote at all. A no-op write is a chance to corrupt.
  const remoteIsCurrent = read.status === 'ok' && merged.rows.length === remoteLedger.rows.length
  if (remoteIsCurrent && merged.rows.length === local.rows.length) {
    return { ok: true, action: 'up-to-date', rows: merged.rows.length }
  }

  // 4. WRITE the union out, PINNED TO WHAT WE READ (Finding E). If the remote moved under us —
  // another device wrote between our read and now, or the 404 we saw has since become a real file —
  // the server refuses and we fall into the failure branch below: nothing lost, retried next sync.
  // (a throwing writer is a failed write, not a crash mid-sync)
  let wrote = false
  try {
    wrote = await remote.write(file, merged, preconditionFor(read))
  } catch (e) {
    return { ok: false, reason: `${remote.name}: write threw (${(e as Error)?.message ?? String(e)}) — local rows are unchanged and safe` }
  }
  if (!wrote) {
    return { ok: false, reason: `${remote.name}: write failed — local rows are unchanged and safe` }
  }

  // 5. ...and HEAL the local copy with anything the remote knew that we didn't. Grow-only again:
  // mergeIntoLocalLedger unions rather than replacing, so a row written between our load and now
  // cannot be lost.
  const healed = await mergeIntoLocalLedger(month, merged)
  return { ok: true, action: 'wrote', rows: merged.rows.length, grewLocalBy: healed.rows.length - local.rows.length }
}

/** Sync several months (the current one, plus a straggler at a month boundary). */
export async function syncLedgerMonths(remote: LedgerRemote, months: readonly string[]): Promise<SyncOutcome[]> {
  const out: SyncOutcome[] = []
  for (const m of months) out.push(await syncLedgerMonth(remote, m))
  return out
}
