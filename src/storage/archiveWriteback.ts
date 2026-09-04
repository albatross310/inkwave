// THE WRITE-BACK DECISION — "may I overwrite the remote archive, and with what?"
//
// ⚠ A GUARDED UNION THAT IS NEVER REACHED GUARDS NOTHING. `mergeSnapshots` was always correct; the
// hole was the code deciding whether to CALL it — all three providers treated a 500, a throttle, an
// expired token and "the file does not exist yet" as one branch, then PUT the local set anyway.
//
// So, three rules, and they are structural rather than conventional:
//   1. THE UNION HAS NO `null` MEMBER. 'absent' licenses a write and 'error' forbids one; they are
//      different words and the compiler enforces it.
//   2. ONE RULE, ONE PLACE — OneDrive, Drive and the local folder share `planWriteback`. Three
//      copies is how one silently stops matching the others.
//   3. EACH PROVIDER MAPS ONLY ITS OWN FAILURE SURFACE into the union. Nothing here decides anything
//      about a provider; nothing there decides anything about safety.
//
// `planWriteback` is PURE and exported because a union guards the CONSUMER, not the PRODUCER: the
// type stops a caller forgetting the error branch, so the MAPPING is the thing under test.
// → docs/archive/storage-and-sync.md#wb-guarded-union

import type { Snapshot } from '../types/document'
import { mergeSnapshots } from '../provenance/snapshots'

/**
 * What a provider's read of the remote archive produced.
 *
 * A discriminated union with NO `null`/`undefined` member, deliberately: the one mistake this
 * module exists to prevent is a failure wearing an absence's clothes.
 */
export type ArchiveRead =
  | { status: 'ok'; snapshots: Snapshot[] } // we read it; these are its snapshots
  | { status: 'absent' } // it genuinely does not exist yet → a first write is safe
  | { status: 'error'; reason: string } // we could not find out → we know NOTHING → never write

/**
 * What the caller may do. `write: false` is a NORMAL outcome, not a crash: local is safe.
 *
 * NB there is deliberately NO `mergedRemote` flag — it was always `true` wherever `write` was, i.e. a
 * field no test could kill. The useful fact is the equivalence: **`write: true` ⟺ we established what
 * the remote holds**, which is exactly when a caller may close its once-per-session merge gate.
 * → docs/archive/storage-and-sync.md#wb-no-merged-flag
 */
export type WritebackPlan =
  | { write: false; reason: string }
  | { write: true; snapshots: Snapshot[] }

/**
 * Decide what to write back, given what we managed to read. PURE — no network, no OPFS, no clock —
 * and short, so the gate can KEEP it true in milliseconds without a browser.
 *
 * ⚠ THE ASYMMETRY IS THE POINT: refusing to write costs one sync cycle; writing over an archive we
 * could not read costs the archive. When in doubt, do nothing.
 * → docs/archive/storage-and-sync.md#wb-guarded-union
 */
export function planWriteback(read: ArchiveRead, local: Snapshot[]): WritebackPlan {
  // THE LOAD-BEARING BRANCH. Do not "recover" by writing local — that is the whole bug.
  if (read.status === 'error') {
    return { write: false, reason: `archive unreadable (${read.reason}) — not writing (local is safe)` }
  }
  // A genuine absence: there is nothing to union with, and nothing that can be lost.
  if (read.status === 'absent') {
    return { write: true, snapshots: local }
  }
  // We read it → grow-only union. Note this runs even when the remote's array is EMPTY: an empty
  // read is a fact we established, unlike an empty guess.
  return { write: true, snapshots: mergeSnapshots(read.snapshots, local) }
}

/**
 * The remote parsed — but is it an INKWAVE RECORD? PURE, and the third half of the read.
 *
 * ⚠ A PARSE THAT SUCCEEDS IS NOT A RECORD. `parseTraceFile` has no shape check, so a body that is
 * valid JSON and not a bundle answered `{ status: 'ok', snapshots: [] }` — a remote we never
 * established, wearing an established emptiness's clothes, which is the one answer that licenses an
 * overwrite. The rule is narrow and structural because the OUTAGE DIRECTION sets its floor: an
 * absent `snapshots` is a real, healthy pre-snapshot record and must stay writable.
 *
 * @returns the archive, or `null` for "this is not a record" — ⚠ which every caller must map to
 *          `error`, NEVER to `absent`. It is not an `ArchiveRead` precisely so the caller has to
 *          write the word. → docs/archive/storage-and-sync.md#wb-is-a-record
 */
export function archiveSnapshotsOf(parsed: unknown): Snapshot[] | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const snaps = (parsed as { snapshots?: unknown }).snapshots
  if (snaps === undefined || snaps === null) return [] // a record with no history — established, safe
  if (!Array.isArray(snaps)) return null
  return snaps as Snapshot[]
}

// ─── The write PRECONDITION (auditor Finding E) ──────────────────────────────────────────────────
// READ-MERGE-WRITE still has a gap between the read and the write: two devices can each merge
// honestly against a version that moved, and one device's rows are gone. This is what the write
// ASSUMED, so the server can refuse it. A violated precondition is a FAILED write, which every
// caller already handles — the next sync re-reads and writes the true union, so it self-heals and
// needs no 'conflict' outcome. It lives in STORAGE because "what must still be true for my write to
// land" is a property of writing to a remote; the ledger is merely its first caller.
// → docs/archive/storage-and-sync.md#wb-precondition
export type WritePrecondition =
  /** We read a 404: the file must NOT exist. Graph: `@microsoft.graph.conflictBehavior=fail`. */
  | { expect: 'absent' }
  /** We read this exact version: it must be unchanged. Graph: `If-Match: <etag>`. */
  | { expect: 'unchanged'; etag: string }
  /** The provider gave no version to pin. Honest, narrow, and the PRE-EXISTING posture — never a
   *  default. Only a read that genuinely returned no etag may produce it. The 'absent' case never
   *  degrades to this, which is precisely Finding E. */
  | { expect: 'any' }
