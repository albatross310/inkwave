# Inkwave — AI Integrity: Build Specification

**Version:** 0.1 (working draft)
**Date:** September 2026
**Status:** Design specification only. No AI-account monitoring, provider login, extension capture, TEE,
or AI Integrity user interface is implemented by this document.

---

## 0. Product claim

AI Integrity is a user-owned, local-first timeline of the instructions and memory items observed on
AI accounts the user deliberately connects. Its purpose is to help a writer document the boundaries
under which they used AI and associate that evidence with Inkwave's existing authorship record.

The strongest claim the first version may make is:

> For these disclosed provider accounts, Inkwave observed these exact memory items at these stated
> observation points, and the observation record has not been silently changed or reordered.

It must never claim:

- that the user had no other AI accounts, devices, browser profiles, local models, or human help;
- that a provider actually applied a memory item to a particular response;
- that an item remained unchanged between samples;
- that an ordinary local clock is authoritative; or
- that a DOM observation reveals a provider's hidden internal state.

The feature is **declared-account provenance**, not an anti-cheating certificate. That limitation is
part of the primary UI and export, not buried in help text.

---

## 1. Surfaces and navigation

### 1.1 Entry points

AI Integrity is available from both:

1. **Hamburger menu → AI Integrity**, from any editable document; and
2. **Snapshots top bar → AI Integrity**, beside the existing snapshot/editor navigation.

Both entry points open a standalone route:

```text
/ai-integrity?doc=<document-id>&from=<editor|snapshots>&snap=<optional-snapshot-id>
```

The `doc` and `snap` values provide return context only. They do not make the global integrity ledger
belong to that document.

### 1.2 Return navigation

- The page shows **Back to editor** whenever a valid originating document exists.
- It shows **Back to Snapshots** whenever the originating document has snapshot context.
- If entered globally with no document context, it shows **Back to Inkwave**.
- Returning preserves the document ID, snapshot ID, pane state, and scroll position where available.
- Opening and returning must not mutate the document, create a snapshot, or create browser-history
  traps. The user can still use the browser Back action normally.

### 1.3 Page layout

The first useful page contains:

- **Monitor status:** Active, Paused, Needs sign-in, Browser closed, or Observation overdue.
- **Last observation:** provider/account, timestamp, duration since last success, and chain status.
- **Connected accounts:** N accounts across N providers, each separately consented and removable.
- **Memory timeline:** item additions, changes, and observed disappearances, with gaps shown inline.
- **Evidence drawer:** exact text, optional screenshot, capture method, byte/content hashes, and proof.
- **Proof status:** local chain only, timestamp pending, Bitcoin confirmed, or verification failed.
- **Attach to this document:** reference a selected verified interval from the originating document's
  next global snapshot; do not copy the observation payload into the document.
- **Snapshot coverage:** each snapshot card/row shows a frozen AI Integrity coverage indicator for
  the interval ending at that snapshot.

Account email addresses and memory text are hidden in overview cards by default. Revealing either is
an explicit local action.

### 1.4 Developer-preview gate

Before public release, every entry into AI Integrity shows a blocking disclosure before requesting
permissions or starting/resuming observation:

> **AI Integrity is still under development and only intended for the developer at this stage.**

- Actions: **Leave AI Integrity** and **Continue as developer**.
- Continue is a session-scoped acknowledgement, not consent that persists forever.
- No provider page, account identity, memory item, or extension permission is read before Continue.
- The route and menu/top-bar entries remain behind a developer-preview flag or developer account
  allow-list until the warning, privacy controls, failure states, and verification are browser-proved.
- Removing the preview restriction requires a deliberate product decision and Privacy Policy review;
  it is not a flag-default change made as part of implementation cleanup.

### 1.5 Sign-in and document enrolment

- AI Integrity is a **sign-in-only** tool, including the developer preview. Ordinary Inkwave remains
  account-optional.
- Signing in establishes the Inkwave account identity attached to declared provider connections,
  monitor devices, and signed health leases. It does not move raw documents or memories to an
  Inkwave server.
- AI Integrity is enabled per document by an explicit **Use AI Integrity for this document** action.
- Enrolment records the selected provider accounts, chain epochs, monitor device public key, start
  observation, and enforcement mode in the document.
