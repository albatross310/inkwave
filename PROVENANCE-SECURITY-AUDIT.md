# Provenance & Bitcoin Timestamping — Security Audit

**Scope:** the provenance spine and timestamping surface —
`src/provenance/{hash,receipts,session,snapshots,bundle,ots,kicks}.ts`,
`src/verify/index.ts`, `src/routes/Verify.tsx`, and the server side
`api/{_ots-core,_provenance-core,ots,sign,session,pubkey}.mjs`.

**Method:** static read of the full provenance + verify + relay stack. No code changed.
Every claim is traced to specific lines. Exploits described are reasoned from the code,
not run in-browser — the critical one should be confirmed by editing an exported bundle.

**TL;DR.** The cryptographic core is genuinely solid — the Ed25519 receipt chain is
tamper-evident, canonicalisation agrees byte-for-byte across client/server/verifier, and
the verifier checks against the *published* key rather than the bundle's claimed key. But
the **Bitcoin timestamping layer is unverified end to end**: `/verify` advertises checking
"against Bitcoin" and performs no Bitcoin verification whatsoever — it trusts the `ots`
status/block/time fields as plain author-supplied JSON. As built, the existence-time
guarantee reduces to "trust Inkwave's signed `serverTime`," which is the one thing OTS was
supposed to remove. That single gap is the priority; the proof bytes are already in the
bundle, so the fix is additive verification logic, not a data-model change.

---

## Critical

### C1 — OTS/Bitcoin proofs are never verified; "Bitcoin anchoring" is self-asserted. *(Critical)*

`src/verify/index.ts:102-110` (`existenceTally`) is the **only** place the verifier touches
timestamping, and it reads the status string straight from the bundle:

```ts
if (s.ots.status === 'confirmed') confirmed++
else if (s.ots.status === 'pending') pending++
else unstamped++
```

The proof bytes (`s.ots.proofBase64`) are never decoded, never checked to commit to
`s.bundleHash`, and never verified against a Bitcoin block header. The claimed
`bitcoinBlock` / `bitcoinTime` are trusted verbatim.

**Exploit (no keys, no compute):** open any exported `.trace.json` and edit each snapshot's
`ots` block to:

```json
"ots": { "status": "confirmed", "bitcoinBlock": 800000, "bitcoinTime": "2024-01-01T00:00:00.000Z" }
```

Drop it into `/verify`. The signed chain still verifies (untouched), so `overall` is `true`
and the page reports **✓ Authentic Inkwave record** with a forged Bitcoin existence date.
`proofBase64` can be garbage or absent — nothing reads it.

This voids the property the OTS layer exists to provide: an Inkwave-*independent*
existence-time. Since `serverTime` (Inkwave-signed) is the only time the verifier actually
checks, there is currently **no Inkwave-independent timestamp at all** — a holder of
`INKWAVE_SIGNING_SK` (i.e. Inkwave) can mint a valid chain with any `serverTime` and the
unverified `ots` fields rubber-stamp it.

The `/verify` UI compounds this: `Verify.tsx:46` and the green ✓ banner both state
verification runs "against … Bitcoin" — a claim the code does not back.

**Fix.** The proof bytes are already in the bundle, so this is additive:
1. In the verifier, for each snapshot decode `proofBase64`, confirm its leaf digest equals
   `s.bundleHash` (reject otherwise), walk the OTS ops to the Bitcoin merkle root, and check
   that root against a block header obtained **independently of Inkwave** (public
   block-explorer / Bitcoin-node API, or a bundled recent-headers checkpoint). Derive
   `bitcoinTime` from the verified header, ignoring the bundle's claimed value.
2. Make `existence` a pass/fail dimension and fold a claimed-vs-verified mismatch into
   `overall` (or at minimum surface "claims confirmed but proof unverifiable" loudly).
3. Cross-check `serverTime` ≤ verified block time; flag receipts signed after the block
   they anchor into.

The bundling concern noted in `ots.ts:3-7` is about the *Node* `javascript-opentimestamps`
lib; a minimal browser-side proof-walker (SHA256 / append / prepend ops + a header check) is
small and keeps verification Inkwave-independent. Verifying via the existing relay would work
but reintroduces an Inkwave server into the verify loop — against the stated goal.

