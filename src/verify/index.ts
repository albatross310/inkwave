// The open verifier (v4 spec §6, M5). PURE and framework-free — runs in the app, on the /verify
// page, and standalone. Given an export bundle it checks, entirely client-side, against the
// PUBLISHED signing key (not the key the bundle claims) and the snapshots' OTS proofs:
//
//   1. content integrity — each snapshot's contentHash matches its contentJson, and its bundleHash
//      matches (so the receipts it anchors can't be swapped);
//   2. chain — every receipt's signature verifies and prevHash links into one unspliceable sequence
//      per session (catches tamper / reorder / splice / altered kicks);
//   3. kick consistency — every logged in-S kick's lemma was actually in that period's SIGNED set
//      (decode the bitmask) — a fabricated kick log can't match the signed sets;
//   4. friction — observed kicks ÷ content words, surfaced honestly against a plausibility floor;
//   5. anchor — REAL OTS verification: deserialize each snapshot's proof, confirm it commits to that
//      snapshot's bundleHash, and check the committed digest against the cited Bitcoin block's merkle
//      root via independent explorers. Block height/time are derived from the proof + chain, never
//      from the author's JSON; the author's claimed status/block/time are cross-checked and a lie
//      fails the bundle. We also check serverTime ≤ the verified block time (a signed timestamp can't
//      post-date the block that anchors it).
//
// HONEST LIMITATION: the full "no silent dodging" replay (every off-limits committed word has a
// resolved kick) needs the per-period content diffs; the bundle carries periodic content *hashes*
// but not per-period content, so that deeper replay is a planned extension. What's here proves the
// record is authentic, unspliceable, and internally consistent with the signed sets.

import type { ExportBundle } from '../provenance/bundle'
import type { SignedReceipt, TiptapJSON } from '../types/document'
import { canonicalize, sha256Hex, bundleHash, bibliographyHash, emailHeadersHash } from '../provenance/hash'
import { normaliseHeaders } from '../email/headers'
import { verifyChain, bitmaskToLemmas, PUBLISHED_SIGNING_PK } from '../provenance/receipts'
import { cadenceDigest, BIN_MS } from '../provenance/cadence'
import { pmToText } from '../provenance/bundle'
import { verifyOtsProof, defaultFetchBlock, type BlockFetcher } from './ots'

// A 0.5 s bin holding more than this many inserted chars (~240 chars/sec) is not human typing — it's
// a paste. Surfaced honestly; the cadence test is public and cannot carry a guarantee it can't.
const PASTE_INS_PER_BIN = Math.round((240 * BIN_MS) / 1000)

export interface VerifyReport {
  contentIntegrity: { ok: boolean; checked: number; reason?: string }
  chain: { ok: boolean; sessions: number; verified: number; reason?: string }
  nudgeConsistency: { ok: boolean; checked: number; reason?: string }
  /** @deprecated use nudgeConsistency */
  kickConsistency: { ok: boolean; checked: number; reason?: string }
  friction: { nudges: number; contentWords: number; onePerWords: number | null; note: string }
  // Cadence (paid). `withDigest` counts receipts that committed a signed cadence digest; `revealed`
  // counts those whose writer-held bins are present (so we can analyse them). `integrityOk` is false
  // only when revealed bins don't match their signed digest (tamper). Plausibility is surfaced, not
  // asserted — see the spec ceiling.
  cadence: { withDigest: number; revealed: number; bins: number; ins: number; del: number; integrityOk: boolean; pasteSuspectBins: number; note: string }
  // Bitcoin anchoring, ACTUALLY verified (not trusted from the bundle's JSON). `confirmed` snapshots
  // had their proof checked against a real block's merkle root via independent explorers; `tampered`
  // is fatal (proof contradicts the chain, or the author's claimed block/time is a lie). `ok` gates
  // the bundle; `inconclusive` (couldn't reach an explorer) and `unstamped` never fail it.
  anchor: {
    snapshots: number; confirmed: number; pending: number; unstamped: number; inconclusive: number
    tampered: number; earliestBlockTime: string | null; timeConsistent: boolean; anchoredReceipts: number
    ok: boolean; note: string
  }
  // The human-readable prose at the top of the .inkwave file must be a faithful rendering of the
  // bundle's document content — so a tamperer can't show a reader one thing while the signed record
  // says another. `contentBinding` then surfaces whether that displayed content is itself a SIGNED
  // state (matches a receipt's signed contentHash), merely a recorded snapshot, or trailing edits
  // made after the last signed checkpoint.
  textIntegrity: { ok: boolean; reason?: string }
  contentBinding: { state: 'signed' | 'snapshot' | 'unsigned'; note: string }
  // Legacy summary the /verify UI still reads — now derived from REAL verification, not the JSON.
  existence: { snapshots: number; confirmed: number; pending: number; unstamped: number }
  overall: boolean
}