- Enrolment immediately creates a global document snapshot. A document cannot silently become
  “protected” without a dated boundary showing when coverage began.
- A document may be unenrolled only through an explicit action that creates a final snapshot and
  permanent **AI Integrity ended by user** event.

### 1.6 Two-machine developer topology

The initial deployment is explicitly two-machine:

- **Watcher device:** Peter's always-on HP Z440. It holds the dedicated AI-provider browser profile,
  observes authorized memory pages every minute, stores raw evidence, advances observation chains,
  and signs health leases.
- **Writer device:** the computer currently running the Inkwave editor. It receives and verifies
  signed Watcher envelopes, shows AI Integrity history/status, binds coverage to snapshots, and
  applies the editing-only document gate.

The devices sign into the same Inkwave account for discovery, but account authentication is not the
integrity mechanism. The Writer trusts only the Watcher public key exchanged during explicit device
pairing. A relay or compromised application server cannot manufacture a healthy lease.

---

## 2. Monitoring model

### 2.1 Developer-preview cadence and performance

- The developer-preview observation interval is fixed at **one minute**.
- If a later public version makes cadence configurable, the interface always displays the effective
  interval and never silently weakens it.
- The monitor observes an already authenticated memory surface or supported API; it does not force a
  full provider-page reload every minute when a cheaper reliable observation is possible.
- An unchanged sample writes a compact observation containing the same `itemsRoot`; it does not copy
  the exact text, screenshot, or provider response again. Evidence is content-addressed and reused.
- A new full evidence payload is stored on first observation, on an observed change, on explicit user
  capture, and when a connector requires fresh evidence for source authentication.
- Minute observations are hash-chained locally and Merkle-batched. They do not create one OTS/network
  request per minute.
- Phase-1 performance budget on the dedicated developer machine: under 100 ms foreground-main-thread
  work per observation, no visible foreground-tab focus/scroll change, no overlapping runs, and no
  persistent growth proportional to unchanged raw evidence.
- If an observation is still running at the next minute boundary, skip overlap, record **Overdue**,
  and finish or fail the in-flight attempt. Never queue an unbounded backlog.
- A sample is never fabricated to fill a missed interval.
- At 90 seconds without a successful default-cadence observation, status becomes **Overdue**.
- Sleep, browser shutdown, sign-out, network loss, extension suspension, provider errors, and machine
  shutdown produce explicit gaps.

One-minute sampling limits an unknown interval; it does not eliminate it. If an item is present at
12:00 and absent at 12:01, the honest statement is “disappeared between the successful 12:00 and
12:01 observations,” not “deleted at 12:01.”

### 2.2 Provider/account scope

- The data model supports any number of providers and accounts.
- Only accounts the user explicitly connects are monitored.
- Each connection records the provider, a privacy-preserving stable account fingerprint, the capture
  method, granted scope, consent time, and current authentication health.
- Multiple accounts at one provider remain distinct chains beneath one user-owned ledger.
- The UI permanently states that undisclosed accounts cannot be detected or ruled out.
- Build provider connectors on demand. Claude and ChatGPT are sensible first connectors; adding every
  possible AI without users is maintenance cost, not coverage.

### 2.3 Capture priority

Use the strongest available source in this order:

1. **Provider-signed audit/event log** — preferred when it exists.
2. **Official OAuth API/export endpoint** with a memory/personalisation scope.
3. **Local browser extension observation** of an explicitly authorized memory page.
4. **Manual evidence capture** — pasted screenshot or imported provider export.

OAuth is authorization, not data access by itself. A provider login or generic model API does not
permit memory access unless the provider exposes that resource and scope.

### 2.4 Local extension

The Phase-1 continuous monitor is a local browser extension:

- optional host permission per provider, requested only when the account is connected;
- page access limited to the provider's memory/preferences routes;
- no reading of conversations, inboxes, unrelated settings, browsing history, or other tabs;
- one-minute background alarm while the browser is running;
- reuse an existing authenticated page when possible;
- if necessary, open or refresh a background memory tab, observe it, then leave the user's foreground
  tab and focus unchanged;
