// A RECEIPT SIGNED IN PRODUCTION MUST STILL VERIFY WHEN OPENED ON LOCALHOST.
//
// This is the second half of the 2026-08-20 incident. `signingPublicKeyHex()` answers "which key
// does THIS BUILD sign with", and verification used it as if it answered "which key could this
// receipt have been signed with". Under `import.meta.env.DEV` the first returns the DEV key, so
// every production-signed document failed every chain the moment it was opened on localhost — and a
// background sweep read that failure as forgery and deleted 79 Bitcoin-anchored snapshots.
//
// The deletion is fixed separately (noAutoDelete.test.ts pins it). THIS file pins the wrong VERDICT
// that triggered it, because the verdict is a bug on its own terms: without it Peter's real work
// reads "unverified" in the ReceiptPanel and on /verify, on the machine he actually writes on.
//
// WHY WIDENING IS SAFE, stated because a test that loosens a security check should have to argue for
// itself: every accepted key is one we published and signed with, so accepting it is exactly as
// strong as accepting it was before. The failure directions are asymmetric too — a key wrongly
// ABSENT produces a false "unverified" on genuine work (what happened), while a key wrongly PRESENT
// would require an attacker to hold the private half of a keypair we published. THE NEGATIVE below
// pins that strangers' keys are still rejected, so "accepts more" has not become "accepts anything".
//
// The receipts are signed by the REAL SERVER CORE (api/_provenance-core.mjs), the same fixture
// receipts.test.ts uses — a hand-rolled signature here would only prove this file agrees with
// itself. That choice caught a real bug in the first draft of the fix: `ed.verifyAsync` THROWS on a
// key it cannot parse rather than returning false, so one bad entry aborted the loop and rejected a
// receipt a later key would have verified. The single-key case hid it, because there a throw and a
// false both end as `{ ok: false }`.

import { describe, it, expect } from 'vitest'
import type { KickEvent, SignedReceipt } from '../types/document'
import { verifyReceipt, verifyChain, kicksHash, genesisPrevHash, DEV_SIGNING_PK, PUBLISHED_SIGNING_PK } from './receipts'
import { openSession, signPeriod } from '../../api/_provenance-core.mjs'

const DOC = 'doc-multikey-test'
const CH0 = 'a'.repeat(64)

/** A receipt genuinely signed by the dev signing service — stands in for "signed elsewhere". */
async function makeReceipt(
  session: { sessionToken: string }, counter: number, prevHash: string, kicks: KickEvent[] = [],
): Promise<SignedReceipt> {
  const signed = await signPeriod({
    sessionToken: session.sessionToken, docId: DOC, counter, prevHash,
    contentHash: CH0, setVersion: 0, kicksHash: await kicksHash(kicks),
  })
  return {
    v: 1, sessionToken: session.sessionToken, counter, prevHash, contentHash: CH0, setVersion: 0,
    lockedSetHash: signed.lockedSetHash, kicks, serverTime: signed.serverTime,
    signature: signed.signature, lockedSet: signed.lockedSet,
  }
}

/** Not the signing key — a well-formed key that simply did not sign this receipt. */
const STRANGER_PK = 'f'.repeat(64)

describe('verification accepts every key we ever signed with', () => {
  it('KNOWN-POSITIVE: verifies against the key that actually signed it', async () => {
    const session = await openSession(DOC)
    const r = await makeReceipt(session, 0, await genesisPrevHash(session.sessionToken))
    expect((await verifyReceipt(r, DEV_SIGNING_PK)).ok).toBe(true)
  })

  it('THE OLD BEHAVIOUR still fails: the wrong key ALONE does not verify', async () => {
    // Without this the test below could pass with no multi-key path at all — it would just be
    // asserting that a genuine receipt verifies, which the known-positive already covers.
    const session = await openSession(DOC)
    const r = await makeReceipt(session, 0, await genesisPrevHash(session.sessionToken))
    expect((await verifyReceipt(r, PUBLISHED_SIGNING_PK)).ok).toBe(false)
  })

  it('THE INCIDENT: it verifies when several keys are offered, in either order', async () => {
    const session = await openSession(DOC)
    const r = await makeReceipt(session, 0, await genesisPrevHash(session.sessionToken))
    // Exactly the shape of the bug: the signing key is present but not the one this build prefers.
    expect((await verifyReceipt(r, [PUBLISHED_SIGNING_PK, DEV_SIGNING_PK])).ok).toBe(true)
    expect((await verifyReceipt(r, [DEV_SIGNING_PK, PUBLISHED_SIGNING_PK])).ok).toBe(true)
  })

  it('a CHAIN verifies the same way — which is what the purge was reading', async () => {
    const session = await openSession(DOC)
    const prev = await genesisPrevHash(session.sessionToken)
    const r0 = await makeReceipt(session, 0, prev)
    const v = await verifyChain([r0], session.sessionToken, [PUBLISHED_SIGNING_PK, DEV_SIGNING_PK])
    expect(v.ok).toBe(true)
    expect(v.verified).toBe(1)
  })

  it('THE NEGATIVE: strangers\' keys are still rejected, however many are offered', async () => {
    const session = await openSession(DOC)
    const r = await makeReceipt(session, 0, await genesisPrevHash(session.sessionToken))
    expect((await verifyReceipt(r, [STRANGER_PK, PUBLISHED_SIGNING_PK])).ok).toBe(false)
  })

  it('a malformed key in the list does not abort the others (the first draft\'s bug)', async () => {
    // `ed.verifyAsync` throws on a key it cannot parse. Before each attempt was guarded separately,
    // a junk entry ahead of the real key rejected a genuine receipt.
    const session = await openSession(DOC)
    const r = await makeReceipt(session, 0, await genesisPrevHash(session.sessionToken))
    expect((await verifyReceipt(r, ['zz', '', DEV_SIGNING_PK])).ok).toBe(true)
  })

  it('a tampered lockedSet is refused before any signature is tried', async () => {
    const session = await openSession(DOC)
    const r = await makeReceipt(session, 0, await genesisPrevHash(session.sessionToken))
    const swapped = { ...r, lockedSet: 'AAAA-tampered' } as unknown as SignedReceipt
    const v = await verifyReceipt(swapped, [DEV_SIGNING_PK, PUBLISHED_SIGNING_PK])
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/lockedSet/)
  })
})
