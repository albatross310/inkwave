// THE WRITE-BACK DECISION — "may I overwrite the remote archive, and with what?"
//
// ─── WHY THIS EXISTS, AND IT IS THE 2026-07-15 BUG ONE DIRECTORY OVER ─────────────────────────────
// `mergeSnapshots` is the grow-only union, and it is correct and tested (`mergeSnapshots.test.ts`
// pins "a short local set can never truncate a long remote"). It was never the hole. The hole was
// the code that decides WHETHER TO CALL IT — all three cloud providers wrote:
//
//     let merged = snapshots                       // ← local only
//     try {
//       const res = await fetch(remote)
//       if (res.ok) merged = mergeSnapshots(remote.snapshots, snapshots)
//     } catch { /* no remote yet → write local as-is */ }
//     await put(buildExportBundle(doc, merged))    // ← WRITES ANYWAY
//
// So a 500, a 429 throttle, an expired token, a network blip or a corrupt download all fell into
// the same branch as "the file does not exist yet" — and the next act was an UNCONDITIONAL PUT of
// the local set over the remote. **A guarded union that is never reached guards nothing.** That is
// the 2026-07-15 loss exactly (`catch { return null }` made "I could not read it" and "there is
// nothing there" the same answer), and the 2026-07-05 truncation exactly (a short local set
// replacing a long archive) — recombined, in the live cloud sync, on Peter's thesis.
//
// The distinction is not a nicety: "absent" and "error" license OPPOSITE actions. Absent ⇒ writing
// creates the file, and nothing can be lost. Error ⇒ we know NOTHING about what is there, and the
// only safe act is to not act. So, following `ledgerSync.ts`'s `RemoteRead` (which got this right)
// and `notFound.ts`'s boundary predicate:
//
//   1. THE UNION HAS NO `null` MEMBER. A provider cannot accidentally answer "nothing" for "the
//      network was down"; 'absent' and 'error' are different words and the compiler enforces it.
//   2. ONE RULE, ONE PLACE. OneDrive, Google Drive and the local folder all reconcile the same
//      question, so they share this function. Three copies of a rule is how one silently stops
//      matching the others (this repo's standing wound — see CLAUDE.md on `daySummary`).
//   3. EACH PROVIDER MAPS ONLY ITS OWN FAILURE SURFACE into the union — the thing only it knows
//      (Graph: 404 ⇒ absent via `mapGraphReadStatus`; FSA: NotFoundError ⇒ absent via `isNotFound`).
//      Nothing here decides anything about a provider; nothing there decides anything about safety.
//
// F16's lesson applies and is why `planWriteback` is pure and exported: a union guards the CONSUMER,
// not the PRODUCER. The type stops a caller forgetting the error branch; it cannot stop this
// function mapping the branches wrongly. So the mapping itself is the thing under test.

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
 * NB there is deliberately no `mergedRemote` flag. It was written, and it was always `true` wherever
 * `write` was `true` — a field no test could ever kill, i.e. a comment that costs a branch (the
 * `library.ready` mutation lesson). The equivalence is the useful fact and it is stated once here:
 * **`write: true` ⟺ we established what the remote holds**, so it is exactly the condition under
 * which a caller may close its once-per-session merge gate. An 'error' never writes and never
 * closes the gate, so the next sync retries the read.
 */
export type WritebackPlan =
  | { write: false; reason: string }
  | { write: true; snapshots: Snapshot[] }

/**
 * Decide what to write back, given what we managed to read.
 *
 * PURE — no network, no OPFS, no clock. This is the whole guard, and it is ~10 lines so that the
 * gate can KEEP it true in milliseconds without a browser (CLAUDE.md: "a green gate is not a guard";
 * a browser probe that ran once is archaeology).
 *
 * THE ASYMMETRY IS THE POINT: refusing to write costs one sync cycle (the rows/text are safe
 * locally and the next sync retries). Writing over an archive we could not read costs the archive.
 * When in doubt, do nothing — a sync that did not happen is a boring, recoverable Tuesday.
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

// ─── The write PRECONDITION (auditor Finding E, 2026-07-17) ──────────────────────────────────────
// READ-MERGE-WRITE still has a gap between the read and the write. `planWriteback` above decides
// WHETHER to write; this decides WHAT THE WRITE ASSUMED, so the server can refuse it if that
// assumption went stale in flight. Two devices interleaving:
//
//     A reads {R} · B reads {R} · A writes {R ∪ localA} · B writes {R ∪ localB}   ← A's rows GONE
//
// Both merges are honest and rows are still lost, because each merged against a version that moved.
// A violated precondition is a FAILED WRITE — which every caller here already handles correctly:
// nothing is lost, and the next sync re-reads, re-merges and writes the true union. Self-healing,
// which is why no 'conflict' outcome is needed for correctness.
//
// It lives in STORAGE, not in the ledger: "what must still be true for my write to land" is a
// property of writing to a remote, and the ledger is merely its first caller.
export type WritePrecondition =
  /** We read a 404: the file must NOT exist. Graph: `@microsoft.graph.conflictBehavior=fail`. */
  | { expect: 'absent' }
  /** We read this exact version: it must be unchanged. Graph: `If-Match: <etag>`. */
  | { expect: 'unchanged'; etag: string }
  /** The provider gave no version to pin. Honest, narrow, and the PRE-EXISTING posture — never a
   *  default. Only a read that genuinely returned no etag may produce it. The 'absent' case never
   *  degrades to this, which is precisely Finding E. */
  | { expect: 'any' }
