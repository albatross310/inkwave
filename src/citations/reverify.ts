// Re-verification of a saved citation against its source (citations spec §12.1, decision #4).
//
// Two paths, chosen by the entry's provenance:
//   • identifier (DOI/arXiv/PMID/ISBN)  → re-query the canonical API (CrossRef etc.), no AI.
//   • AI-extracted URL                  → re-run the server extract branch; also detects a DEAD url.
//
// A change OVERWRITES the field and appends a changelog entry {field, old, new, at, source}; the old
// value is retained so a revert is one-click. Only fields whose provenance is NOT 'manual' are
// re-verified — a value the writer edited by hand is never clobbered by a re-check. Fields the fresh
// source can't produce are left alone (a flaky re-extract must not wipe good data).

import type { CSLItem, FieldSource, IwCitationMeta, ChangelogEntry } from '../types/document'
import { detectIdentifier } from './identifiers'
import { lookupIdentifier } from './lookup'
import { extractToCsl, type ExtractResponse } from './capture'

// CSL fields worth re-verifying. `id`/`type`/URLs/`accessed` are identity or local, not re-checked.
const VERIFY_FIELDS = ['title', 'author', 'issued', 'container-title', 'volume', 'issue', 'page', 'DOI', 'publisher'] as const

export interface FieldDiff { field: string; old: unknown; new: unknown }

export interface ReverifyResult {
  ok: boolean              // a source was reached and compared
  deadUrl: boolean         // source URL returned 404/410/403 (dead link)
  diffs: FieldDiff[]       // fields whose fresh value differs from the stored one
  checkedAt: string        // ISO timestamp of this check
  source: FieldSource      // where the fresh values came from
  error?: string           // set when the source couldn't be reached (transient)
}

function meta(item: CSLItem): IwCitationMeta {
  return ((item as { _iw?: IwCitationMeta })._iw) ?? {}
}

// Canonical, comparable string for a field value, so "August 28, 2017" vs date-parts, or an author
// array reordering, compare structurally rather than by reference.
function comparable(field: string, value: unknown): string {
  if (value == null) return ''
  if (field === 'author' || field === 'editor') {
    const arr = value as CSLItem['author']
    return (arr ?? []).map(a => `${a.family ?? ''}|${a.given ?? ''}|${a.literal ?? ''}`).join(';').toLowerCase().trim()
  }
  if (field === 'issued' || field === 'accessed') {
    const dp = (value as { 'date-parts'?: number[][] })?.['date-parts']
    return JSON.stringify(dp ?? value)
  }
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase()
}

// Which fields to re-verify: present on either side, and not manually edited by the writer.
function diffFields(stored: CSLItem, fresh: CSLItem): FieldDiff[] {
  const m = meta(stored)
  const diffs: FieldDiff[] = []
  for (const field of VERIFY_FIELDS) {
    if (m.fields?.[field]?.source === 'manual') continue // never clobber a hand-edited value
    const freshVal = fresh[field]
    const freshCmp = comparable(field, freshVal)
    if (!freshCmp) continue // the fresh source didn't yield this field — leave the stored value alone
    if (freshCmp !== comparable(field, stored[field])) {
      diffs.push({ field, old: stored[field] ?? null, new: freshVal })
    }
  }
  return diffs
}

// Reconstruct an identifier from a stored item (its DOI, or its source URL).
function identifierOf(item: CSLItem) {
  if (typeof item.DOI === 'string' && item.DOI) return detectIdentifier(item.DOI)
  const url = meta(item).sourceUrl ?? (typeof item.URL === 'string' ? item.URL : '')
  return url ? detectIdentifier(url) : null
}

/** Re-verify one entry against its source. Never throws — failures come back as `error`/`deadUrl`. */
export async function reverifyEntry(item: CSLItem): Promise<ReverifyResult> {
  const checkedAt = new Date().toISOString()
  const id = identifierOf(item)

  // ── Identifier path: re-query the canonical record (no AI). ──
  if (id) {
    try {
      const fresh = await lookupIdentifier(id)
      return { ok: true, deadUrl: false, diffs: diffFields(item, fresh), checkedAt, source: 'crossref' }
    } catch (e) {
      // A DOI that no longer resolves is effectively a dead/retracted record.
      return { ok: false, deadUrl: false, diffs: [], checkedAt, source: 'crossref', error: String((e as Error).message || e) }
    }
  }

  // ── AI path: re-fetch + re-extract via the server; detect a dead URL. ──
  const url = meta(item).sourceUrl ?? (typeof item.URL === 'string' ? item.URL : '')
  if (!url) return { ok: false, deadUrl: false, diffs: [], checkedAt, source: 'ai', error: 'No source URL to re-verify against.' }
  try {
    const r = await fetch('/api/summarise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extract: { url } }),
    })
    const data = await r.json().catch(() => ({})) as ExtractResponse & { status?: number; error?: string }
    if (!r.ok || data.error) {
      const status = data.status ?? 0
      const dead = status === 404 || status === 410 || status === 403
      return { ok: false, deadUrl: dead, diffs: [], checkedAt, source: 'ai', error: data.error || `check failed (${r.status})` }
    }
    // Build a comparable CSLItem from the fresh extracted fields (reuse the capture assembler).
    const { item: fresh } = extractToCsl(data, url)
    return { ok: true, deadUrl: false, diffs: diffFields(item, fresh), checkedAt, source: 'ai' }
  } catch (e) {
    return { ok: false, deadUrl: false, diffs: [], checkedAt, source: 'ai', error: String((e as Error).message || e) }
  }
}

/**
 * Apply a re-verify result to an item: overwrite each changed field, append a changelog entry per
 * change (retaining the old value), and stamp lastVerified / deadUrl. Returns a NEW item (pure).
 */
export function applyReverify(item: CSLItem, result: ReverifyResult): CSLItem {
  const m: IwCitationMeta = { ...meta(item) }
  const next: CSLItem = { ...item }
  const log: ChangelogEntry[] = [...(m.changelog ?? [])]
  const fields = { ...(m.fields ?? {}) }
  for (const d of result.diffs) {
    next[d.field] = d.new
    fields[d.field] = { ...(fields[d.field] ?? { source: result.source }), source: result.source }
    log.push({ field: d.field, old: d.old, new: d.new, at: result.checkedAt, source: result.source })
  }
  m.fields = fields
  m.changelog = log
  if (result.ok) m.lastVerified = result.checkedAt
  m.deadUrl = result.deadUrl
  ;(next as { _iw?: IwCitationMeta })._iw = m
  return next
}

/**
 * Revert the change recorded at `changelogIndex`: restore the old value and append a manual-revert
 * entry (so the audit trail stays complete). Returns a NEW item. No-op if the index is invalid.
 */
export function revertField(item: CSLItem, changelogIndex: number): CSLItem {
  const m: IwCitationMeta = { ...meta(item) }
  const log = m.changelog ?? []
  const entry = log[changelogIndex]
  if (!entry) return item
  const next: CSLItem = { ...item }
  next[entry.field] = entry.old
  const fields = { ...(m.fields ?? {}) }
  fields[entry.field] = { ...(fields[entry.field] ?? { source: 'manual' }), source: 'manual' }
  m.fields = fields
  m.changelog = [...log, { field: entry.field, old: entry.new, new: entry.old, at: new Date().toISOString(), source: 'manual' }]
  ;(next as { _iw?: IwCitationMeta })._iw = m
  return next
}
