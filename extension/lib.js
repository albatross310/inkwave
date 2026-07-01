// Shared, dependency-free capture logic for the extension (mirrors src/citations/{identifiers,
// cslMap,lookup}.ts — kept inline here so the MV3 bundle needs no build step). The shipping
// cross-browser build (WXT) should import the shared TS modules instead of duplicating them.

export const MAILTO = 'hello@inkwave.me'

const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/
const ARXIV_RE = /(?:arxiv:|\/abs\/)(\d{4}\.\d{4,5})(v\d+)?/i

export function detectIdentifier(input) {
  const s = (input || '').trim()
  const doi = DOI_RE.exec(s)
  if (doi) return { kind: 'doi', value: doi[0].replace(/[.,;:)\]}>'"]+$/, '') }
  const arx = ARXIV_RE.exec(s)
  if (arx) return { kind: 'arxiv', value: arx[1] + (arx[2] || '') }
  return null
}

const CROSSREF_TYPE = {
  'journal-article': 'article-journal', 'proceedings-article': 'paper-conference',
  'book': 'book', 'book-chapter': 'chapter', 'posted-content': 'article',
  'report': 'report', 'dissertation': 'thesis',
}

function slug(s) { return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '') }

export function makeCitekey(item) {
  const fam = item.author?.[0]?.family || item.author?.[0]?.literal || 'anon'
  const year = item.issued?.['date-parts']?.[0]?.[0] || 'nd'
  const word = (item.title || '').split(/\s+/).find(w => w.length > 3) || ''
  return (slug(fam) + year + slug(word)).slice(0, 40) || ('ref' + Date.now().toString(36))
}

export function crossrefToCsl(m, id) {
  const first = v => Array.isArray(v) ? v[0] : v
  const item = {
    id, type: CROSSREF_TYPE[m.type] || 'document', title: first(m.title),
    _iw: { fields: {}, source: 'crossref' },
  }
  if (Array.isArray(m.author)) item.author = m.author.map(a => ({ family: a.family, given: a.given, literal: a.name }))
  if (m.issued?.['date-parts']) item.issued = { 'date-parts': m.issued['date-parts'] }
  if (first(m['container-title'])) item['container-title'] = first(m['container-title'])
  if (m.DOI) item.DOI = m.DOI
  if (m.volume) item.volume = m.volume
  if (m.issue) item.issue = m.issue
  if (m.page) item.page = m.page
  if (m.publisher) item.publisher = m.publisher
  if (m.URL) item.URL = m.URL
  for (const k of Object.keys(item)) if (k !== 'id' && k !== 'type' && !k.startsWith('_')) item._iw.fields[k] = { source: 'crossref' }
  return item
}

export async function lookupDoi(doi) {
  const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${MAILTO}`)
  if (!r.ok) throw new Error('crossref ' + r.status)
  const m = (await r.json()).message
  const id = makeCitekey({
    author: m.author, issued: m.issued, title: Array.isArray(m.title) ? m.title[0] : m.title,
  })
  return crossrefToCsl(m, id)
}

export async function lookupArxiv(arxivId) {
  const r = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`)
  if (!r.ok) throw new Error('arxiv ' + r.status)
  const xml = await r.text()
  // MV3 service workers have DOMParser (Chrome only; WXT build will use the TS module instead).
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const entry = doc.querySelector('entry')
  if (!entry) throw new Error('arxiv: no entry')
  const title = entry.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim()
  const authors = [...entry.querySelectorAll('author > name')].map(n => n.textContent?.trim()).filter(Boolean)
  const published = entry.querySelector('published')?.textContent?.trim()
  const doi = entry.querySelector('arxiv\\:doi, doi')?.textContent?.trim()
  const year = published ? Number(published.slice(0, 4)) : undefined
  const item = {
    id: makeCitekey({ author: authors.map(n => ({ literal: n })), issued: year ? { 'date-parts': [[year]] } : undefined, title }),
    type: 'article',
    _iw: { fields: {}, source: 'crossref' },
  }
  if (title) item.title = title
  if (authors.length) {
    item.author = authors.map(n => {
      const parts = n.trim().split(/\s+/)
      const family = parts.pop() || n
      return { family, given: parts.join(' ') || undefined }
    })
  }
  if (year) item.issued = { 'date-parts': [[year]] }
  if (doi) item.DOI = doi
  item.URL = `https://arxiv.org/abs/${arxivId}`
  for (const k of Object.keys(item)) if (k !== 'id' && k !== 'type' && !k.startsWith('_')) item._iw.fields[k] = { source: 'crossref' }
  return item
}

export async function captureFromUrl(url) {
  const id = detectIdentifier(url)
  if (id?.kind === 'doi') return lookupDoi(id.value)
  if (id?.kind === 'arxiv') return lookupArxiv(id.value)
  // LLM-scrape path omitted from the minimal build; the app's paste bar covers it.
  throw new Error('no identifier found on this page')
}