function countWords(contentJson: TiptapJSON): number {
  let text = ''
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { text?: string; content?: unknown[] }
    if (typeof n.text === 'string') text += n.text + ' '
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(contentJson)
  const m = text.trim().match(/[\p{L}\p{N}]+/gu)
  return m ? m.length : 0
}

async function checkContentIntegrity(bundle: ExportBundle): Promise<VerifyReport['contentIntegrity']> {
  // Genuine receipts = the (separately chain-verified, in checkChains) top-level set, keyed by
  // signature → exact canonical content. A snapshot's bundleHash anchors WHATEVER receipts it embeds,
  // so the hash check alone doesn't stop an attacker embedding a fabricated receipt array, honestly
  // hashing it into bundleHash, and OTS-stamping THAT — yielding a Bitcoin-"verified" record Inkwave
  // never signed (audit F2). So every receipt a snapshot anchors must be byte-identical to one in the
  // signed chain. (JCS canonicalization makes this robust to serialization round-trips.)
  const genuine = new Map<string, string>()
  for (const r of bundle.receipts) genuine.set(r.signature, canonicalize(r))
  let checked = 0
  for (const s of bundle.snapshots) {
    checked++
    const ch = await sha256Hex(canonicalize(s.contentJson))
    if (ch !== s.contentHash) return { ok: false, checked, reason: `snapshot ${s.id}: contentHash mismatch` }
    // If the snapshot froze a DISPLAYED bibliography (v:2), recompute its bibHash from the stored
    // entries+style so a tampered entries array is caught even before OTS anchoring, then fold that
    // into the bundleHash recompute. Legacy v:1 snapshots (no bibHash) verify unchanged.
    let bibHashForBundle = s.bibHash
    if (s.bibliography && s.bibliography.entries.length > 0) {
      const recomputed = await bibliographyHash(s.bibliography.entries, s.bibliography.style)
      if (recomputed !== s.bibHash) return { ok: false, checked, reason: `snapshot ${s.id}: bibHash mismatch` }
      bibHashForBundle = recomputed
    }
    // Same treatment for a frozen EMAIL header set (v:3): recompute its hash from the stored
    // headers, so tampering with a recipient or the subject is caught here — and fold it into the
    // bundleHash recompute, which is what makes the OTS anchor actually BIND the headers rather
    // than merely sit beside them. Non-email snapshots (no emailHash) verify exactly as before.
    let emailHashForBundle = s.emailHash
    if (s.email) {
      // The stored headers must ALREADY be canonical. createSnapshotIfChanged only ever writes the
      // canonical form, so a non-canonical one is anomalous — and without this check a tamperer
      // could store a spelling that merely RE-NORMALISES to the anchored hash ("ADA@X.COM" for
      // "ada@x.com"), so a reader looking at snapshot.email verbatim would see different bytes from
      // the ones the Bitcoin anchor actually commits to. It cannot change WHO the recipient is (that
      // changes the normalised form, hence the hash), but displayed bytes and anchored bytes must
      // not be allowed to diverge at all on a provenance surface.
      const canonical = normaliseHeaders(s.email)
      if (canonicalize(canonical) !== canonicalize({ to: s.email.to, cc: s.email.cc ?? [], bcc: s.email.bcc ?? [], subject: s.email.subject })) {
        return { ok: false, checked, reason: `snapshot ${s.id}: email headers are not in canonical form` }
      }
      const recomputed = await emailHeadersHash(canonical)
      if (recomputed !== s.emailHash) return { ok: false, checked, reason: `snapshot ${s.id}: emailHash mismatch` }
      emailHashForBundle = recomputed
    }
    const bh = await bundleHash(s.contentHash, s.receipts ?? [], bibHashForBundle, emailHashForBundle)
    if (bh !== s.bundleHash) return { ok: false, checked, reason: `snapshot ${s.id}: bundleHash mismatch` }
    for (const r of s.receipts ?? []) {
      if (genuine.get(r.signature) !== canonicalize(r)) {
        return { ok: false, checked, reason: `snapshot ${s.id}: anchors a receipt not in the signed chain` }
      }
    }
  }
  return { ok: true, checked }
}