---

## Medium

### M1 — Relay-reported "confirmed" is trusted in the live path. *(Medium)*

`api/_ots-core.mjs:33-48` (`otsUpgrade`) *does* correctly verify the proof commits
`bundleHashHex` before returning `confirmed`. But the client (`snapshots.ts:140-149`) stores
whatever the relay returns without re-verifying. A malicious or MITM'd `/api/ots` can return
`confirmed` + arbitrary block/time, which flows into the bundle and (per C1) is never
re-checked. Independent verification at `/verify` closes this too.

### M2 — The OTS-anchored receipt set isn't tied to the chain-verified set. *(Medium)*

`bundleHash` commits to the snapshot-embedded `s.receipts` (`snapshots.ts:95`), but
`checkChains` / `checkKickConsistency` verify the *top-level* `bundle.receipts`
(`verify/index.ts:58-88`). Nothing asserts these are the same receipts. So even once OTS is
verified, the Bitcoin anchor could cover a different receipt set than the one shown as
verified. Add a check that each snapshot's `receipts` are a consistent subsequence of the
verified top-level chain.

### M3 — No anti-abuse on `/api/session` and `/api/sign`. *(Medium)*

Acknowledged in `session.mjs:3`. Both are unauthenticated and stateless and will sign any
well-formed hash for any `docId` / `setVersion` / `counter` / `prevHash` an attacker
constructs offline. Rate-limiting / PoW won't fix backdating (only OTS does) but should land
before launch to prevent signing-oracle abuse.

---

## Low / hardening

- **L1 — Unvalidated hex/base64 decode.** `receipts.ts:34-44` (`fromHex`/`fromBase64`):
  malformed input yields `NaN`→`0` bytes silently rather than rejecting. Verification still
  fails closed on a bad signature, but explicit length/charset validation is cleaner.
- **L2 — JCS is a documented subset.** `hash.ts:10-13` — fine for current
  integer/string/bool/null data, but nothing guards against a non-integer float entering a
  hashed structure (e.g. a future metric / `cadenceDigest`), which would silently diverge
  client vs server canonicalisation. Add a runtime assert in `serialize` for non-integer
  numbers.
- **L3 — `parseTraceFile` parses untrusted files unguarded.** `bundle.ts:194-198` does
  `JSON.parse` on attacker-supplied files before `verifyBundle`, with no size/shape cap. Low
  risk (client-side, user's own browser); add a size cap and try/catch boundary. Also bind
  the human-readable `.trace.json` text header to the signed `contentJson` so the legible
  copy can't drift from the verified record.

---

## Confirmed clean

- Ed25519 receipt chain: counter / `prevHash` / `kicksHash` / `lockedSetHash` all re-derived
  on verify, so tamper / reorder / splice / altered-kick all break (`receipts.ts:72-126`).
- Canonicalisation (RFC 8785 / JCS subset) agrees byte-for-byte between `hash.ts` and
  `_provenance-core.mjs`.
- Verifier defaults to the committed published key `b1fa2bad…`, not the bundle-claimed key
  (`verify/index.ts:116`, `receipts.ts:22`).
- Kick-consistency correctly ties logged in-S kicks to the signed set via `bitmaskToLemmas`
  (`verify/index.ts:75-88`).
- Server is stateless and content-free: receives only hashes, logs nothing, stores no
  provenance DB (`_provenance-core.mjs`, `_ots-core.mjs`).

---

## Bottom line

The signing / chain layer delivers what it claims. The Bitcoin timestamping layer does not:
`/verify` advertises Bitcoin verification but performs none, so the existence-time guarantee
is currently equivalent to "trust Inkwave's signed `serverTime`." Fixing C1 is the priority;
because the proof data is already present in every bundle, the fix is verification logic in
`src/verify/`, not a change to the stored record.

*Audit performed 2026-06-13/14 against `master` @ `d552768`. Static read only; the C1
exploit should be confirmed by editing an exported bundle's `ots` fields and re-running
`/verify`.*
