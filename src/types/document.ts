// ─── Citation / bibliography types (M-Zotero) ────────────────────────────────

export interface CSLItem {
  id: string
  type: string
  title?: string
  author?: { family?: string; given?: string; literal?: string }[]
  issued?: { 'date-parts'?: number[][]; raw?: string }
  DOI?: string
  'container-title'?: string
  [k: string]: unknown
}

// Where a citation's metadata came from. 'crossref' = resolved from a DOI (verified);
// 'ai' = extracted by the LLM from a page (checkable); 'manual' = user-entered.
// 'library' = mixed/native store; 'zotero-bbt' kept only so old persisted docs still read.
export type CitationSource = 'library' | 'crossref' | 'ai' | 'manual' | 'zotero-bbt'

// Per-field provenance carried on a CSLItem (via the [k:string] index) under `_iw`.
export type FieldSource = 'crossref' | 'ai' | 'manual'
export interface IwFieldMeta {
  source: FieldSource
  quote?: string          // verbatim source text (AI path) — powers hover-to-source + changelog
}

// One recorded correction from a re-verification (or a manual revert). The `old` value is retained
// so a revert is a one-click restore. `at` + `source` make the change auditable; because a change to
// a DISPLAYED citation shifts bibHash between two anchored snapshots, the changelog is tamper-evident.
export interface ChangelogEntry {
  field: string           // CSL field that changed (title, author, issued, …)
  old: unknown            // previous value (retained for revert)
  new: unknown            // value it was overwritten with
  at: string              // ISO timestamp of the change
  source: FieldSource     // where the new value came from (crossref re-query, ai re-extract, manual revert)
}

export interface IwCitationMeta {
  fields?: Record<string, IwFieldMeta>  // field name → provenance
  sourceUrl?: string      // origin page/DOI URL
  addedAt?: string        // ISO — when first saved to the library
  usedInDoc?: boolean     // convenience mirror; authoritative source is resolve.usedCitekeys
  changelog?: ChangelogEntry[]  // re-verification corrections (old→new), newest last
  lastVerified?: string   // ISO — last successful re-verification check
  deadUrl?: boolean       // source URL returned 404/410/403 on the last check (dead-link flag)
  note?: string           // free-text reading notes shown indented under the bibliography entry
  pdfName?: string        // original filename of an embedded PDF (bytes live in OPFS library/pdfs/)
  pdfUrl?: string         // LEGACY (feature removed 2026-07-08): old docs may carry it; treated as inert
  publiclyAvailable?: boolean // the source's PDF is open/public → the "publicly available" export can strip it

  pageOffset?: number     // printed page = PDF sheet index + this offset (Haiku-detected, one-time)
  pageOffsetFlag?: 'verified' | 'raw' // 'raw' = detection failed → showing the PDF's own page numbers
  // Overlay annotations on the embedded PDF — normalised rects + text; see citations/pdfHighlights.
  highlights?: Array<{
    id: string; page: number; rects: Array<{ x: number; y: number; w: number; h: number }>
    color: string; kind?: 'highlight' | 'underline' | 'strike' | 'text'; text: string
    note?: string; citekey?: string; createdAt: string
  }>
}

export interface Bibliography {
  source: CitationSource
  entries: CSLItem[]
  generatedAt: string
  style?: string          // CSL style id frozen into a snapshot copy so bibHash is independently recomputable
  bibHash?: string        // sha256Hex(JCS({ v:1, entries, style })) — deterministic (no generatedAt)
}

// ─── Core JSON shape for ProseMirror / Tiptap content ────────────────────────
// Re-export Tiptap's own JSONContent so the rest of the codebase uses one type.

import type { JSONContent } from '@tiptap/react'
export type TiptapJSON = JSONContent

// ─── Document type (productivity spec §A3.2 `doc_type`) ──────────────────────
// A document's OWN property — it knows what it is. The productivity ledger READS this to tag its
// session rows (`doc_type: email`), which is what makes email writing show up in the report.
// Optional, so every pre-existing document still loads without a migration write.
//
// OWNERSHIP: this is the classification only. RESOLVING an absent docType to a row's `doc_type` is
// the LEDGER's rule and lives there (`productivity/capture.ts` resolveDocType / DEFAULT_DOC_TYPE) —
// deliberately NOT duplicated here. An accessor with its own default used to sit in this file and
// answered 'note' where the ledger answers 'essay': two rules for one question, which is how two
// implementations drift apart (cf. citationText, exported rather than copied). One rule, in the
// module that owns the ledger.

