// The in-product copy for the email layer — ONE source of truth, deliberately not inlined in JSX.
//
// WHY THIS FILE EXISTS. Spec §B2.2 and §C1.4 make the wording an ACCEPTANCE CRITERION, not a
// nicety: "Overclaiming on a trust brand is existential." The crypto here does something precise and
// genuinely useful, and something narrower than a reader might assume:
//
//   WHAT IT PROVES      this exact content (headers + body) existed by time T, anchored in Bitcoin,
//                       verifiable by anyone at /verify without trusting Inkwave and without access
//                       to any inbox.
//   WHAT IT DOES NOT    that the email was sent. Or delivered. Or read. Or that it came from you.
//                       OpenTimestamps timestamps a hash; it cannot witness an SMTP transaction.
//                       Proof of ORIGIN needs DKIM — the provider's own signature over the sent
//                       bytes — which is Phase 3 and is NOT in this build.
//
// And because the handoff (§B2.3a) hands the draft to the provider's compose window, the user can
// edit it before sending. So even the *draft* claim is scoped to the Inkwave draft, not the sent
// bytes. The copy below says exactly that, in the user's words, and nothing more.
//
// The temptation is always to write the better-sounding sentence ("cryptographic proof you sent
// it"). If a change here starts sounding stronger than the paragraph above, it is wrong. Tests in
// copy.test.ts assert the forbidden claims are absent — but a test cannot check a sentence it has
// never seen, so read the boundary before editing.

/** The one-line label beside the finalise action. */
export const FINALISE_LABEL = 'Record this draft'

/** Always-visible honesty line on the focused email surface; the longer explanation is disclosed. */
export const PROVENANCE_BRIEF =
  'Recording proves this exact draft existed by this time — not that it was sent, delivered, or read.'

/**
 * The primary explanation, shown before the user finalises. States the claim and its limit in the
 * same breath — the limit is never a footnote or a tooltip, because a limit the reader has to go
 * looking for is a limit the product is hiding.
 */
export const PROVENANCE_EXPLAINER =
  'Recording this draft submits its fingerprint for timestamping on the Bitcoin blockchain. Once ' +
  'confirmed, it is a permanent, independently verifiable record that this exact email — ' +
  'recipients, subject and body — existed by this date and time. Anyone can check it at /verify, ' +
  'without an inbox and without trusting Inkwave.'

/**
 * The limit. Sits immediately under the explainer, at the same visual weight — not greyed out, not
 * smaller. This is the sentence §B2.2 requires to exist.
 */
export const PROVENANCE_LIMIT =
  'It does not prove that you sent the email, that it arrived, or who it came from. It proves you ' +
  'had written exactly this, by this time — which is what matters for showing priority, or that a ' +
  'commitment was made on a given date.'

/**
 * Shown once the draft is recorded. TWO precisions, both load-bearing:
 *
 * 1. Tense. At this moment the OpenTimestamps proof is PENDING, not confirmed — Bitcoin takes hours
 *    (`OtsProofState`: unstamped → pending → confirmed, and the ◈ ReceiptPanel is where that status
 *    actually lives). "Is anchored to Bitcoin" would be true only later, so it is not said here. A
 *    provenance product that rounds "submitted" up to "anchored" has already started lying.
 * 2. Still not sending. Same boundary as everywhere else, in the past tense.
 */
export const PROVENANCE_RECORDED =
  'This draft is recorded, and its timestamp has been submitted to the Bitcoin blockchain — ' +
  'confirmation takes a few hours, and the ◈ panel shows the status. It records that this content ' +
  'existed by the time shown, not that it was sent.'

/**
 * Shown at the handoff. The provenance is of the INKWAVE DRAFT; the user can edit in the provider's
 * window before sending, and we would never know. Saying so is not a disclaimer, it is the honest
 * description of what the handoff is.
 */
export const HANDOFF_EXPLAINER =
  'This opens your email provider with the draft filled in. You send it from there, as usual — ' +
  'Inkwave never sends mail and never connects to your inbox. Anything you change in your ' +
  "provider's window afterwards is outside the recorded draft."

/** Shown when the Gmail API adapter is configured. Scope and transport are stated at point of use. */
export const GMAIL_SEND_EXPLAINER =
  'Send with Gmail asks Google for permission to send email only — never to read your inbox. The ' +
  'record is created first, then this browser sends the message directly to Gmail; Inkwave does ' +
  'not receive or store the message or your Google access token. Provider handoff remains available.'

/**
 * The storage claim. Two things this must NOT say, for two different reasons:
 *
 * 1. NOT "end-to-end encrypted" — that would require the RECIPIENT to run PGP/S-MIME, which we
 *    neither do nor can (§B5).
 * 2. NOT "encrypted", full stop — VERIFIED IN THE CODE 2026-07-17 AND IT IS NOT TRUE OF THIS BUILD.
 *    Spec §C2 says at-rest encryption is "default on", but that is design INTENT: `storage/opfs.ts`
 *    writes `JSON.stringify(data)` through writeOpfsFile in PLAINTEXT, there is no
 *    `crypto.subtle.encrypt` / AES-GCM anywhere in src, and package.json carries no crypto library.
 *    Documents, snapshots and now emails are gzip'd JSON in OPFS — protected by the browser's origin
 *    sandbox and the device's own disk encryption, NOT by Inkwave. Saying "encrypted" here would be
 *    the §C1.4 overclaim word-for-word, on the exact axis the brand is sold on.
 *
 * What IS true, and is what the sentence says: the draft lives on the user's device and Inkwave's
 * servers never hold it (zero-retention is real — there is no server to hold it). When §C2's
 * encryption actually ships, this sentence can grow the word "encrypted" and not before.
 */
export const STORAGE_CLAIM =
  'Your draft is stored on your device, like any other Inkwave document — we never hold it. Once ' +
  'you send it, it travels as ordinary email: this is not end-to-end encrypted mail.'

/** Why the compose lives here at all (§B1) — the productivity rationale, stated plainly. */
export const LEDGER_NOTE =
  'Time spent writing here counts toward your writing stats, like any other document.'

/** The over-long-draft message; see sender.ts `fits`. */
export const TOO_LONG_HINT =
  'Long or richly formatted emails do not fit in a compose link. Copy the text across instead — ' +
  'your draft and its record are unaffected.'