async function checkChains(bundle: ExportBundle, pubKeyHex: string): Promise<VerifyReport['chain']> {
  const bySession = new Map<string, SignedReceipt[]>()
  for (const r of bundle.receipts) {
    const arr = bySession.get(r.sessionToken) ?? []
    arr.push(r)
    bySession.set(r.sessionToken, arr)
  }
  let verified = 0
  for (const [token, receipts] of bySession) {
    receipts.sort((a, b) => a.counter - b.counter)
    const v = await verifyChain(receipts, token, pubKeyHex)
    if (!v.ok) return { ok: false, sessions: bySession.size, verified, reason: v.reason }
    verified += v.verified
  }
  return { ok: true, sessions: bySession.size, verified }
}

function checkNudgeConsistency(bundle: ExportBundle): VerifyReport['nudgeConsistency'] {
  let checked = 0
  for (const r of bundle.receipts) {
    const sv = bitmaskToLemmas(r.lockedSet)
    for (const k of r.kicks) {
      checked++
      // 'locked' word nudges are forced regardless of S; only in-S nudges must be members of the signed set.
      if (k.trigger === 'in-S' && !sv.has(k.lemma)) {
        return { ok: false, checked, reason: `word nudge "${k.lemma}" not in signed set v${r.setVersion}` }
      }
    }
  }
  return { ok: true, checked }
}

// The readable header is written by composeTraceFile as `pmToText(document.contentJson)`. Re-derive
// it and require a match: a tamperer cannot alter the prose a human reads without it diverging from
// the bundle's own content. Absent text (legacy pure-JSON bundle) = nothing to bind, so it passes.
function checkTextIntegrity(bundle: ExportBundle): VerifyReport['textIntegrity'] {
  if (bundle.text == null) return { ok: true }
  return bundle.text === pmToText(bundle.document.contentJson)
    ? { ok: true }
    : { ok: false, reason: 'the readable writing does not match the document content (header altered)' }
}

// Is the displayed/current content a SIGNED state? It's strongest when its hash matches a receipt's
// signed contentHash (verified in the chain step); next, a recorded snapshot; otherwise it's trailing
// edits made after the last signed checkpoint (legitimate, but surfaced — not cryptographically attested).
async function checkContentBinding(bundle: ExportBundle): Promise<VerifyReport['contentBinding']> {
  const dh = await sha256Hex(canonicalize(bundle.document.contentJson))
  if (bundle.receipts.some((r) => r.contentHash === dh)) return { state: 'signed', note: 'the readable writing is a signed, verified state' }
  if (bundle.snapshots.some((s) => s.contentHash === dh)) return { state: 'snapshot', note: 'the readable writing matches a recorded snapshot' }
  return { state: 'unsigned', note: 'the readable writing includes edits made after the last signed checkpoint' }
}

