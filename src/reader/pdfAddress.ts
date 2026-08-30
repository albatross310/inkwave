// A PDF FOUND WHILE BROWSING → A SOURCE IN THE LIBRARY. The rules, pure, so the gate can hold them.
//
// Peter, 2026-08-30: "also can we have a downloads" — said while browsing in the source panel.
// Taken literally that is a downloads folder, which is not a thing this app has or should grow. He
// reads papers in order to CITE them, so the valuable reading of the ask is the one that closes
// that loop: the PDF he is looking at becomes a source, with its bytes where every other source
// PDF's bytes already live (OPFS `library/pdfs/`), so it opens in the PDF viewer he already has and
// appears beside its citation. The literal reading is answered too, and separately — the live
// frame's `sandbox` was missing `allow-downloads`, so an ordinary download link inside a framed
// page did nothing at all, silently. Both are in this lane; only this half needs rules.
//
// ⚠ WHAT IS OBSERVABLE, AND IT DECIDES THE SHAPE OF THE WHOLE FEATURE. A cross-origin iframe tells
// the embedder NOTHING: not what was clicked, not that a navigation happened, not what came back.
// So "intercept the PDF he clicks in the live frame" is not a thing that can be built — by us or by
// anyone, in any browser. What the panel CAN see is its own address (`here`), which every link
// followed in READER mode passes through. That is the seam this feature stands on, and it is why
// the affordance is attached to the address rather than to a click.
//
// ⚠ AND THE CONTENT-TYPE HEADER IS NOT THE AUTHORITY — THE BYTES ARE. A publisher's "download PDF"
// link that has quietly become a login wall answers 200 with `content-type: application/pdf` and an
// HTML body often enough to matter. Storing that under a `.pdf` name gives the writer a source that
// opens to nothing, months later, with no way to tell what happened. `looksLikePdfBytes` is the
// gate that must pass before anything is written, and it reads the file's own magic.

/**
 * Bytes past which a PDF is REFUSED, and named — never truncated (the media importer's rule, for
 * the same reason: a silently-degraded import is a file the writer believes they have).
 *
 * 20MB is far above any paper — and it is also the practical ceiling of the wire this travels on
 * when the extension fetches it. The bytes cross `runtime.sendMessage` (JSON, so base64) and then
 * `window.postMessage`, which makes a 20MB file a ~27MB string in flight. That is a real cost paid
 * once on an explicit press, and it is the reason the cap is a number rather than "as big as OPFS
 * will take".
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
 * Does this ADDRESS look like a PDF?
 *
 * Deliberately conservative: it decides whether the panel offers to SAVE, and a false positive
 * turns a readable article into a card that cannot fetch anything. It is also never the last word —
 * the bytes are checked before a single one is stored, so the worst a wrong answer here can do is
 * offer an action that then declines with a reason.
 *
 * The two shapes that cover essentially every real case: a path ending `.pdf` (with or without a
 * query or fragment), and the extension-less repository forms — arXiv's `/pdf/2301.12345`, and the
 * `?…format=pdf` / `?…type=pdf` a journal platform hangs off an article id.
 *
 * The parameter check is by NAME as well as value: a bare `?q=pdf` is somebody searching for the
 * word, and answering that with a save card is the panel telling the writer it found a file when
 * it found a search.
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
 * ⚠ THIS IS A LABEL, NOT A CLAIM. `makeCitekey` (citations/cslMap.ts) builds `author + year + word`
 * out of metadata; here there is none — a URL and a filename is genuinely all we know. So the key
 * is derived from the filename, which is at least the publisher's own name for the thing and is
 * what the writer will recognise in the panel. `addToLibrary` de-collides it (`freeCitekey`), and
 * the entry is saved with author and year EMPTY on purpose, so the citation panel shows it as
 * needing them rather than inventing an attribution the file never carried.
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
// ⚠ MEASURED IN A REAL BROWSER (`pnpm prove:reader`, 2026-08-30), AND IT REFUTED THE FIRST DESIGN.
// The plan was "try the extension, fall back to a direct fetch" — reasonable, and WRONG, because
// the wall is not CORS. It is our OWN Content-Security-Policy: `middleware.ts` sets
// `connect-src 'self' <a named list of hosts>`, so a cross-origin request from this origin is
// refused BY US, before CORS is ever consulted:
//
//     Refused to connect because it violates the document's Content Security Policy
//
// That header is not a nuisance to route around. This origin holds the writer's thesis and their
// signing session, and the allow-list is what stops anything running here from talking to an
// arbitrary host. Widening it to `https:` to make a convenience feature work would be trading the
// document's own containment for a saved click — so the CSP stands, and the FEATURE bends.
//
// The consequence has to be visible in the UI rather than discovered by pressing: with no
// extension, a cross-origin PDF has NO route, and the card must say so up front instead of drawing
// a button that will always fail. "Do not draw a button that does nothing" is this panel's own
// rule, and a button that reliably explains a wall is still a button that never does the thing it
// is labelled with.

/** Where the bytes could come from, if anywhere. */
export type PdfRoute = 'extension' | 'direct' | 'none'

/**
 * Can this page get the file at all?
 *
 * `direct` is NOT dead code and is not decoration: `'self'` is in the CSP, so a PDF served from
 * Inkwave's own origin genuinely fetches — and that is the case the browser probe exercises, since
 * no probe can load an unpacked extension.
 */
export function pdfRouteFor(url: string, extensionReady: boolean, pageOrigin?: string): PdfRoute {
  if (extensionReady) return 'extension'
  const origin = pageOrigin ?? (typeof location === 'undefined' ? '' : location.origin)
  try { if (origin && new URL(url).origin === origin) return 'direct' } catch { /* not a URL */ }
  return 'none'
}