- send observations directly to local Inkwave; never relay raw memory through Inkwave servers;
- visible indicator of what was most recently read and why;
- one-click Pause that stops capture immediately.

If the browser is closed or the provider is signed out, monitoring stops and the ledger records a
gap. No copy may imply otherwise.

### 2.5 Dedicated local appliance

An optional always-on configuration may run on a user-owned Mac/PC/NAS/home server:

- dedicated OS account and provider-only browser profile;
- full-disk encryption, automatic screen lock, and no default remote administration;
- local watchdog and restart recovery;
- raw evidence stored only on that device;
- outbound access restricted to approved providers, timestamp witnesses, and Bitcoin/OTS services;
- session credentials remain on the user's machine.

This is the recommended always-on route until official provider APIs exist.

### 2.6 Server-coordinated cross-device chain

For the two-machine developer deployment, the Inkwave service is a compact hash-chain coordinator.
It does not run the provider browser and does not receive memory text, screenshots, provider
responses, provider cookies/tokens, document prose, document titles, or file paths.

The server retains:

- Inkwave account ID;
- random `integrityDocumentId` per enrolled document (not the document title or storage path);
- pseudonymous Watcher/Writer device IDs and their public keys;
- signed Watcher observation hashes, item-set roots, gap/health states, and chain heads;
- signed Writer content hashes and sequence numbers;
- lease requests/results, server receipt signatures, and timestamps; and
- Merkle batch roots and OTS proof state.

This is deliberate server-side metadata retention and must be described as such in Privacy. It is a
narrow exception to zero-retention, not disguised as “no data.” Hashes are not document prose, but
they still reveal timing, continuity, account/device linkage, and whether a document changed.

#### Two signed streams

1. **Watcher stream:** the Z440 submits a device-signed observation record every minute. A success
   carries the latest provider-account roots; failures carry an explicit gap status. The server
   verifies and appends but cannot forge a Watcher signature.
2. **Writer stream:** the active Inkwave editor submits a device-signed document content hash on
   enrolment, each durable autosave/checkpoint, every snapshot, focus/visibility exit, and before an
   external/cloud save. It does not ping per keystroke.

Each server row references the prior row hash for its stream. Clients retain acknowledged heads, and
server batches are OTS-anchored, so deletion/reordering/rewrite by the server is detectable.

#### Save certification rule

The server maintains the most recent certified document hash and the Watcher coverage interval that
authorized it. On a Writer checkpoint:

- valid, fresh Watcher chain with no intersecting gap + valid editing lease ⇒ append the new content
  hash and issue a signed **certified checkpoint receipt**;
- unchanged content hash across a Watcher gap ⇒ preserve the gap in history; do not claim continuous
  monitoring, but no unmonitored document change occurred;
- changed content hash across an interval containing a Watcher gap or invalid lease ⇒ refuse a
  certified receipt and return `coverage-broken`.

The server refuses **certification**, never byte preservation. Inkwave still writes already-accepted
work into isolated local recovery storage, marks it unprotected, and offers Sign in/reconnect,
read-only access, export, or the explicit break-glass fork. It must not sync an uncertified state over
the last certified external/cloud file. The original document remains at its last certified content;
uncertified bytes continue only under a new document identity and destination.

The normal path prevents this situation before it occurs: the short-lived lease closes the editor at
expiry, so no new transactions are accepted during a known gap. The changed-hash rule is the race,
crash, offline, and modified-client detector—not the primary data-preservation mechanism.

#### Optional evidence transfer

The server-held chain is sufficient for health, edit gating, snapshot indicators, and hash
verification across machines. Raw evidence stays on the Z440 by default. If the developer enables
evidence viewing on the Writer, the Z440 encrypts content end-to-end to a paired Writer-device key;
the server stores/routes opaque ciphertext and cannot decrypt it.

### 2.7 Cloud/TEE future option

Inkwave must not place an ordinary persistent Claude/ChatGPT session on its application server. A
future cloud monitor is admissible only as a separately consented advanced mode with:

- confidential-computing TEE or enclave;
- reproducible monitor build and published measurement;
- remote attestation verified by the client before credential release;
- session material encrypted to and sealed inside the attested workload;
- strict egress allow-list;
- raw observations encrypted to a user-held key before leaving the workload;
- append-only public transparency log for monitor builds; and
- an explicit account-wide access warning.