export type DocType = 'note' | 'essay' | 'email' | 'other'

// ─── Email headers (email layer §B2.1) ───────────────────────────────────────
// An email is an ORDINARY Inkwave document: the BODY is contentJson (so edit history, provenance
// hashing and session capture all apply for free), and these are the structured header fields that
// sit alongside it. Addresses are stored as the user typed them, trimmed — canonicalisation for
// hashing happens in email/headers.ts, never here.

export interface EmailHeaders {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
}

// ─── Attached music (music spec §B5/§B6) ─────────────────────────────────────
// What a document carrying score excerpts holds. NOT the notation itself: a master's MusicXML lives
// in OPFS (`music/master.ts`), exactly as an embedded PDF's bytes do — so a multi-MB score never
// bloats the document JSON or any provenance hash. What lives here is the REFERENCE, and that is
// the point of §B6: an excerpt stores an address, never a copy.

/** One attached master score, by reference. */
export interface MusicMasterRef {
  /** The master's STABLE id — never derived from content. `music/master.ts` explains why: a
   *  content-addressed id would satisfy dedup and silently orphan every excerpt the moment the
   *  student corrected the score. */
  id: string
  /** sha256 of the master's CURRENT MusicXML. This is what an OTS anchor actually pins (§B5) —
   *  swap the notation under an anchored analysis and the bundle stops verifying. */
  contentHash: string
  title?: string
  composer?: string
  /** Where a public-domain library score came from (§B7) — the licence requires attribution, and a
   *  student citing it in a graded essay needs the provenance. Display metadata: deliberately NOT
   *  part of musicAttachmentsHash. */
  attribution?: { corpus: string; licence: string; sourceUrl: string }
}

/** One inserted excerpt: a TRANSCLUSION (§B6) — an address into a master, never a copy of it. */
export interface MusicExcerptRef {
  id: string
  masterId: string
  /** PRINTED bar numbers, as the writer cited them. Strings by MusicXML spec ('0' pickups,
   *  '8a'/'8b' repeat endings) — see `music/score.ts`. */
  barStart: string
  barEnd: string
  partIndex: number
  createdAt: string
}

/**
 * One annotation anchored to a note or measure (§B4).
 *
 * ⚠️ §B4 IS NOT BUILT AND THIS SHAPE IS NOT SETTLED. The `Piece` contract's `MusicXmlAnchor`
 * (`music/types.ts`, owned by the photo lane) declares `measure: number`, but MusicXML bar numbers
 * are STRINGS by spec — a numeric anchor cannot express a '0' pickup or an '8a' repeat ending. That
 * question is with the Piece's owner. Until it resolves, this stays deliberately open: the ARRAY is
 * hashed today (see musicAttachmentsHash) so that populating it later needs no new bundle version,
 * and it is empty today so no anchored hash can be affected by whichever way the anchor lands.
 */
export interface MusicAnnotationRecord {
  id: string
  createdAt: string
  [k: string]: unknown
}

export interface MusicAttachments {
  masters: MusicMasterRef[]
  excerpts: MusicExcerptRef[]
  /** [] until §B4 lands — the field is hashed now so its arrival is not a protocol change. */
  annotations: MusicAnnotationRecord[]
}

// ─── Schema versioning ────────────────────────────────────────────────────────

export type SchemaVersion = '0.1.0'

