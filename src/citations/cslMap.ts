// Map external metadata (CrossRef, arXiv, OpenLibrary) into CSL-JSON (CSLItem), and derive stable
// citekeys. Pure/data-only so it's unit-testable and reusable by both the PWA path and the extension.

import type { CSLItem, IwCitationMeta, IwFieldMeta, FieldSource } from '../types/document'

// CrossRef "type" → CSL "type". Falls back to 'document' for anything unmapped.
const CROSSREF_TYPE: Record<string, string> = {
  'journal-article': 'article-journal',
  'proceedings-article': 'paper-conference',
  'book': 'book',
  'book-chapter': 'chapter',
  'monograph': 'book',
  'reference-book': 'book',
  'edited-book': 'book',
  'report': 'report',
  'posted-content': 'article',       // preprints
  'dissertation': 'thesis',
  'dataset': 'dataset',
  'standard': 'standard',
}

function firstOf(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined
  return typeof v === 'string' ? v : undefined
}

/** ASCII-fold + lowercase a name for citekey building. */
function slugName(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Build a stable citekey: <firstAuthorFamily><year><firstTitleWord>, e.g. "aspelmeyer2009measured".
 * Deterministic from the item; the library appends -2/-3 on collision.
 */
export function makeCitekey(item: Pick<CSLItem, 'author' | 'issued' | 'title'>): string {
  const fam = item.author?.[0]?.family ?? item.author?.[0]?.literal ?? 'anon'
  const year = item.issued?.['date-parts']?.[0]?.[0] ?? item.issued?.raw ?? 'nd'
  const titleWord = (typeof item.title === 'string' ? item.title : '')
    .split(/\s+/).find(w => w.length > 3) ?? ''
  const key = `${slugName(String(fam))}${year}${slugName(titleWord)}`.slice(0, 40)
  return key || `ref${Date.now().toString(36)}`
}

/** Attach per-field provenance (`_iw`) to an item — marks every present field with `source`. */
export function tagProvenance(
  item: CSLItem,
  source: FieldSource,
  meta: Partial<IwCitationMeta> = {},
): CSLItem {
  const fields: Record<string, IwFieldMeta> = {}
  for (const k of Object.keys(item)) {
    if (k === 'id' || k === 'type' || k.startsWith('_')) continue
    fields[k] = { source }
  }
  const _iw: IwCitationMeta = { fields, addedAt: new Date().toISOString(), ...meta }
  return { ...item, _iw }
}

/** CrossRef `message` object → CSLItem. `id` is supplied by the caller (from makeCitekey). */
export function crossrefToCsl(message: Record<string, unknown>, id: string): CSLItem {
  const authors = Array.isArray(message.author)
    ? (message.author as Array<Record<string, unknown>>).map(a => ({
        family: typeof a.family === 'string' ? a.family : undefined,
        given: typeof a.given === 'string' ? a.given : undefined,
        literal: typeof a.name === 'string' ? a.name : undefined,
      }))
    : undefined
  const issuedParts = (message.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']
  const item: CSLItem = {
    id,
    type: CROSSREF_TYPE[String(message.type)] ?? 'document',
    title: firstOf(message.title),
    ...(authors && authors.length ? { author: authors } : {}),
    ...(issuedParts ? { issued: { 'date-parts': issuedParts } } : {}),
    ...(firstOf(message['container-title']) ? { 'container-title': firstOf(message['container-title']) } : {}),
    ...(typeof message.DOI === 'string' ? { DOI: message.DOI } : {}),
    ...(typeof message.volume === 'string' ? { volume: message.volume } : {}),
    ...(typeof message.issue === 'string' ? { issue: message.issue } : {}),
    ...(typeof message.page === 'string' ? { page: message.page } : {}),
    ...(typeof message.publisher === 'string' ? { publisher: message.publisher } : {}),
    ...(typeof message.URL === 'string' ? { URL: message.URL } : {}),
  }
  return item
}

/** arXiv Atom-feed entry (parsed to a small object) → CSLItem. */
export function arxivToCsl(
  e: { title?: string; authors?: string[]; published?: string; id?: string; doi?: string },
  id: string,
): CSLItem {
  const year = e.published ? Number(e.published.slice(0, 4)) : undefined
  return {
    id,
    type: 'article',
    title: e.title,
    ...(e.authors && e.authors.length
      ? { author: e.authors.map(n => {
          const parts = n.trim().split(/\s+/)
          const family = parts.pop() ?? n
          return { family, given: parts.join(' ') || undefined }
        }) }
      : {}),
    ...(year ? { issued: { 'date-parts': [[year]] } } : {}),
    'container-title': 'arXiv',
    ...(e.doi ? { DOI: e.doi } : {}),
    ...(e.id ? { URL: e.id } : {}),
  }
}

/** OpenLibrary book record (jscmd=data) → CSLItem. */
export function openLibraryToCsl(rec: Record<string, unknown>, id: string): CSLItem {
  const authors = Array.isArray(rec.authors)
    ? (rec.authors as Array<{ name?: string }>).map(a => {
        const parts = (a.name ?? '').trim().split(/\s+/)
        const family = parts.pop() ?? (a.name ?? '')
        return { family, given: parts.join(' ') || undefined }
      })
    : undefined
  const yearStr = typeof rec.publish_date === 'string' ? /\d{4}/.exec(rec.publish_date)?.[0] : undefined
  const publishers = Array.isArray(rec.publishers)
    ? (rec.publishers as Array<{ name?: string }>).map(p => p.name).filter(Boolean).join(', ')
    : undefined
  return {
    id,
    type: 'book',
    title: typeof rec.title === 'string' ? rec.title : undefined,
    ...(authors && authors.length ? { author: authors } : {}),
    ...(yearStr ? { issued: { 'date-parts': [[Number(yearStr)]] } } : {}),
    ...(publishers ? { publisher: publishers } : {}),
    ...(typeof rec.url === 'string' ? { URL: rec.url } : {}),
  }
}