“A third party promises not to look” is policy, not a cryptographic boundary. This phase remains out
of scope until its threat model and provider terms have independent review.

### 2.8 Signed health lease and edit gate (“kill switch”)

The monitor emits a short-lived signed health lease after each successful one-minute observation:

```ts
interface AiIntegrityLease {
  v: 1
  inkwaveAccountId: string
  monitorDeviceId: string
  integrityDocumentId: string
  selectedProviderAccountIds: string[]
  healthyMonitorCount: number
  terminalObservationHashes: string[]
  issuedAt: string
  expiresAt: string
  signature: string
}
```

- `healthyMonitorCount === 0`, an invalid signature, wrong Inkwave account, missing selected account,
  or an expired lease closes the AI Integrity edit gate.
- The default lease expires 90 seconds after issue: enough tolerance for one-minute observations,
  without pretending a long outage is covered.
- The editor validates the lease locally against the enrolled monitor device public key. A truthy
  server response or mutable `localStorage` flag is not sufficient.
- Only AI Integrity-enrolled documents are gated. The rest of Inkwave remains usable.
- A closed gate makes the enrolled document **read-only**. Reading, verification, local recovery,
  download, export, and Save a copy remain available at all times.
- Before changing to read-only, Inkwave flushes any transaction already accepted under the previous
  valid lease. It never discards typed text because a heartbeat expired.
- The gate status is visible beside the document title and in every AI Integrity snapshot indicator.
- Sign-in alone is insufficient: the account, provider monitors, chain heads, and lease must all be
  healthy.
- The Writer obtains the lease from the server coordinator, but validates both the server receipt and
  the referenced Watcher signatures/chain heads locally. A compromised coordinator cannot turn an
  unsigned or stale Watcher state into valid coverage.

This mechanism cannot stop a determined user from copying text to another editor, modifying a local
open-source build, creating another AI/provider account, or abandoning the integrity record. Its
purpose is to make the covered Inkwave record internally consistent and make breaks unmistakable,
not to control the user's computer.

#### Break-glass editing

When an enrolled document is opened without the matching Inkwave login or valid lease, show a
blocking choice:

> **This document uses AI Integrity.**
>
> Are you sure you want to edit it without signing in? This will permanently break continuous AI
> Integrity coverage from this point.

Actions:

1. **Sign in / reconnect** — primary.
2. **Keep read-only** — always available.
3. **Edit as an unprotected copy** — deliberate break-glass action requiring a second confirmation.

Break glass must:

- preserve and continue to verify every observation/snapshot before the break;
- append an immutable `integrity-coverage-broken` event with the last valid chain heads and local
  time;
- keep the original document read-only at its last certified content hash;
- create a new document ID containing the latest locally preserved text, including any transaction
  accepted during a race before the gate closed;
- require a new file/cloud identity and never overwrite the original document's linked destination;
- assign the new document title/filename `<title>-integrity-off-since-<TIMESTAMP1>.studio` by default;
  `TIMESTAMP1` is the coverage-break boundary in filename-safe UTC (`YYYY-MM-DD_HH-mm-ssZ`), while
  the UI also shows the equivalent local time;
- create a new genesis snapshot with `forkedFrom` containing the original integrity document ID,
  last certified content hash, snapshot ID, and Watcher chain heads;
- start the copy with **AI Integrity off — forked after coverage break** and no affirmative coverage
  indicator;
- allow later re-enrolment only from a new explicit snapshot/chain epoch, never by filling the gap;
  and
- never use the word “corrupt” for the earlier valid record. The coverage continuity is broken; the
  prior cryptographic record is not corrupted.

#### Integrity returns after a break

When valid monitoring, sign-in, and server leases become available while an
`integrity-off-since-TIMESTAMP1` document is open, do not silently re-enable its indicator. Ask:

> **AI Integrity is available again.**
>
> Do you want to close this unprotected interval and continue in a new AI Integrity file?

Actions:

1. **Create Integrity-on file** — primary.
2. **Keep working without Integrity**.
3. **Not now**.

