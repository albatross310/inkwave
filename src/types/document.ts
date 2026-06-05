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
  scasLimitN: number | 'infinite'  // active SCAS vocabulary cap (Week 2)
  scasSessionSeed: string          // deterministic-per-document ranking seed (Week 2)
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

// ─── Snapshots (Week 3) ───────────────────────────────────────────────────────

export interface Snapshot {
  id: string
  parentId: string | null
  message?: string
  contentHash: string   // SHA-256 of canonicalised contentJson
  createdAt: string     // ISO 8601
  contentJson: TiptapJSON
  wordCount: number
}

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