function frictionScore(bundle: ExportBundle): VerifyReport['friction'] {
  const nudges = bundle.receipts.reduce((n, r) => n + r.kicks.length, 0)
  const contentWords = countWords(bundle.document.contentJson)
  const onePerWords = nudges > 0 ? Math.round(contentWords / nudges) : null
  // A document with implausibly little friction proves little — surface the number, don't hide it.
  const note =
    nudges === 0 ? 'no word nudges recorded — proves little about live composition'
    : onePerWords && onePerWords > 200 ? `low friction (~1 nudge per ${onePerWords} words)`
    : `~1 nudge per ${onePerWords} words`
  return { nudges, contentWords, onePerWords, note }
}

// Cadence (paid): the cadenceDigest is already covered by each receipt's signature (verified in the
// chain step). Here we (a) confirm any REVEALED bins match that signed digest — so the writer-held
// bins can't be doctored after the fact — and (b) surface a plausibility read on the revealed bins.
async function verifyCadence(bundle: ExportBundle): Promise<VerifyReport['cadence']> {
  let withDigest = 0, revealed = 0, bins = 0, ins = 0, del = 0, pasteSuspectBins = 0
  let integrityOk = true
  let mismatch: string | null = null
  for (const r of bundle.receipts) {
    if (r.cadenceDigest) withDigest++
    if (!r.cadence) continue
    revealed++
    if ((await cadenceDigest(r.cadence)) !== r.cadenceDigest) { integrityOk = false; mismatch ??= `receipt ${r.counter}` }
    for (const b of r.cadence) {
      bins++; ins += b.ins; del += b.del
      if (b.ins > PASTE_INS_PER_BIN) pasteSuspectBins++
    }
  }
  const note =
    withDigest === 0 ? 'no cadence recorded (free tier or cadence not enabled)'
    : revealed === 0 ? `${withDigest} signed cadence digest(s); bins not revealed in this bundle`
    : !integrityOk ? `cadence bins do not match the signed digest (${mismatch})`
    : pasteSuspectBins > 0 ? `${pasteSuspectBins} of ${bins} bins exceed human typing speed — likely paste`
    : `${bins} bins consistent with the signed digest; no paste-speed bins`
  return { withDigest, revealed, bins, ins, del, integrityOk, pasteSuspectBins, note }
}