If accepted at `TIMESTAMP2`:

- flush the unprotected document first;
- close its interval and rename/suggest a new destination name:
  `<title>-integrity-off-between-<TIMESTAMP1>-<TIMESTAMP2>.studio`;
- create a new document ID from its exact current content;
- require a new file/cloud identity so neither predecessor can be overwritten;
- create a genesis snapshot referencing the off-interval document ID/hash and both timestamps;
- enrol the new document against the current valid Watcher chains and server lease; and
- begin affirmative coverage only at the first valid observation/checkpoint boundary at or after
  `TIMESTAMP2`.

If declined, the title remains `integrity-off-since-TIMESTAMP1` and no later healthy ping changes its
historical or current indicator. The prompt may be reopened manually but must not interrupt on every
minute ping.

---

## 3. Observation data model

### 3.1 Account connection

```ts
interface AiIntegrityAccount {
  id: string
  provider: string
  accountFingerprint: string
  displayLabel?: string
  captureMethod: 'provider-signed' | 'oauth-api' | 'extension-dom' | 'manual'
  grantedScope: string[]
  consentedAt: string
  pausedAt?: string
}
```

The fingerprint is stable enough to distinguish two connected accounts without requiring the
overview or public proof to reveal an email address.

### 3.2 Document binding

```ts
interface AiIntegrityDocumentBinding {
  enabledAt: string
  inkwaveAccountId: string
  integrityDocumentId: string
  providerAccountIds: string[]
  monitorDevicePublicKey: string
  chainEpochIds: string[]
  mode: 'required' | 'advisory'
  endedAt?: string
}
```

`required` closes the edit gate on lease failure. `advisory` keeps editing available but freezes the
coverage indicator as a gap. Developer preview defaults to `required`; the choice and consequences
are shown before enrolment.

### 3.3 Immutable observation

```ts
interface AiMemoryObservation {
  v: 1
  id: string
  accountId: string
  provider: string
  observedAt: string          // local ordering clock; not authority
  receivedAt?: string         // signed witness time when available
  intervalSeconds: number
  status: 'success' | 'signed-out' | 'unavailable' | 'permission-lost' | 'error'
  itemHashes: string[]        // sorted canonical memory-item hashes
  itemsRoot: string           // Merkle root of itemHashes
  evidenceHashes: string[]    // text/export/screenshot byte hashes
  captureMethod: AiIntegrityAccount['captureMethod']
  sourceOrigin?: string
  monitorBuildHash: string
  previousObservationHash: string | null
  observationHash: string
}
```

Successful observations may keep exact item text and evidence in a separate local encrypted payload.
The immutable public/core record carries hashes and references, not raw private memories.

### 3.4 Memory-item version

Each normalized item has a provider-local identity when available and a content identity always:

```ts
interface AiMemoryItemVersion {
  accountId: string
  providerItemId?: string
  normalizedText: string
  contentHash: string
  firstObservedIn: string
  lastObservedIn: string
  firstAbsentIn?: string
}
```

Normalization is versioned and conservative: Unicode normalization plus line-ending normalization;
no paraphrasing, whitespace collapsing that changes meaning, or AI interpretation. Exact source bytes
remain hashable evidence.

### 3.5 Global ledger, document references

- Observations live once in a device/account-global **AI Integrity ledger**.
- Documents do not duplicate raw memory text, screenshots, provider exports, or full observations.
- A manual document snapshot may include an optional `aiIntegrityRef` naming:
  - account IDs/fingerprints;
  - first and last observation IDs;
  - the chain head;
  - applicable Merkle batch root/proof; and
  - the exact observation-gap summary.
- When present, a future snapshot bundle version folds an `aiIntegrityHash` into `bundleHash`, using
  the same optional-version pattern as bibliography, email, and music.
- Existing documents and snapshots remain byte-identical when the field is absent. No legacy-specific
  code path is required.

This keeps one source of truth while allowing a thesis/proposal snapshot to say which declared AI
memory state surrounded that writing interval.

### 3.6 Per-snapshot coverage indicator

Each document snapshot displays one of these historical states:

