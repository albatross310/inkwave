// Capture orchestrator. Turns an arbitrary pasted string (identifier, DOI, or URL) into a CSLItem
// tagged with per-field provenance. Two paths:
//   • identifier detected → free API lookup (verified, no AI, no popup needed)
//   • bare URL            → server-side LLM extraction (Haiku) with per-field source quotes
// The server endpoint is api/summarise's { extract } branch (folded there to stay under Vercel's
// 12-function cap). API key never reaches the client.

import type { CSLItem, FieldSource } from '../types/document'
import { detectIdentifier, isUrl } from './identifiers'
import { lookupIdentifier } from './lookup'
import { tagProvenance, makeCitekey } from './cslMap'

export interface CaptureField { value: string; quote?: string | null }

export interface CaptureResult {
  item: CSLItem
  provenance: FieldSource
  warning?: string                              // set when detection/extraction was poor
  fields?: Record<string, CaptureField>         // AI path — per-field value + source quote
}

// LLM itemType → CSL type (small, deliberate set for the website/blog path).
const ITEMTYPE_CSL: Record<string, string> = {
  blogPost: 'post-weblog',
  webpage: 'webpage',
  newsArticle: 'article-newspaper',
  article: 'article-magazine',
  report: 'report',
  video: 'motion_picture',
}

/** @internal exported for unit tests only */
export function parseAuthor(value: string): CSLItem['author'] {
  return value.split(/\s*(?:,|and|&)\s*/).filter(Boolean).map(name => {
    const parts = name.trim().split(/\s+/)
    if (parts.length === 1) return { literal: parts[0] }
    const family = parts.pop() as string
    return { family, given: parts.join(' ') }
  })
}

/** @internal exported for unit tests only */
export function parseDate(value: string): CSLItem['issued'] | undefined {
  const m = /(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(value)
  if (!m) return undefined
  const parts = [Number(m[1])]
  if (m[2]) parts.push(Number(m[2]))
  if (m[3]) parts.push(Number(m[3]))
  return { 'date-parts': [parts] }
}

export interface ExtractResponse {
  itemType?: string
  fields?: Record<string, CaptureField>
  confidence?: 'high' | 'low'
}

/** Assemble a CSLItem from the LLM's extracted fields. @internal exported for unit tests only */
export function extractToCsl(res: ExtractResponse, url: string): { item: CSLItem; fields: Record<string, CaptureField> } {
  const f = res.fields ?? {}
  const title = f.title?.value
  const author = f.author?.value ? parseAuthor(f.author.value) : undefined
  const issued = f.date?.value ? parseDate(f.date.value) : undefined
  const partial: CSLItem = {
    id: 'tmp',
    type: ITEMTYPE_CSL[res.itemType ?? 'webpage'] ?? 'webpage',
    ...(title ? { title } : {}),
    ...(author && author.length ? { author } : {}),
    ...(issued ? { issued } : {}),
    ...(f.publisher?.value ? { 'container-title': f.publisher.value } : {}),
    URL: url,
    accessed: parseDate(new Date().toISOString().slice(0, 10)),
  }
  const id = makeCitekey(partial)
  return { item: { ...partial, id }, fields: f }
}

/** Call the server extract branch for a URL (server fetches the page; key stays server-side). */
async function captureFromUrl(url: string): Promise<CaptureResult> {
  let res: ExtractResponse
  try {
    const r = await fetch('/api/summarise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extract: { url } }),
    })
    if (!r.ok) throw new Error(`extract ${r.status}`)
    res = (await r.json()) as ExtractResponse
  } catch {
    // Never fail closed: hand back an empty, editable item so the user can fill it in manually.
    const item = tagProvenance({ id: makeCitekey({ title: url }), type: 'webpage', URL: url }, 'manual', { sourceUrl: url })
    return { item, provenance: 'manual', warning: 'Could not reach the extraction service — enter the details manually.' }
  }
  const { item, fields } = extractToCsl(res, url)
  const quotes: Partial<Record<string, string>> = {}
  for (const [k, v] of Object.entries(fields)) if (v.quote) quotes[k] = v.quote
  const tagged = tagProvenance(item, 'ai', { sourceUrl: url })
  const warning = res.confidence === 'low' || Object.keys(fields).length < 2
    ? 'Something looks peculiar about this page — check the fields before saving.'
    : undefined
  return { item: tagged, provenance: 'ai', warning, fields }
}

/** Identifier lookup path (DOI/arXiv/PMID/ISBN → verified metadata). */
function sourceUrlFor(kind: string, value: string): string {
  if (kind === 'doi') return `https://doi.org/${value}`
  if (kind === 'arxiv') return `https://arxiv.org/abs/${value}`
  if (kind === 'pmid') return `https://pubmed.ncbi.nlm.nih.gov/${value}`
  return `https://openlibrary.org/isbn/${value}`
}

/**
 * Main entry: capture a citation from arbitrary input. Prefers identifier lookup (verified), falls
 * back to URL extraction, and otherwise throws (the caller offers a blank manual form).
 */
export async function captureFromInput(input: string): Promise<CaptureResult> {
  const id = detectIdentifier(input)
  if (id) {
    const item = await lookupIdentifier(id)
    const tagged = tagProvenance(item, 'crossref', { sourceUrl: sourceUrlFor(id.kind, id.value) })
    return { item: tagged, provenance: 'crossref' }
  }
  if (isUrl(input)) return captureFromUrl(input)
  throw new Error('No DOI, identifier, or URL found in the input.')
}
