// Resolve a detected identifier to a CSLItem via free public APIs. Browser-side: CrossRef and
// OpenLibrary send permissive CORS; arXiv/NCBI are best-effort (may be blocked by CORS on some
// networks — callers degrade to manual entry). No API keys. Polite-pool identity via `mailto`
// (browsers can't set User-Agent on fetch, so the query param is the correct mechanism).

import type { CSLItem } from '../types/document'
import type { DetectedIdentifier } from './identifiers'
import { crossrefToCsl, arxivToCsl, openLibraryToCsl, googleBooksToCsl, makeCitekey } from './cslMap'

const MAILTO = 'hello@inkwave.me'

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`lookup ${r.status}`)
  return r.json() as Promise<Record<string, unknown>>
}

async function lookupDoi(doi: string): Promise<CSLItem> {
  const data = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${MAILTO}`)
  const message = data.message as Record<string, unknown>
  if (!message) throw new Error('crossref: empty')
  return crossrefToCsl(message, makeCitekey({
    author: message.author as CSLItem['author'],
    issued: message.issued as CSLItem['issued'],
    title: Array.isArray(message.title) ? message.title[0] : undefined,
  }))
}

// Google Books is queried when OpenLibrary has no usable record — much broader ISBN coverage,
// CORS-open, no key. Returns null on any miss so the caller can raise one clear error.
async function lookupIsbnGoogle(isbn: string): Promise<CSLItem | null> {
  try {
    const gb = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`)
    const first = (Array.isArray(gb.items) ? gb.items[0] : undefined) as { volumeInfo?: Record<string, unknown> } | undefined
    const vi = first?.volumeInfo
    if (!vi || typeof vi.title !== 'string') return null
    const authors = Array.isArray(vi.authors) ? (vi.authors as string[]).map(n => ({ literal: n })) : undefined
    const year = typeof vi.publishedDate === 'string' ? Number(/\d{4}/.exec(vi.publishedDate)?.[0] ?? 0) : undefined
    return googleBooksToCsl(vi, makeCitekey({
      author: authors as CSLItem['author'],
      issued: year ? { 'date-parts': [[year]] } : undefined,
      title: vi.title,
    }), isbn)
  } catch {
    return null
  }
}

async function lookupIsbn(isbn: string): Promise<CSLItem> {
  // 1. OpenLibrary jscmd=data — rich when present, but returns an EMPTY {} for many ISBNs; treat a
  //    record without a title as a miss and fall through (the old code accepted the empty record and
  //    produced a titleless citation).
  try {
    const data = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)
    const rec = data[`ISBN:${isbn}`] as Record<string, unknown> | undefined
    if (rec && typeof rec.title === 'string' && rec.title) {
      return openLibraryToCsl(rec, makeCitekey({
        author: (Array.isArray(rec.authors)
          ? (rec.authors as Array<{ name?: string }>).map(a => ({ literal: a.name }))
          : undefined) as CSLItem['author'],
        issued: (typeof rec.publish_date === 'string'
          ? { 'date-parts': [[Number(/\d{4}/.exec(rec.publish_date)?.[0] ?? 0)]] }
          : undefined) as CSLItem['issued'],
        title: rec.title,
      }))
    }
  } catch {
    /* OpenLibrary unreachable — try Google Books before giving up. */
  }
  // 2. Google Books fallback.
  const google = await lookupIsbnGoogle(isbn)
  if (google) return google
  throw new Error(`ISBN ${isbn} not found in OpenLibrary or Google Books`)
}

async function lookupArxiv(arxivId: string): Promise<CSLItem> {
  const r = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`)
  if (!r.ok) throw new Error(`arxiv ${r.status}`)
  const xml = await r.text()
  if (typeof DOMParser === 'undefined') throw new Error('arxiv: no XML parser')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const entry = doc.querySelector('entry')
  if (!entry) throw new Error('arxiv: no entry')
  const parsed = {
    title: entry.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim(),
    authors: [...entry.querySelectorAll('author > name')].map(n => n.textContent?.trim() ?? '').filter(Boolean),
    published: entry.querySelector('published')?.textContent?.trim(),
    id: entry.querySelector('id')?.textContent?.trim(),
    doi: entry.querySelector('arxiv\\:doi, doi')?.textContent?.trim(),
  }
  return arxivToCsl(parsed, makeCitekey({
    author: parsed.authors.map(n => ({ literal: n })),
    issued: parsed.published ? { 'date-parts': [[Number(parsed.published.slice(0, 4))]] } : undefined,
    title: parsed.title,
  }))
}

async function lookupPmid(pmid: string): Promise<CSLItem> {
  const data = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json&tool=inkwave&email=${MAILTO}`,
  )
  const result = data.result as Record<string, unknown> | undefined
  const rec = result?.[pmid] as Record<string, unknown> | undefined
  if (!rec) throw new Error('pubmed: not found')
  const authors = Array.isArray(rec.authors)
    ? (rec.authors as Array<{ name?: string }>).map(a => {
        const parts = (a.name ?? '').trim().split(/\s+/)
        const family = parts.shift() ?? (a.name ?? '')
        return { family, given: parts.join(' ') || undefined }
      })
    : undefined
  const year = typeof rec.pubdate === 'string' ? Number(/\d{4}/.exec(rec.pubdate)?.[0] ?? 0) : undefined
  const item: CSLItem = {
    id: makeCitekey({ author: authors, issued: year ? { 'date-parts': [[year]] } : undefined, title: rec.title as string }),
    type: 'article-journal',
    title: typeof rec.title === 'string' ? rec.title : undefined,
    ...(authors && authors.length ? { author: authors } : {}),
    ...(year ? { issued: { 'date-parts': [[year]] } } : {}),
    ...(typeof rec.fulljournalname === 'string' ? { 'container-title': rec.fulljournalname } : {}),
    ...(typeof rec.volume === 'string' ? { volume: rec.volume } : {}),
    ...(typeof rec.issue === 'string' ? { issue: rec.issue } : {}),
    ...(typeof rec.pages === 'string' ? { page: rec.pages } : {}),
  }
  return item
}

/** Resolve any detected identifier to a CSLItem. Throws on network/parse failure. */
export function lookupIdentifier(id: DetectedIdentifier): Promise<CSLItem> {
  switch (id.kind) {
    case 'doi':   return lookupDoi(id.value)
    case 'isbn':  return lookupIsbn(id.value)
    case 'arxiv': return lookupArxiv(id.value)
    case 'pmid':  return lookupPmid(id.value)
  }
}
