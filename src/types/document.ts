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
  // Overlay annotations on the embedded PDF — normalised rects + text; see citations/pdfHighlights.
  highlights?: Array<{
    id: string; page: number; rects: Array<{ x: number; y: number; w: number; h: number }>
    color: string; text: string; note?: string; citekey?: string; createdAt: string
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

// ─── Schema versioning ────────────────────────────────────────────────────────

export type SchemaVersion = '0.1.0'

// ─── Primary document model ───────────────────────────────────────────────────
// Typography (font / size / alignment) is stored per-selection as ProseMirror marks
// inside contentJson, so it persists with the content — no separate field needed.

export interface InkwaveDocument {
  id: string
  title: string
  contentJson: TiptapJSON          // ProseMirror JSON for editor content
  createdAt: string                // ISO 8601
  updatedAt: string                // ISO 8601
  schemaVersion: SchemaVersion
  scasLimitN: number | 'infinite'  // active SCAS vocabulary cap (Week 2 — old per-paragraph model)
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
  bundleHash: string                // v:1 {contentHash,receipts} OR v:2 {contentHash,bibHash,receipts} when bibHash present
  ots: OtsProofState                // OTS over bundleHash → Bitcoin (M2)
  summary?: string                  // 5-10 word AI summary (async, patched after snapshot creation)
  nudgeWord?: { from: string; to: string }  // old→new word for 'word-nudge' trigger snapshots
  diffSummary?: { bullets: string }  // AI bullet-point diff vs previous snapshot (stored, loads instantly)
  versionSummary?: string           // AI bullet-point summary of changes across the full version (stored on manual snap)
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