// ─── Goals and plan (spec §A5b, 2026-07-17) ───────────────────────────────────
// Peter: "each doc has the writers goals in it and a rough plan — and the AI's prompts need to
// include the goals so it can give users a kick up the butt if they're not meeting their goals."
//
// WHY THIS LIVES ON THE DOCUMENT, and why that matters more than it looks: §A5b says "stored on
// the document, like any other content", and it is the DOCUMENT's property — what this document
// is for. Declared HERE, once, for the same reason `DocType` is (see its note): two lanes writing
// identical shapes in parallel is not harmless, and the productivity/AI-report lane reads goals
// rather than owning them.
//
// WHAT THEY ARE FOR — the whole of §A5's reversal rests on this type existing. The tone rule was
// reversed on 2026-07-17 (honest first, funny second, kind third), and the ONLY thing separating
// that from productivity guilt is the distinction §A5 draws: guilt is a standard IMPOSED on the
// writer; accountability is a goal the writer SET. "You only managed 200 words, poor effort" is
// imposed and still banned. "You said you'd finish the lit review by Friday and you've opened it
// twice" is the writer's own words quoted back, and is the point. So a goal is what gives the
// report STANDING to push — and §A5b's honesty boundary is the corollary: with no goal set, the
// report must not invent a standard to measure against. No goal ⇒ describe, don't push.
//
// The report path enforces that boundary structurally rather than by asking: goals travel only on
// their own consent tick, so a model that was sent no goal has nothing to hold the writer to and
// is told so explicitly (see productivity/report/compile.ts + prompt.ts).
//
// ⚠ NOT YET AUTHORABLE. Nothing writes this field: the editor UI for setting a goal is a design
// question Peter owns and has not answered (raised 2026-07-17). Until it exists, every document's
// goals are `undefined`, which the report path handles as the honest "no goal ⇒ describe, don't
// push" case rather than as an error. Do NOT default it to an empty goal — an empty goal and no
// goal are different states, and only the second is honest about itself.
export interface DocGoals {
  /** What this document is for and what "done" looks like. The writer's words, never generated. */
  goal?: string
  /**
   * A rough plan — milestones, rough dates. DELIBERATELY INFORMAL (§A5b: "a plan nobody writes is
   * worse than a vague one"), so it is free text and not a structured milestone list. Do not
   * "upgrade" it to a schema of dates without asking: the moment it needs to be filled in
   * properly, it stops being written at all, and then there is nothing to be accountable to.
   */
  plan?: string
  /** ISO 8601 — when the writer last touched their goal/plan. Display only; never a deadline. */
  updatedAt?: string
}

// ─── Primary document model ───────────────────────────────────────────────────
// Typography (font / size / alignment) is stored per-selection as ProseMirror marks
// inside contentJson, so it persists with the content — no separate field needed.

import type { ToolbarConfig } from '../editor/toolbarContract'

export interface InkwaveDocument {
  id: string
  title: string
  contentJson: TiptapJSON          // ProseMirror JSON for editor content
  createdAt: string                // ISO 8601
  updatedAt: string                // ISO 8601
  schemaVersion: SchemaVersion
  scasLimitN: number | 'infinite'  // active SCAS vocabulary cap (Week 2 — old per-paragraph model)
  /**
   * §A5b — the writer's goal + rough plan for THIS document. Optional and absent by default; see
   * DocGoals. Absent ⇒ the AI report describes and does not push (§A5b's honesty boundary).
   */
  goals?: DocGoals
  scasSessionSeed: string          // deterministic-per-document ranking seed (Week 2)

  // ─── SCAS v2 / provenance spine (M0+) ──────────────────────────────────────
  // The engine (src/scas/engine.ts + state.ts) supersedes the Week-2 per-paragraph
  // rank-perturbation model. These are optional so pre-M0 documents still load;
  // src/routes/Edit.tsx fills defaults on open (see migrateDocument).
  scasMode?: ScasMode              // v0.1: 'n' (N-mode) only
  scasSetSize?: number             // |S| — fixed exclusion-set size in N-mode (e.g. 300)
  scasSeedRef?: string             // M0: a local seed (stand-in); M3: opaque server ref. The seed
                                   // itself never reaches the client once the signing service exists.
  scasPoolId?: string              // id + hash of the public pool P (reproducibility)
  scasState?: ScasState            // the ban-credit / satisfied / version overlay (persisted)
  scasReceipts?: SignedReceipt[]   // the live-composition signed receipt chain for this doc (M3)
  scasGreenAnchors?: string[]      // words currently anchored as green (unresolved); persisted across sessions

  // ─── Citation / bibliography (M-Zotero) ──────────────────────────────────
  bibliography?: Bibliography      // embedded, self-contained cited entries (populated by resolve.ts)
  citationStyle?: string           // CSL style id, e.g. 'apa', 'chicago-author-date'

  // ─── Email layer (§B2.1) ─────────────────────────────────────────────────
  docType?: DocType                // absent ⇒ 'note' (docTypeOf). The ledger tags session rows from this.
  email?: EmailHeaders             // present iff docType === 'email' — the body is contentJson