- **AI Integrity on since last snapshot** — green/affirmative; every connected account selected for
  this document has a valid observation chain covering the whole interval from the preceding
  snapshot to this one.
- **AI Integrity gap since last snapshot** — amber; monitoring was configured but the interval
  contains an overdue sample, browser/machine outage, sign-out, permission loss, connector error,
  clock anomaly, chain discontinuity, or a late start.
- **AI Integrity off for this interval** — neutral; no account coverage was selected or monitoring
  was deliberately paused/off.
- **AI Integrity verification failed** — red; referenced observations or proofs no longer verify.
- **AI Integrity coverage broken** — red/black; the user deliberately continued editing through the
  break-glass path. Prior covered intervals remain independently verifiable.
- **AI Integrity off — forked after coverage break** — neutral/amber on the new document identity;
  links back to the final certified snapshot without claiming uninterrupted coverage.
- **AI Integrity off between TIMESTAMP1 and TIMESTAMP2** — frozen on the closed unprotected file when
  the user creates a new Integrity-on successor.

For a document's first snapshot, replace “since last snapshot” with **since document monitoring
began** and show the exact start time. Never imply coverage before the first successful observation.

The affirmative state requires all of the following, evaluated and frozen when the snapshot is
created:

1. At least one account is explicitly selected for this document.
2. The first successful observation is no later than one cadence+tolerance window after the prior
   snapshot boundary.
3. Consecutive successful observations remain within the declared cadence tolerance (90 seconds for
   the one-minute developer preview).
4. The last successful observation and live monitor heartbeat are within tolerance of the new
   snapshot boundary.
5. No failure/gap event or backwards-clock anomaly intersects the interval.
6. Each selected account's observation chain verifies through the frozen terminal chain head.

The snapshot stores the derived coverage state, interval boundaries, selected account fingerprints,
first/last observation IDs, chain heads, and gap IDs. The label must be renderable from that frozen
record without consulting today's monitor state. A later reconnection cannot turn an old amber gap
green, and deleting local evidence cannot silently rewrite the historical state.

The indicator is concise in the snapshot list. Activating it opens AI Integrity at the frozen range,
where the user can inspect accounts, samples, gaps, evidence strength, and timestamp status. It does
not claim the user disclosed every AI account, and its detail view repeats that limitation.

---

## 4. Cryptographic construction

### 4.1 Hash chain

For each account chain:

1. Canonicalize the observation without `observationHash` using RFC 8785/JCS.
2. Compute `SHA-256(canonicalObservation)`.
3. Put the prior observation hash in `previousObservationHash`.
4. Append; never update an existing observation.

Changing, removing, inserting, or reordering a record breaks the chain. A reset creates a named new
chain epoch linked to the final old head; it never silently starts over.

### 4.2 Memory set

- Canonicalize and hash each exact normalized item.
- Sort item hashes lexicographically.
- Build a Merkle root over the sorted set.
- A change to any item, including a one-character edit, changes `itemsRoot`.
- Preserve optional per-item Merkle paths so a user can prove one item without revealing all others.

### 4.3 Time

- `observedAt` is the local machine clock and is labelled as such.
- Detect backwards clock movement and create a visible clock-anomaly event.
- A signed RFC 3161 timestamp or comparable independent time witness may supply tighter observation
  time, stored separately from the local clock.
- OpenTimestamps/Bitcoin proves the batch root existed no later than the confirming block time.
- Neither a hash chain nor Bitcoin retrospectively makes an exact local timestamp authoritative.

### 4.4 Batching

- Add new minute observations to a local Merkle batch.
- Submit one batch root to the existing OpenTimestamps queue periodically and at explicit user
  snapshot/export boundaries.
- Store every observation-to-batch Merkle path so one observation verifies independently.
- Never submit raw memory text, provider account identifiers, screenshots, or session tokens.

### 4.5 Strong source authentication (future)

Where provider signatures do not exist, investigate zkTLS/TLSNotary proofs that selected response
fields arrived from the provider's authenticated TLS origin. These may strengthen provenance while
selectively hiding unrelated account data. They do not grant API access and do not prove state between
requests. Treat as research until supported across the provider's actual transport and independently
audited.

---

## 5. Evidence

### 5.1 Evidence types

