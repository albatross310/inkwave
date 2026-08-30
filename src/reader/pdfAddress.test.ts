// The rules behind "save this PDF to my sources" — the source panel's answer to Peter's
// "also can we have a downloads" (2026-08-30). LIVE, default-on.
//
// The browser probe (`pnpm prove:reader`) is the in-browser truth; it is not a guard. These are the
// cheap keepers: ~10ms, no browser, and each one pins a decision that a later edit could quietly
// undo — most of all the two REFUSALS, which are the difference between a source and a file the
// writer only believes they have.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  citekeyForPdfUrl, isPdfContentType, looksLikePdfAddress, looksLikePdfBytes, mbOf,
  PDF_MAX_BYTES, pdfFileNameFor, titleForPdfUrl,
} from './pdfAddress'

const bytesOf = (s: string) => new TextEncoder().encode(s)

describe('looksLikePdfAddress', () => {
  it('takes a path that ends .pdf, with or without a query or fragment', () => {
    expect(looksLikePdfAddress('https://example.edu/papers/smith-2019.pdf')).toBe(true)
    expect(looksLikePdfAddress('https://example.edu/a.pdf?download=1')).toBe(true)
    expect(looksLikePdfAddress('https://example.edu/a.PDF#page=4')).toBe(true)
  })

  it('takes arXiv, which serves PDFs with no extension at all', () => {
    expect(looksLikePdfAddress('https://arxiv.org/pdf/2301.12345')).toBe(true)
    expect(looksLikePdfAddress('https://arxiv.org/pdf/2301.12345v2')).toBe(true)
    // …but arXiv's ABSTRACT page is a real article the reader should extract, not a file.
    expect(looksLikePdfAddress('https://arxiv.org/abs/2301.12345')).toBe(false)
  })

  it('takes a format parameter only when the PARAMETER is one that means a format', () => {
    expect(looksLikePdfAddress('https://journal.org/article/1234?format=pdf')).toBe(true)
    expect(looksLikePdfAddress('https://journal.org/article/1234?type=PDF')).toBe(true)
    // ⚠ THE NAME MATTERS. `?q=pdf` is somebody SEARCHING for the word, and answering that with a
    // save card is the panel telling the writer it found a file when it found a search.
    expect(looksLikePdfAddress('https://duckduckgo.com/?q=pdf')).toBe(false)
  })

  it('leaves ordinary articles alone — a false positive costs the reader its whole article', () => {
    expect(looksLikePdfAddress('https://plato.stanford.edu/entries/identity/')).toBe(false)
    expect(looksLikePdfAddress('https://en.wikipedia.org/wiki/PDF')).toBe(false)
    expect(looksLikePdfAddress('https://example.com/pdf-explained')).toBe(false)
    expect(looksLikePdfAddress('not a url')).toBe(false)
  })
})

describe('looksLikePdfBytes — the authority, because a header can lie', () => {
  it('accepts a real PDF header', () => {
    expect(looksLikePdfBytes(bytesOf('%PDF-1.7\n…'))).toBe(true)
    expect(looksLikePdfBytes(bytesOf('%PDF-1.7\n…').buffer as ArrayBuffer)).toBe(true)
  })

  it('REFUSES the sign-in page a publisher answers a download link with', () => {
    // This is the whole reason the check reads bytes: such a response arrives 200 with
    // `content-type: application/pdf` often enough to matter, and storing it gives the writer a
    // source that opens to nothing, months later, with no way to tell what happened.
    expect(looksLikePdfBytes(bytesOf('<!doctype html><html><body>Sign in'))).toBe(false)
    expect(isPdfContentType('application/pdf')).toBe(true) // the header said yes…
  })

  it('refuses a truncated head rather than guessing from it', () => {
    expect(looksLikePdfBytes(bytesOf('%PDF'))).toBe(false)
    expect(looksLikePdfBytes(new Uint8Array(0))).toBe(false)
  })
})