  // ─── Toolbar layout (2026-07-17) ─────────────────────────────────────────
  // Peter: "we should encode the toolbar configuration into a .studio document" — the layout is
  // per-DOCUMENT and task-based (a score gets music tools, an essay gets writing tools) rather
  // than one global preference. The rules, the shape and the resolution chain all live in
  // `editor/toolbarContract.ts`; read it before touching this field.
  //
  // NOT ANCHORED, and structurally so: `contentHash()` takes contentJson only — never this
  // document — and `bundleHash()` takes four EXPLICIT hash arguments, so no document field can
  // ride in. `musicHash.test.ts` already pins the v:1 form against a hand-computed literal, so
  // any attempt to fold this in fails a test that exists. Rearranging your buttons must never
  // read as tampering with your thesis. Same class of field as `citationStyle` above.
  toolbar?: ToolbarConfig

  // ─── Attached music (§B5/§B6) ────────────────────────────────────────────
  // Present only once the writer attaches a score. Absent ⇒ the bundle keeps its v:1/v:2/v:3 form,
  // so every document anchored before this feature existed hashes BYTE-IDENTICALLY to before.
  music?: MusicAttachments
}

// ─── SCAS engine state (M0) ───────────────────────────────────────────────────
// The client-side overlay on top of S_v membership: which lemmas are Locked (ban-credit
// outstanding) and which are Satisfied (immune until the next resample). `S_v` itself is a
// pure function of the seed and is NOT stored here. The verifier replays this overlay from
// the logged word-nudge events; it is never folded into the seed derivation. See v4 spec §4.3/§8.

export type ScasMode = 'n'

export interface SatisfiedEntry {
  lemma: string
  satisfiedAtVersion: number       // immune while this === ScasState.version
}

export interface ScasState {
  version: number                  // current S-version v
  locked: string[]                 // ban-credit set B (lemmas) — state "Locked"
  satisfied: SatisfiedEntry[]      // resolved-in-place lemmas, immune for their version
  liveKicks: string[]              // outstanding, unresolved in-S word nudges (lemmas). Frozen at
                                   // commit so the word stays purple across S-rotation and reload
                                   // without recomputing membership; cleared when resolved (swap/
                                   // dismiss) or moved to `locked` on delete.
  kickTimes?: Record<string, number> // lemma → epoch ms it was FIRST nudged (turned purple). The
                                   // slot's "first-written" stamp; persisted so it survives reload.
}

// ─── Paragraph metadata ───────────────────────────────────────────────────────
// Stored as attributes on paragraph nodes via ParagraphGlyphExtension (Week 4).

export interface ParagraphMetadata {
  glyph: string        // e.g. "ibis"
  glyphIconRef: string // e.g. "🦤" or "/icons/ibis.svg"
  createdAt: string    // ISO 8601

  // Phase 1.5+ — DO NOT implement in v0.1:
  // keywords?: string[]
  // commitmentState?: 'wet-clay' | 'fired-clay' | 'stone'
  // superheatedSentences?: SentenceCommitment[]
}

// ─── Snapshots & receipts (provenance spine — M1+) ────────────────────────────
// v4 spec §8. Everything hashed/signed is byte-reproducible by an independent verifier:
// canonicalise with RFC 8785 (JCS), hashes are lowercase-hex SHA-256, signatures/proofs base64.

export interface Snapshot {
  id: string
  documentId: string
  createdAt: string                 // writer's local clock — ordering only, never authority
  trigger: 'word-nudge' | 'kick' | 'manual' | 'paragraph'  // 'kick' kept for backward compat reading
  wordCount: number
  contentHash: string               // sha256Hex(JCS(contentJson))
  contentJson: TiptapJSON           // held by the writer; never transmitted
  receipts?: SignedReceipt[]        // the live-composition (+cadence) chain for this span (M3)
  // The DISPLAYED bibliography frozen at snapshot time (mode-resolved cited subset), and its hash.
  // Present only when the doc had ≥1 displayed citation; absent → bundle stays the v:1 form so
  // pre-citation documents hash byte-identically to before. See §3/§12 of the citations spec.
  bibliography?: Bibliography       // frozen copy (its generatedAt is NOT part of bibHash)
  bibHash?: string                  // sha256Hex(JCS({ v:1, entries, style }))
  // The email headers frozen at snapshot time, and their hash. Present only on `doc_type: email`
  // documents — absent ⇒ the bundle keeps its v:1/v:2 form, so every non-email document (i.e. every
  // document anchored before this feature existed) hashes byte-identically to before. §B2.2.
  email?: EmailHeaders              // frozen copy of To/Cc/Bcc/Subject
  emailHash?: string                // sha256Hex(JCS({ v:1, to, cc, bcc, subject })) — canonicalised
  // The attached music frozen at snapshot time, and its hash (§B5). Present only on a document that
  // carries a score — absent ⇒ the bundle keeps its v:1/v:2/v:3 form, so every non-music document
  // (i.e. every document anchored before this feature existed) hashes byte-identically to before.
  music?: MusicAttachments          // frozen copy of the master refs + excerpts + annotations
  musicHash?: string                // sha256Hex(JCS({ v:1, masters, excerpts, annotations }))
  bundleHash: string                // v:1 {contentHash,receipts}; v:2 adds bibHash; v:3 adds emailHash; v:4 adds musicHash
  ots: OtsProofState                // OTS over bundleHash → Bitcoin (M2)
  summary?: string                  // 5-10 word AI summary (async, patched after snapshot creation)
  nudgeWord?: { from: string; to: string }  // old→new word for 'word-nudge' trigger snapshots
  diffSummary?: { bullets: string }  // AI bullet-point diff vs previous snapshot (stored, loads instantly)
  versionSummary?: string           // AI bullet-point summary of changes across the full version (stored on manual snap)
}