- exact provider-returned structured data;
- exact captured memory text;
- provider export archive;
- screenshot pasted/imported into an Inkwave document; and
- provider-signed audit event or future TLS proof.

Every evidence object receives a byte-level SHA-256. A screenshot node inside Inkwave content carries
that hash so a document snapshot commits to the exact image bytes, not merely a mutable local file ID.

### 5.2 Authenticity ladder

The UI and verifier label evidence strength rather than flattening it:

1. **Provider signed**
2. **TLS-origin proved**
3. **Official OAuth API observed**
4. **Local extension observed**
5. **User captured/manual**

A lower tier can still be useful; it simply supports a narrower claim.

### 5.3 Missing or changed evidence

- A missing local screenshot never silently renders as the historical image.
- Loaded image bytes are re-hashed and compared to the hash carried by the node/record.
- A mismatch is a verification failure, not a broken-image placeholder that looks benign.
- Deleting local raw evidence does not delete its hash-chain record. The UI explains that content can
  no longer be displayed but its former commitment remains.

---

## 6. Privacy, consent, and control

- Default local-only. Raw memories and screenshots do not reach Inkwave servers.
- Hashes are still potentially sensitive when derived from guessable short strings; public exports
  should use salted commitments or item-set roots rather than publishing bare short-text hashes.
- Permission is per provider account and revocable.
- The consent screen names the exact page/API, fields read, interval, retention location, and network
  destinations.
- Pause stops collection immediately; Resume creates an explicit gap boundary.
- Disconnect removes authentication and stops monitoring. Local evidence deletion is a separate,
  confirmed operation.
- No conversation content is read merely because the provider account is connected.
- No provider credentials, OAuth tokens, cookies, memory text, or screenshots enter logs.
- Monitoring status is always visible from AI Integrity; no invisible background surveillance mode.

---

## 7. Verification and export

The AI Integrity verifier checks:

1. observation canonicalization and `observationHash`;
2. previous-hash continuity and declared chain epochs;
3. item-set Merkle roots;
4. evidence byte hashes when evidence is disclosed;
5. observation-to-batch Merkle paths;
6. RFC 3161/independent time proofs when present;
7. OpenTimestamps proof against Bitcoin;
8. monitor build attestation when present; and
9. any provider signature or TLS-origin proof.

Exports include a human-readable claim summary before the structured proof. Every export lists:

- connected/disclosed accounts covered;
- date range and observation cadence;
- all gaps and clock anomalies;
- capture/authenticity method per account;
- whether raw evidence is included, encrypted, omitted, or no longer available; and
- the permanent limitation concerning undisclosed accounts and between-sample changes.

---

## 8. Failure semantics

- A failed observation is a record, never an empty successful memory set.
- A failed read must not be interpreted as “all memories deleted.”
- A shorter provider response cannot truncate the known set without a successful, authenticated
  observation explicitly establishing absence.
- Sign-out and permission loss are different statuses.
- Provider markup/API schema changes fail closed and surface **Connector needs update**.
- Concurrent monitors for the same account must elect one writer or merge by observation ID; they
  must never create two competing silent chain heads.
- Storage write failure pauses the monitor and surfaces loudly. Never keep sampling into RAM while
  implying the durable chain is current.
- Timestamp submission failure leaves a locally verifiable pending batch and retries; it never drops
  observations.

---

## 9. Phasing

### Phase 0 — manual evidence

- Paste/import screenshots into ordinary Inkwave documents.
- Bind the node to the image byte hash.
- Snapshot and timestamp through the existing document path.
- AI Integrity page may initially explain that no continuous account monitor is connected.

### Phase 1 — local declared-account monitor

- Standalone AI Integrity page and both entry points.
- Claude/ChatGPT extension connectors only where explicitly authorized.
- Fixed one-minute observations for the developer preview, heartbeat, gap model, local encrypted payloads, hash chain, item Merkle
  roots, and local verification.
- Pause, Resume, Disconnect, delete-local-evidence, and export.
- Inkwave sign-in, per-document enrolment, signed 90-second health leases, read-only failure mode,
  and break-glass coverage events.