describe('citekeyForPdfUrl', () => {
  it('reads the publisher’s own filename, which is what the writer will recognise', () => {
    expect(citekeyForPdfUrl('https://example.edu/papers/smith-2019.pdf')).toBe('smith-2019')
    expect(citekeyForPdfUrl('https://example.edu/Parfit_Personal_Identity.PDF')).toBe('parfit-personal-identity')
  })

  it('prefixes a purely numeric id with its host, so the library does not fill with page numbers', () => {
    expect(citekeyForPdfUrl('https://arxiv.org/pdf/2301.12345')).toBe('arxiv-2301-12345')
  })

  it('always returns something usable', () => {
    expect(citekeyForPdfUrl('https://example.com/')).toBe('example-com')
    expect(citekeyForPdfUrl('nonsense')).toBe('source')
  })

  it('stays inside a citekey’s length', () => {
    const long = 'https://example.edu/' + 'a'.repeat(200) + '.pdf'
    expect(citekeyForPdfUrl(long).length).toBeLessThanOrEqual(40)
  })
})

describe('pdfFileNameFor / titleForPdfUrl', () => {
  it('records the file under a name the writer will recognise, always ending .pdf', () => {
    expect(pdfFileNameFor('https://example.edu/papers/smith-2019.pdf')).toBe('smith-2019.pdf')
    expect(pdfFileNameFor('https://arxiv.org/pdf/2301.12345')).toBe('2301.12345.pdf')
    expect(pdfFileNameFor('nonsense')).toBe('source.pdf')
  })

  it('prefers a real page title and never uses a URL as one', () => {
    expect(titleForPdfUrl('https://example.edu/a.pdf', 'Personal Identity')).toBe('Personal Identity')
    expect(titleForPdfUrl('https://example.edu/personal_identity.pdf', 'https://example.edu/a.pdf'))
      .toBe('personal identity')
    expect(titleForPdfUrl('https://example.edu/personal-identity.pdf', null)).toBe('personal identity')
  })
})

describe('the size limit is NAMED, never applied by truncating', () => {
  it('is a real number a writer can be told', () => {
    expect(PDF_MAX_BYTES).toBe(20 * 1024 * 1024)
    expect(mbOf(PDF_MAX_BYTES)).toBe('20.0 MB')
    expect(mbOf(1_500_000)).toBe('1.4 MB')
  })
})

// ── THE OTHER HALF OF "downloads": THE LIVE FRAME'S SANDBOX ─────────────────────────────────────
// Without `allow-downloads` a download link inside a framed page does NOTHING AT ALL — the browser
// blocks the navigation and reports it only to its own console, so the site looks broken and
// Inkwave looks like the reason. It was absent by OMISSION rather than by decision, which is
// exactly the kind of thing that comes back: the token list is long, and nothing else in the gate
// reads it. ~1ms, no browser; `pnpm prove:reader` is the in-browser truth.
describe('the live frame may start a download', () => {
  const src = readFileSync(resolve(__dirname, '../components/SourceBrowser.tsx'), 'utf8')
  // Comments are STRIPPED: the fix's own comment names every token in order to explain what each
  // one permits, and a raw-text guard would be reading its own documentation.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')
  const sandbox = /sandbox="([^"]+)"/.exec(code)?.[1] ?? ''

  it('finds the attribute at all — a regex that matches nothing must not read as a pass', () => {
    expect(sandbox.length).toBeGreaterThan(20)
    expect(sandbox.split(/\s+/)).toContain('allow-scripts')
  })

  it('carries allow-downloads', () => {
    expect(sandbox.split(/\s+/)).toContain('allow-downloads')
  })

  it('did not quietly widen anything else while it was in there', () => {
    // `allow-top-navigation` would let a framed page replace the whole Inkwave tab, taking the
    // writer away from their document. It has never been granted and this is why.
    expect(sandbox).not.toContain('allow-top-navigation')
    expect(sandbox).not.toContain('allow-modals')
  })
})