// The "snapshot memory diet" projection: everything the editor chrome renders (labels, OTS
// status, summaries, hashes) WITHOUT the heavy payload — contentJson, the receipts array, and
// the frozen bibliography can each be MBs, and hundreds of snapshots × full content in React
// state was hundreds of MB resident (GC pauses). The full array lives ONCE in the snapshots.ts
// cache; consumers fetch it via listSnapshots() at action time (export, verify, diff).
// Derived via toSnapshotMeta() in provenance/snapshots.ts.
export type SnapshotMeta = Omit<Snapshot, 'contentJson' | 'receipts' | 'bibliography'> & {
  receiptCount: number              // receipts?.length — the UI only ever shows counts
}

export interface OtsProofState {
  status: 'unstamped' | 'pending' | 'confirmed'
  proofBase64?: string
  bitcoinBlock?: number
  bitcoinTime?: string              // block time — the durable authoritative timestamp
}

// One word nudge (constraint encounter) and how it was resolved — the no-silent-dodging evidence.
// Stored in signed receipts as `kicks` for protocol stability; the TypeScript name is WordNudgeEvent.
export interface WordNudgeEvent {
  lemma: string
  commitIndex: number               // order within the document (for state-machine replay)
  setVersion: number
  trigger: 'in-S' | 'locked'
  response: 'swapped' | 'justified' | 'dismissed' | 'deleted->credit' | 'credit-discharged'
  replacement?: string              // lemma swapped to (response 'swapped' / 'credit-discharged')
  deliberationMs: number            // selectable → resolved
}

// Backward-compat alias (used in protocol field names and some legacy paths).
export type KickEvent = WordNudgeEvent

// One per signing period, hash-chained into one fixed sequence per session (M3). Defined now so
// the Snapshot/bundle types are complete; the signing service that populates it arrives in M3.
export interface SignedReceipt {
  v: 1
  sessionToken: string
  counter: number
  prevHash: string
  contentHash: string
  setVersion: number
  lockedSetHash: string
  kicks: WordNudgeEvent[]           // field name kept as 'kicks' for signed-protocol stability
  serverTime: string
  cadenceDigest?: string
  signature: string
  // held by the writer, NOT sent to the server:
  lockedSet: string                 // base64 bitmask over P (the period's S_v)
  cadence?: KeylogBin[]             // paid only: 0.5s insert/delete COUNTS — never characters
}

export interface KeylogBin { ins: number; del: number }

// ─── Provenance events ────────────────────────────────────────────────────────

export type ProvenanceEventType =
  | 'session-start'
  | 'session-end'
  | 'snapshot-created'
  | 'snapshot-restored'
  | 'suggestion-accepted'
  | 'suggestion-ignored'
  | 'paste-event'
  | 'limit-changed'
  | 'paragraph-glyph-assigned'
  | 'paragraph-glyph-overridden'

export interface ProvenanceEvent {
  id: string
  documentId: string
  type: ProvenanceEventType
  timestamp: string              // ISO 8601
  payload: Record<string, unknown>
}

// ─── IndexedDB metadata row (lightweight, for fast listing) ───────────────────

export interface DocumentMeta {
  id: string
  title: string
  updatedAt: string
}
