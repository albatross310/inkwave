// OPENING A FILE MUST NEVER DESTROY THE DOCUMENT IT LANDS ON.
//
// THE INCIDENT (forensics, 2026-07-15 11:30:18 — Peter's real honours proposal). He opened a STALE
// `.studio` export (saved 07-10, carrying 07-08 content) and it blind-overwrote his current work.
// Proved byte-exactly: the stale export's `contentJson` and the OPFS `current.json` written at that
// instant hash identically (ce421bc5…). `openDoc.ts` takes the `id` FROM THE FILE, stamps
// `createdAt/updatedAt: now`, and calls `saveDocument(doc)` — an unconditional whole-file replace.
// Annotations he wrote on 15 July to his reading list are not in any surviving copy. This is not a
// hypothetical; it ate real, irreplaceable work.
//
// THE ASYMMETRY IS THE WHOLE BUG. openDoc.ts line ~91 already sends the incoming SNAPSHOTS through
// grow-only `restoreSnapshotsFromBundle` — CLAUDE.md: "every write-back MUST union with the
// target's existing snapshots first ... a short local set can never TRUNCATE the archive. This was
// a real data-loss incident (2026-07-05)." That union is the only reason any of his work still
// exists. The document BODY was never given the same protection. Two rules, one document.
//
// WHY ANCESTRY, NOT TIMESTAMPS. `updatedAt` cannot answer this: the very bug stamps it to `now`, so
// the stale file arrives looking BRAND NEW, and cross-device clock skew is real. But the snapshot
// archive is grow-only and content-hashed, which makes a much stronger question answerable:
//
//     "Is the incoming content something I have ALREADY BEEN THROUGH?"
//
// If the incoming contentHash appears in this document's own snapshot history, the file is a PAST
// STATE of the document in hand — it contains nothing the local copy lacks, and overwriting with it
// can only ever lose work. That is decidable from content, needs no clock, and is exactly the
// reasoning the snapshot union already uses.
//
// This module is PURE so both properties that matter can be pinned by unit tests that run in
// milliseconds (see openConflict.test.ts, mutation-tested): a stale file is never adopted, and a
// legitimate sync-down is never blocked.

export type OpenVerdict =
  /** Same content. Nothing to decide — adopt (it refreshes sync bindings and metadata). */
  | 'identical'
  /** The local copy is a past state of the incoming file ⇒ a legitimate sync-down. Adopt it. */
  | 'incoming-newer'
  /** The incoming file is a past state of the local copy ⇒ THE INCIDENT. Never overwrite. */
  | 'incoming-stale'
  /** Neither contains the other: both hold unique work. Never choose for the writer. */
  | 'diverged'

export interface OpenConflictInputs {
  /** contentHash of the document already in OPFS under this id. null ⇒ nothing here to lose. */
  localHash: string | null
  /** contentHash of the contentJson inside the file being opened. */
  incomingHash: string
  /** contentHashes in the LOCAL snapshot archive (grow-only ⇒ this document's real history). */
  localSnapshotHashes: readonly string[]
  /** contentHashes in the snapshot archive travelling INSIDE the incoming bundle. */
  incomingSnapshotHashes: readonly string[]
}

/**
 * Classify what opening this file would do to the document already on this device.
 *
 * The order of these clauses is the safety argument, so it is spelled out:
 *  1. No local document ⇒ there is nothing to destroy. Adopt.
 *  2. Identical content ⇒ the common case (re-opening your own synced file). Adopt.
 *  3. AMBIGUOUS BEFORE EITHER DIRECTIONAL TEST. If each side's history claims the other, the
 *     archives disagree and we do not get to guess — a revert, a restored backup or a merged
 *     history can produce this. `diverged` is the answer that discards nothing, so it is the
 *     answer we give. This clause must come BEFORE 4 and 5 or whichever ran first would win a
 *     coin-toss and could adopt a stale file.
 *  4. Incoming is in the local history ⇒ stale. Refuse.
 *  5. Local is in the incoming history ⇒ a genuine newer version. Adopt.
 *  6. Otherwise the two have no common ancestor we can see — including the case where NEITHER side
 *     has any snapshots at all. `diverged` again: with no evidence, the non-destructive answer is
 *     the only honest one. This deliberately errs toward keeping both copies rather than toward a
 *     silent overwrite, because those two errors are not remotely equal in cost.
 */
export function classifyOpen(o: OpenConflictInputs): OpenVerdict {
  if (o.localHash === null) return 'incoming-newer'
  if (o.localHash === o.incomingHash) return 'identical'
  const incomingIsPast = o.localSnapshotHashes.includes(o.incomingHash)
  const localIsPast = o.incomingSnapshotHashes.includes(o.localHash)
  if (incomingIsPast && localIsPast) return 'diverged'
  if (incomingIsPast) return 'incoming-stale'
  if (localIsPast) return 'incoming-newer'
  return 'diverged'
}

/** Does this verdict permit replacing the local document's body with the incoming one? */
export function mayOverwriteLocal(v: OpenVerdict): boolean {
  return v === 'identical' || v === 'incoming-newer'
}