- Server-coordinated signed Watcher/Writer hash streams, pseudonymous document IDs, certified
  checkpoint receipts, changed-hash/gap refusal, and OTS-batched server-chain heads.

### Phase 2 — document/snapshot binding

- `aiIntegrityRef` selection from the AI Integrity page.
- Optional snapshot `aiIntegrityHash`/bundle version.
- Combined document + AI Integrity verification and export.

### Phase 3 — official provider integrations

- Replace DOM connectors with OAuth APIs or signed audit logs whenever providers expose them.
- Preserve old observation methods and labels; stronger new evidence must not rewrite history.

### Phase 4 — advanced provenance

- user-owned dedicated appliance tooling;
- optional attested confidential-computing monitor;
- independent time witnesses; and
- researched/audited TLS-origin proofs.

---

## 10. Acceptance criteria

1. Hamburger and Snapshots top bar both open `/ai-integrity` with correct return context.
2. Back to editor/Snapshots restores the originating document and snapshot state.
3. Two providers and two accounts at one provider coexist without identity or chain collision.
4. Default one-minute cadence is visible; a missed sample becomes an explicit gap/overdue state.
5. A failed read cannot appear as an empty memory list or mass deletion.
6. Add, edit, observed disappearance, reappearance, pause, sign-out, and connector failure render as
   distinct timeline events.
7. Mutating any memory text, evidence byte, observation field, order, predecessor, or Merkle path
   causes verification to fail.
8. A pending OTS batch remains locally intact and upgrades without rewriting observation hashes.
9. Raw memory text, screenshots, session cookies, and OAuth tokens never reach an Inkwave server in
   local mode; network inspection confirms this.
10. The provider permission prompt grants no access outside the selected memory surface.
11. Disconnect stops all future reads. Pausing and resuming creates a visible gap.
12. An image pasted into a document survives reload, renders in Snapshots, and fails visibly if its
    stored bytes no longer match the node's SHA-256.
13. Exports visibly state the disclosed-account and between-sample limitations.
14. Existing snapshots without `aiIntegrityRef` remain byte-identical and verify unchanged.
15. Sixty unchanged one-minute observations reuse one evidence payload, create sixty small chain rows,
    create no overlapping jobs, and stay within the foreground performance budget.
16. Every snapshot freezes and displays exactly one AI Integrity coverage state; a planted 91-second
    sample gap prevents the affirmative “on since last snapshot” state, and a later successful sample
    cannot retrospectively make that historical interval green.
17. A zero-monitor, expired, wrong-account, wrong-device, or bad-signature lease makes only the
    enrolled document read-only; text accepted under the prior lease is flushed first, and reading/
    export remain available.
18. Break-glass editing preserves all prior proofs, freezes the original at its certified hash, and
    moves locally preserved newer bytes into a new ID/new save destination with a `forkedFrom`
    genesis snapshot. Neither document can later display the broken interval as continuously covered.
19. A two-machine probe runs the Z440 Watcher and a separate Writer against the coordinator: healthy
    signed minute observations authorize checkpoints; a gap plus changed document hash refuses
    certification while preserving the typed bytes in isolated local recovery.
20. Tampering with the account/document/device identity, Watcher signature, content hash, sequence,
    predecessor, lease expiry, coordinator receipt, or OTS batch proof fails verification.
21. A break at `TIMESTAMP1` produces the filename-safe `integrity-off-since-TIMESTAMP1` identity. A
    later healthy lease only prompts; accepting at `TIMESTAMP2` closes/renames the old interval to
    `integrity-off-between-TIMESTAMP1-TIMESTAMP2` and creates a separately enrolled document ID.

---

## 11. Open decisions

- Which provider and memory surface should be the first real connector?
- Should exact memory text be encrypted inside the global ledger or kept as separately deletable
  evidence referenced by hash?
- What default OTS batching boundary balances latency and cost: hourly, daily, or on document
  snapshot plus a daily backstop?
- Is an independent signed timestamp authority required before Phase 1, or is local ordering plus
  Bitcoin upper-bound time sufficient for the initial claim?
- Should a document bind an automatically inferred work interval or only a user-selected observation
  range? The safer default is explicit selection.
- Which institution-facing export language should be reviewed by academic-integrity specialists?
