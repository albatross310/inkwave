// Signed receipt assembly + verification (v4 spec §6/§8, M3). PURE and dependency-light (only the
// canonical hash + @noble/ed25519, which bundles cleanly in the browser) so it runs in the app, on
// the /verify page, and standalone. The guarantees rest here, not on any Inkwave UI: each receipt's
// signed core verifies against the PUBLISHED public key, and prevHash chains the receipts into one
// fixed, unspliceable sequence per session.

import * as ed from '@noble/ed25519'
import type { WordNudgeEvent, SignedReceipt } from '../types/document'
import { canonicalize, sha256Hex } from './hash'
import { POOL } from '../scas/pool'

// Dev placeholder public key (matches api/_provenance-core.mjs DEV_SIGNING_PK — used in local dev,
// where the signing service also runs on dev keys).
export const DEV_SIGNING_PK = 'd5c5e5b40c2f33cb39f5c37ddc1ac27148addca4b7cdd12c7b89487a784787b4'

// The published production signing key — the public half of the key the signing service actually
// signs with. Published at /.well-known/inkwave-signing-key.json and
// committed to the repo, so verification never depends on inkwave.studio being online (v4 spec §8).
// This committed constant is authoritative (it's the git mirror) — we deliberately do NOT read it
// from an env var, so a stray/mismatched VITE_SIGNING_PK can't silently break verification. To
// rotate: regenerate the keypair, update INKWAVE_SIGNING_SK + this constant (+ a key-id), redeploy.
export const PUBLISHED_SIGNING_PK = 'b1fa2bad8ccb7451f2db3ae81851197dad5e5f6fca26297c9d6cc8e697db8b51'

/**
 * The signing public key the app verifies against: the published production key, except local dev
 * uses the dev placeholder (which matches the dev signing service). A standalone verifier should
 * pass the published key explicitly.
 */
export function signingPublicKeyHex(): string {
  return import.meta.env?.DEV ? DEV_SIGNING_PK : PUBLISHED_SIGNING_PK
}

/**
 * EVERY key a receipt may legitimately have been signed with — what VERIFICATION must try.
 *
 * ⚠ 2026-08-21, and this is the other half of a real data-loss incident. `signingPublicKeyHex()`
 * answers "which key does THIS BUILD sign with", and verification used it as though it answered
 * "which key could this receipt have been signed with". Those are different questions the moment a
 * document outlives one environment — and the gap is not exotic, it is the normal case: under
 * `import.meta.env.DEV` the first returns the DEV key, so every PRODUCTION-signed document fails
 * every chain the instant it is opened on localhost. Peter develops on localhost and opens his real
 * thesis there; a background sweep then read "unverifiable" as "forged" and deleted 79 Bitcoin-
 * anchored snapshots. The deletion is gone (see TiptapEditor's recoverAndPurge), but the false
 * verdict that triggered it was still being produced, and it is still wrong: it would mark his real
 * work unverified in the ReceiptPanel and on /verify for no reason.
 *
 * So verification accepts ANY key in this list. It is not a weakening: each entry is a key we
 * published and signed with, so accepting it is exactly as strong as accepting it before. Widening
 * is also the safe direction here — a key wrongly ABSENT produces a false "unverified" on genuine
 * work, while a key wrongly present would require an attacker to hold a private key we published
 * the public half of. Rotation adds the old key here so already-signed history keeps verifying.
 */
export function signingPublicKeys(): string[] {
  return import.meta.env?.DEV ? [DEV_SIGNING_PK, PUBLISHED_SIGNING_PK] : [PUBLISHED_SIGNING_PK]
}

// ── byte helpers ─────────────────────────────────────────────────────────────
function fromHex(h: string): Uint8Array {
  const u = new Uint8Array(h.length / 2)
  for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16)
  return u
}
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

/** Decode a period's writer-held bitmask (base64 over P) back to the set of off-limits lemmas. */
export function bitmaskToLemmas(lockedSetBase64: string): Set<string> {
  const bytes = fromBase64(lockedSetBase64)
  const out = new Set<string>()
  for (let i = 0; i < POOL.length; i++) {
    if (bytes[i >> 3] & (1 << (i & 7))) out.add(POOL[i])
  }
  return out
}

