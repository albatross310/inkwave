// A PDF FOUND WHILE BROWSING → A SOURCE IN THE LIBRARY. The rules, pure, so the gate can hold them.
//
// ⚠ THE AFFORDANCE IS ATTACHED TO THE ADDRESS, NEVER TO A CLICK, and that is forced rather than
// chosen: a cross-origin iframe tells the embedder NOTHING — not what was clicked, not that a
// navigation happened, not what came back — so "intercept the PDF he clicks in the live frame"
// cannot be built by anyone, in any browser. The panel's own address is the only seam there is.
//
// ⚠ AND THE CONTENT-TYPE HEADER IS NOT THE AUTHORITY — THE BYTES ARE. A publisher's download link
// that has become a login wall answers 200 `application/pdf` with an HTML body, and storing that
// under a `.pdf` name gives the writer a source that opens to nothing months later.
// `looksLikePdfBytes` must pass before anything is written.
// → docs/archive/reader-panels.md#pdfaddress

/**
 * Bytes past which a PDF is REFUSED, and NAMED — never truncated (the media importer's rule: a
 * silently-degraded import is a file the writer believes they have). The number exists because the
 * bytes cross two JSON hops as base64, making a 20MB file a ~27MB string in flight.
 * → docs/archive/reader-panels.md#pa-magic-bytes
 */
export const PDF_MAX_BYTES = 20 * 1024 * 1024

/** `%PDF-` — the header every PDF opens with. Eight bytes is enough to be sure and cheap to read. */
export function looksLikePdfBytes(head: ArrayBuffer | Uint8Array): boolean {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head)
  if (b.length < 5) return false
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d
}

/** True when a response says it is a PDF. A HINT, never the verdict — see the header. */
export function isPdfContentType(ctype: string | null | undefined): boolean {
  return /application\/(x-)?pdf/i.test(ctype || '')
}

/**
 * Does this ADDRESS look like a PDF? Deliberately conservative — it decides whether the panel offers
 * to SAVE, and a false positive turns a readable article into a card that cannot fetch anything.
 * Never the last word, since the bytes are checked before one is stored.
 *
 * ⚠ The parameter check is by NAME as well as value: a bare `?q=pdf` is somebody searching for the
 * word. → docs/archive/reader-panels.md#pa-magic-bytes
 */
const PDF_PARAMS = /^(format|type|filetype|mimetype|download|output|rendering)$/i
export function looksLikePdfAddress(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (/\.pdf$/i.test(u.pathname)) return true
  if (/(^|\.)arxiv\.org$/i.test(u.hostname) && /^\/pdf\//i.test(u.pathname)) return true
  for (const [k, v] of u.searchParams) if (PDF_PARAMS.test(k) && /^pdf$/i.test(v)) return true
  return false
}

/** The filename we record as `_iw.pdfName`. The writer sees this in the citation row, so it is the
 *  publisher's own name for the file where there is one, and never a uuid. */
export function pdfFileNameFor(url: string): string {
  const stem = pdfStemFor(url)
  return `${stem}.pdf`
}

/** The last path segment, minus any `.pdf`, cleaned of the punctuation a filename picks up. */
function pdfStemFor(url: string): string {
  let last = ''
  try {
    const u = new URL(url)
    last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
    if (!last) last = u.hostname
  } catch { last = '' }
  const stem = last.replace(/\.pdf$/i, '').trim()
  return stem || 'source'
}

/**
 * A first citekey for a PDF nobody has told us the author of.
 *
 * ⚠ IT IS A LABEL, NOT A CLAIM. A URL and a filename is genuinely all we know, so the key comes from
 * the filename and the entry is saved with author and year EMPTY on purpose — the panel shows it as
 * needing them rather than inventing an attribution the file never carried.
 * → docs/archive/reader-panels.md#pa-citekey
 */
export function citekeyForPdfUrl(url: string): string {
  const raw = pdfStemFor(url)
  const key = raw
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (key && /[a-z]/.test(key)) return key
  // All digits (arXiv ids, DOI suffixes) or nothing left — prefix with the host so the library does
  // not fill with keys that read as page numbers.
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./i, '').split('.')[0] ?? '' } catch { /* not a URL */ }
  const h = host.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return `${h || 'source'}${key ? `-${key}` : ''}`.slice(0, 40)
}

/** A readable title for the entry, from the filename. Title case is not attempted — a stem like
 *  `2301.12345v1` is not a title and dressing it up as one would be worse than leaving it plain. */
export function titleForPdfUrl(url: string, pageTitle?: string | null): string {
  const t = (pageTitle ?? '').trim()
  if (t && !/^https?:\/\//i.test(t)) return t
  return pdfStemFor(url).replace(/[_-]+/g, ' ').trim() || pdfFileNameFor(url)
}

/** How big is too big, said the way the writer reads it. */
export function mbOf(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── WHO CAN ACTUALLY FETCH IT — AND THE ANSWER IS NOT WHAT IT LOOKS LIKE ────────────────────────
// ⚠ THE WALL IS OUR OWN CSP, NOT CORS (measured — it refuted the "try, then fall back" design).
// `middleware.ts` sets `connect-src 'self' <named hosts>`, so a cross-origin request is refused BY
// US before CORS is consulted. That header STANDS: this origin holds the thesis and the signing
// session, and widening it to `https:` would trade the document's containment for a saved click.
// So the FEATURE bends — with no extension a cross-origin PDF has NO route, and the card says so up
// front rather than drawing a button that will always fail.
// → docs/archive/reader-panels.md#pa-csp-wall

/** Where the bytes could come from, if anywhere. */
export type PdfRoute = 'extension' | 'direct' | 'none'

/**
 * Can this page get the file at all? `direct` is NOT dead code: `'self'` is in the CSP, so a PDF on
 * Inkwave's own origin genuinely fetches — and that is the case the browser probe exercises, since
 * no probe can load an unpacked extension.
 */
export function pdfRouteFor(url: string, extensionReady: boolean, pageOrigin?: string): PdfRoute {
  if (extensionReady) return 'extension'
  const origin = pageOrigin ?? (typeof location === 'undefined' ? '' : location.origin)
  try { if (origin && new URL(url).origin === origin) return 'direct' } catch { /* not a URL */ }
  return 'none'
}
