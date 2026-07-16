// Finalising an email draft (§B2.2) — hash the composed email and anchor it through the EXISTING
// OpenTimestamps spine. There is deliberately NO parallel mechanism here.
//
// The whole of this module is a thin arrangement of machinery that already exists:
//
//   contentHash(contentJson)      the BODY — an email's body IS an ordinary Inkwave document body
//   emailHeadersHash(headers)     the HEADERS — canonicalised (email/headers.ts)
//   bundleHash(...)               commits to both, in the v:3 form (provenance/hash.ts)
//   createSnapshotIfChanged       freezes + persists the snapshot (provenance/snapshots.ts)
//   stampSnapshot → stampBundle   OTS → Bitcoin (provenance/ots.ts)
//   verifyBundle                  recomputes all of it at /verify (verify/index.ts)
//
// That inheritance is the point: an email finalise is a `force`d manual snapshot on a document that
// happens to carry headers. If any of it drifts into a bespoke email path, the /verify round-trip
// stops proving anything about emails.
//
// WHAT THE RESULT PROVES: this exact content existed by time T. NOT that it was sent. See copy.ts.

import type { InkwaveDocument, Snapshot } from '../types/document'
import { createSnapshotIfChanged, stampSnapshot } from '../provenance/snapshots'
import { pmToText } from '../provenance/bundle'
import { hasRecipient } from './headers'
import type { MailDraft } from './sender'

export interface FinaliseResult {
  snapshot: Snapshot | null
  /** True once the snapshot's bundleHash is submitted to OTS (status 'pending'; Bitcoin confirms
   *  over hours, exactly as for any document — the ReceiptPanel's sweep upgrades it later). */
  stamped: boolean
  reason?: string
}

/**
 * Finalise: snapshot the email (headers frozen + hashed into bundleHash) and submit that hash to
 * OpenTimestamps. `force: true` — a writer pressing "record this draft" must always get a marker,
 * even if the bytes are unchanged since the last snapshot.
 *
 * Anchoring is best-effort on the NETWORK only: an offline finalise still produces a persisted,
 * hashed snapshot with `ots: 'unstamped'`, which the existing sweep stamps when the ReceiptPanel is
 * next opened. It never throws away the record because the relay was unreachable.
 */
export async function finaliseEmail(doc: InkwaveDocument): Promise<FinaliseResult> {
  if (doc.docType !== 'email' || !doc.email) {
    return { snapshot: null, stamped: false, reason: 'not an email document' }
  }
  const snapshot = await createSnapshotIfChanged(doc, 'manual', doc.scasReceipts ?? [], undefined, true)
  if (!snapshot) {
    // The only way here is the CompressionStream floor (iOS < 16.4) — snapshots.ts warns and
    // degrades. Say so rather than reporting a silent success.
    return { snapshot: null, stamped: false, reason: 'provenance snapshots unavailable on this browser' }
  }
  const stampedSnap = await stampSnapshot(doc.id, snapshot.id)
  return {
    snapshot: stampedSnap ?? snapshot,
    stamped: stampedSnap?.ots.status === 'pending' || stampedSnap?.ots.status === 'confirmed',
    reason: stampedSnap ? undefined : 'could not reach the timestamp relay — the draft is recorded and will be anchored on the next check',
  }
}

/** Is the draft ready to finalise? Content is not required — an empty email is still a record. */
export function canFinalise(doc: InkwaveDocument): boolean {
  return doc.docType === 'email' && !!doc.email
}

/**
 * The draft as a MailSender sees it. The body is rendered with `resolveCitations: true` — the
 * DISPLAY path (what a reader should receive: "(Family, Year)", not a raw citekey). This is a
 * display call, exactly like SnapshotView's; the resolveCitations=false byte-determinism that
 * verify/bundle depend on is untouched by it.
 */
export function draftFor(doc: InkwaveDocument): MailDraft | null {
  if (doc.docType !== 'email' || !doc.email) return null
  return { headers: doc.email, body: pmToText(doc.contentJson, true) }
}

/** Can this draft be handed to a provider at all? (§B2.3a — a recipient is the one precondition.) */
export function canHandOff(doc: InkwaveDocument): boolean {
  return doc.docType === 'email' && !!doc.email && hasRecipient(doc.email)
}
