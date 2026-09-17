<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Provenance spine (M0–M5, shipped)

- **SCAS verdicts FREEZE at commit** — `S_v` rotation never reflows committed text; a deleted kicked
  word LOCKS (forced kick on retype, suppressed from popovers); a swap resolves it. The single most
  important behavioural invariant. `RedHighlightExtension` RENDERS engine state (locked ∪ liveKicks),
  never recomputes vocab.
- Snapshots (`provenance/snapshots.ts`, OPFS, append-only, grow-only) mint on a resolved kick when the
  contentHash changed — typing and pastes never snapshot. Hashing: `provenance/hash.ts` (RFC 8785 JCS
  + SHA-256 + bundleHash).
- **OTS never runs on load.** `javascript-opentimestamps` lives in a stateless relay (`api/ots.mjs` +
  `api/_ots-core.mjs`, mirrored by dev middleware in vite.config.ts): logs nothing, handles only a
  hash. `vercel.json` excludes `/api` from the SPA rewrite.
- The signing service is stateless and content-free (`api/_provenance-core.mjs`, `session.mjs`,
  `sign.mjs`): Ed25519, seed `H(masterSecret, docId, v)`, S_v index sampling → bitmask. The editor
  drives SCAS off the server's S_v (`controller.useServerSet`) and signs each period's receipt (hashes
  only). Offline ⇒ fall back to local S_v and degrade VISIBLY. Keys from env
  (`INKWAVE_SIGNING_SK`/`INKWAVE_MASTER_SECRET`/`VITE_SIGNING_PK`), published at
  `/.well-known/inkwave-signing-key.json`.
- **The api handlers — one wrapper, `api/_handler.mjs` (2026-09-15).** `jsonPost({rate, call, fail})`
  is the shape session.mjs and sign.mjs share byte-for-byte (405 → per-IP 429 JSON → object-or-JSON-
  string body → content-type → core → fixed error body); `readRawBody` is the one copy the two payment
  webhooks read the exact bytes through. **A webhook keeps its raw body; a wrapper never parses it** —
  Stripe/PayPal/Clerk sign the bytes they sent and a parse→stringify drops whitespace, which
  `handlers.wire.test.ts` proves with a re-serialised payload that no longer verifies. Only 4 of 13
  entry points fit; the other 9 are each one wire byte away (ots sets content-type AFTER the core and
  answers 502; sync-profile ignores the body; summarise/pdf answer 429 without a content-type; reader is
  GET; me answers any method) and a handler that needs a flag to fit is NOT wrapped. Every path of all
  13 is pinned in `src/api/handlers.wire.test.ts` (76 tests, written BEFORE the wrapper, cores stubbed).
  NB the dev middleware (vite.config.ts) calls the CORES for /api/session, /api/sign, /api/ots — a dev
  server never runs those three handlers; only production and the wire test do.
  Layout of `api/`: Vercel Node functions (plain .mjs; not in any tsconfig — see
  apiFunctionsParse.test.ts); `_handler.mjs` = jsonPost (session, sign) + readRawBody (the webhooks),
  wire pinned by src/api/handlers.wire.test.ts; `_*.mjs` = cores + helpers (provenance, ots, reader,
  billing, auth, ratelimit), never routes.
- `provenance/bundle.ts` builds the self-verifying bundle; `src/verify/index.ts` + `/verify` check it
  against the INDEPENDENTLY published key, client-side, no login.
- **HONEST GAP:** full "no silent dodging" replay needs per-period content diffs (the bundle carries
  period content *hashes* only); kick-consistency + friction are the current conformance signals.
- **Keep `composeTraceFile()`'s hybrid header** — writing first, then the rule, then
  `TRACE_DATA_MARKER`, then two lines of plain English. It is what lets an agent with no format
  knowledge read a `.studio`. **`bundle.text` is the canonical readable copy — never walk
  `contentJson`.** Pending asks (a lite export dropping `pdfs`/`proofBase64`/`lockedSet`; a
  machine-facing line beside the marker): `docs/specs/Inkwave-Agent-Readability-BuildSpec-v0.1.md`.

## SCAS + editor conventions (READ BEFORE EDITING)

- **Enter = new paragraph; Shift+Enter = hard break** (StarterKit default; the inverted
  `enterBehavior` extension was removed).
- **The word-cycle replaced the dropdown popover — don't reintroduce a dropdown.** Slots: 0 = original
  word, 1–6 = synonyms (cycled if Datamuse returns fewer), 7 = ⌫ delete sentinel; j decrements, k
  increments, current in the middle row.
- **No vocabulary filter on suggestions** — all Datamuse candidates show; the writer decides fit.
- **Line compression** (`computeLineCompressionRange`) tightens letter-spacing around a focused word
  to absorb its expansion in place. Pixel-measured and regression-prone: test wrapped lines and
  first-word-on-line cases.
- Provenance events funnel through `compliance.ts` (accept/ignore); the record is snapshots + signed
  receipts.
- **Document IDs are stable UUIDs** (future room identifiers) — don't change the scheme.
- **`pmToText(doc, resolveCitations)` must stay byte-deterministic at `false`** — verify and bundle
  depend on it; SnapshotView passes `true` for display only.
- **SCAS suggestions are OFF by default**, opt-in in Settings. Inverse key retained:
  `inkwave:scasOff='0'` is explicit ON, `'1'` OFF, absent/unreadable takes the OFF default.
  Display-only — the provenance engine keeps remembering underneath.