// REAL Bitcoin anchoring verification (the M5 security fix). For each snapshot we deserialize the OTS
// proof, confirm it commits to that snapshot's bundleHash, and check the committed digest against the
// cited block's merkle root via independent explorers. The author's claimed status/block/time are
// cross-checked — claiming a block we can't confirm, or a different block/time than the proof yields,
// is `tampered` and fails the bundle.
async function verifyAnchors(bundle: ExportBundle, fetchBlock: BlockFetcher): Promise<VerifyReport['anchor']> {
  let confirmed = 0, pending = 0, unstamped = 0, inconclusive = 0, tampered = 0
  let earliest: string | null = null
  let timeConsistent = true
  const reasons: string[] = []

  for (const s of bundle.snapshots) {
    const ots = s.ots
    // No proof bytes at all → legitimately not anchored (free tier / not yet stamped). Not a failure…
    if (!ots.proofBase64) {
      // …unless the bundle CLAIMS it's anchored without carrying a proof. That's a bare lie.
      if (ots.status === 'confirmed' || ots.status === 'pending') {
        tampered++; reasons.push(`snapshot ${s.id}: claims "${ots.status}" but carries no proof`)
      } else unstamped++
      continue
    }

    const res = await verifyOtsProof(ots.proofBase64, s.bundleHash, fetchBlock)
    if (res.status === 'confirmed') {
      confirmed++
      // Cross-check the author's claims against what the proof actually yields.
      if (ots.bitcoinBlock != null && ots.bitcoinBlock !== res.height) {
        tampered++; reasons.push(`snapshot ${s.id}: claims block ${ots.bitcoinBlock} but proof anchors to ${res.height}`)
      }
      if (res.blockTime && (!earliest || res.blockTime < earliest)) earliest = res.blockTime
      // serverTime can't post-date the block that anchors the snapshot's receipts.
      for (const r of s.receipts ?? []) {
        if (res.blockTime && r.serverTime > res.blockTime) {
          timeConsistent = false
          reasons.push(`snapshot ${s.id}: a receipt's serverTime (${r.serverTime}) is after the Bitcoin block time (${res.blockTime})`)
        }
      }
    } else if (res.status === 'pending') {
      pending++
      if (ots.status === 'confirmed') { tampered++; reasons.push(`snapshot ${s.id}: claims "confirmed" but proof is only pending`) }
    } else if (res.status === 'inconclusive') {
      inconclusive++ // couldn't reach an explorer — can't confirm, can't refute
    } else {
      // 'unverified' — a present proof that fails binding or the merkle check: tampering.
      tampered++; reasons.push(`snapshot ${s.id}: ${res.reason ?? 'proof does not verify'}`)
    }
  }

  // Informational: which verified receipts are actually committed by a snapshot (and so anchored).
  const anchored = new Set<string>()
  for (const s of bundle.snapshots) for (const r of s.receipts ?? []) anchored.add(r.signature)
  const anchoredReceipts = bundle.receipts.filter((r) => anchored.has(r.signature)).length

  const ok = tampered === 0 && timeConsistent
  const note = !ok
    ? reasons.slice(0, 3).join('; ')
    : confirmed > 0
      ? `${confirmed} snapshot(s) verified against Bitcoin${earliest ? ` (earliest block ${earliest.slice(0, 10)})` : ''}${inconclusive ? `; ${inconclusive} unconfirmable offline` : ''}`
      : pending > 0 ? `${pending} awaiting Bitcoin confirmation`
      : inconclusive > 0 ? 'could not reach a block explorer — anchoring unconfirmed'
      : 'no Bitcoin anchoring in this bundle'
  return { snapshots: bundle.snapshots.length, confirmed, pending, unstamped, inconclusive, tampered, earliestBlockTime: earliest, timeConsistent, anchoredReceipts, ok, note }
}

/**
 * Verify an export bundle end-to-end. Defaults to the INDEPENDENTLY published signing key — a
 * verifier must not trust the key the bundle carries.
 */
export async function verifyBundle(
  bundle: ExportBundle,
  pubKeyHex: string = PUBLISHED_SIGNING_PK,
  fetchBlock: BlockFetcher = defaultFetchBlock,
): Promise<VerifyReport> {
  const contentIntegrity = await checkContentIntegrity(bundle)
  const chain = await checkChains(bundle, pubKeyHex)
  const nudgeConsistency = checkNudgeConsistency(bundle)
  const friction = frictionScore(bundle)
  const cadence = await verifyCadence(bundle)
  const anchor = await verifyAnchors(bundle, fetchBlock)
  const textIntegrity = checkTextIntegrity(bundle)
  const contentBinding = await checkContentBinding(bundle)
  const existence = { snapshots: anchor.snapshots, confirmed: anchor.confirmed, pending: anchor.pending, unstamped: anchor.unstamped }
  // A bundle fails if content/chain/nudge integrity fails, the readable header doesn't match the
  // content, revealed cadence contradicts its signed digest, OR a Bitcoin proof is forged / its
  // claimed block/time is a lie (anchor.ok). Absent or merely-unconfirmable anchoring, and trailing
  // unsigned edits, never fail a bundle — plausibility is surfaced, not asserted.
  const overall = contentIntegrity.ok && chain.ok && nudgeConsistency.ok && textIntegrity.ok && cadence.integrityOk && anchor.ok
  return { contentIntegrity, chain, nudgeConsistency, kickConsistency: nudgeConsistency, friction, cadence, anchor, textIntegrity, contentBinding, existence, overall }
}