export function nudgesHash(nudges: WordNudgeEvent[]): Promise<string> {
  return sha256Hex(canonicalize(nudges))
}
/** @deprecated use nudgesHash */
export const kicksHash = nudgesHash

/** The genesis prevHash for receipt 0 of a session. */
export function genesisPrevHash(sessionToken: string): Promise<string> {
  return sha256Hex('inkwave-v1:' + sessionToken)
}

/** The chain hash of a receipt (the next receipt's prevHash must equal this). */
export function chainHash(receipt: SignedReceipt): Promise<string> {
  return sha256Hex(canonicalize(receipt))
}

// The exact bytes the server signed (client/server/verifier agree). kicksHash is recomputed from
// the receipt's kicks so altering a kick breaks the signature.
async function signedCore(r: SignedReceipt): Promise<string> {
  return canonicalize({
    v: 1,
    sessionToken: r.sessionToken,
    counter: r.counter,
    prevHash: r.prevHash,
    contentHash: r.contentHash,
    setVersion: r.setVersion,
    lockedSetHash: r.lockedSetHash,
    kicksHash: await nudgesHash(r.kicks),
    serverTime: r.serverTime,
    ...(r.cadenceDigest ? { cadenceDigest: r.cadenceDigest } : {}),
  })
}

export interface ReceiptVerdict { ok: boolean; reason?: string }

/** Verify one receipt: its writer-held set matches the signed hash, and the signature is valid. */
export async function verifyReceipt(
  receipt: SignedReceipt,
  /** One key, or every key that would be acceptable — see `signingPublicKeys()`. */
  pubKeyHex: string | string[],
): Promise<ReceiptVerdict> {
  // The writer-held bitmask must hash to the signed lockedSetHash (else the set was swapped).
  if (await sha256Hex(canonicalize(receipt.lockedSet)) !== receipt.lockedSetHash) {
    return { ok: false, reason: 'lockedSet does not match signed lockedSetHash' }
  }
  try {
    const core = new TextEncoder().encode(await signedCore(receipt))
    const sig = fromBase64(receipt.signature)
    // Try each acceptable key. A receipt is genuine if ANY of them signed it — see signingPublicKeys().
    // EACH ATTEMPT IS GUARDED SEPARATELY, and that is not defensive habit: `ed.verifyAsync` THROWS
    // on a key it cannot even parse as a curve point rather than returning false, so one bad entry
    // in the list would otherwise abort the loop and reject a receipt a LATER key would have
    // verified. Caught by this file's own test before it shipped — the single-key case hid it,
    // because there the throw and a false both end as `{ ok: false }`.
    const keys = Array.isArray(pubKeyHex) ? pubKeyHex : [pubKeyHex]
    for (const k of keys) {
      try {
        if (await ed.verifyAsync(sig, core, fromHex(k))) return { ok: true }
      } catch { /* not this key — try the next */ }
    }
    return { ok: false, reason: 'bad signature' }
  } catch (e) {
    return { ok: false, reason: 'verify threw: ' + (e as Error).message }
  }
}

export interface ChainVerdict { ok: boolean; verified: number; reason?: string }

/**
 * Verify the whole receipt chain: counters are 0,1,2,…; each prevHash links to the prior receipt
 * (c0 = sha256("inkwave-v1:"+sessionToken)); and every signature verifies. Catches tampering,
 * reordering, splices, and altered kicks.
 */
export async function verifyChain(
  receipts: SignedReceipt[],
  sessionToken: string,
  pubKeyHex: string | string[],
): Promise<ChainVerdict> {
  let expectedPrev = await genesisPrevHash(sessionToken)
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]
    if (r.counter !== i) return { ok: false, verified: i, reason: `counter ${r.counter} ≠ position ${i}` }
    if (r.prevHash !== expectedPrev) return { ok: false, verified: i, reason: `prevHash break at ${i}` }
    const v = await verifyReceipt(r, pubKeyHex)
    if (!v.ok) return { ok: false, verified: i, reason: `receipt ${i}: ${v.reason}` }
    expectedPrev = await chainHash(r)
  }
  return { ok: true, verified: receipts.length }
}
