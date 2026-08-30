// "Save this PDF to my sources" — the ORDER of the writes, which is the only thing this module owns.
//
// ⚠ WHY THIS TEST IS THE ONE THAT MATTERS. `_iw.pdfName` IS the claim that bytes exist (`hasPdf` is
// `!!pdfName` and nothing else), so writing it before the bytes land creates an entry that lies
// about a file — the shape of every "the file is gone" bug in this repo, discovered months later
// when the writer opens a source and finds nothing. A browser probe cannot see the ordering; this
// can, in ~10ms.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CSLItem, IwCitationMeta } from '../types/document'

const h = vi.hoisted(() => {
  /** Every call, in order, as `name:detail` — so an assertion can be about SEQUENCE, not counts. */
  const log: string[] = []
  const store = new Map<string, CSLItem>()
  return {
    log,
    store,
    /** `addToLibrary`'s real de-collision, in one line: the test sets this to force a suffix. */
    assignId: { fn: (id: string) => id },
    savePdfImpl: { fn: (async () => {}) as () => Promise<void> },
    /** The library that failed to hydrate keeps changes in memory and never persists. */
    persists: { yes: true },
  }
})

vi.mock('../citations/library', () => ({
  addToLibrary: async (item: CSLItem) => {
    const id = h.assignId.fn(item.id)
    const stored = { ...item, id }
    const iw = (stored as { _iw?: IwCitationMeta })._iw
    h.log.push(`addToLibrary:${id}:${iw?.pdfName ? 'withPdfName' : 'noPdfName'}`)
    if (h.persists.yes) h.store.set(id, stored)
    return stored
  },
}))
vi.mock('../citations/bibProvider', () => ({
  bibProvider: { get: (k: string) => h.store.get(k) },
}))
vi.mock('../citations/pdfStore', () => ({
  savePdf: async (citekey: string, blob: Blob) => {
    h.log.push(`savePdf:${citekey}:${blob.size}`)
    return h.savePdfImpl.fn()
  },
}))
vi.mock('../citations/pageOffset', () => ({
  detectPageOffset: async (citekey: string) => { h.log.push(`detectPageOffset:${citekey}`) },
}))

const { savePdfAsSource, explainFetchFailure } = await import('./savePdfSource')

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n')
const URL_ = 'https://example.edu/papers/smith-2019.pdf'

const pdfNameOf = (k: string) =>
  (h.store.get(k) as { _iw?: IwCitationMeta } | undefined)?._iw?.pdfName

beforeEach(() => {
  h.log.length = 0
  h.store.clear()
  h.assignId.fn = (id) => id
  h.savePdfImpl.fn = async () => {}
  h.persists.yes = true
})

describe('savePdfAsSource — the write order', () => {
  it('writes the entry, THEN the bytes, THEN the claim that the bytes exist', async () => {
    const r = await savePdfAsSource({ url: URL_, bytes: PDF })
    expect(r).toEqual({ ok: true, citekey: 'smith-2019', pdfName: 'smith-2019.pdf' })
    expect(h.log).toEqual([
      'addToLibrary:smith-2019:noPdfName',
      `savePdf:smith-2019:${PDF.byteLength}`,
      'addToLibrary:smith-2019:withPdfName',
      'detectPageOffset:smith-2019',
    ])
  })

  it('files the bytes under the key the LIBRARY assigned, not the one we proposed', async () => {
    // `freeCitekey` appends -2 when a DIFFERENT source already holds the key. Writing the bytes
    // under the proposed key would file them where nothing will ever look.
    h.assignId.fn = (id) => `${id}-2`
    const r = await savePdfAsSource({ url: URL_, bytes: PDF })
    expect(r.ok && r.citekey).toBe('smith-2019-2')
    expect(h.log).toContain(`savePdf:smith-2019-2:${PDF.byteLength}`)
    expect(h.log.some((l) => l.startsWith('savePdf:smith-2019:'))).toBe(false)
  })

  it('a failed byte write leaves NO entry claiming a PDF — only an honest URL-only source', async () => {
    h.savePdfImpl.fn = async () => { throw new Error('Storage unavailable — cannot embed the PDF on this device.') }
    const r = await savePdfAsSource({ url: URL_, bytes: PDF })
    expect(r.ok).toBe(false)
    // The half that worked is REPORTED, not hidden: the writer has a source, just not the file.
    expect(!r.ok && r.reason).toContain('smith-2019')
    expect(!r.ok && r.reason).toContain('couldn’t be stored')
    // …and the entry does not lie about the file.
    expect(pdfNameOf('smith-2019')).toBeUndefined()
    expect(h.log.filter((l) => l.includes('withPdfName'))).toEqual([])
  })

  it('refuses when the library could not actually persist the entry', async () => {
    // `addToLibrary` RESOLVING is not proof it wrote: `persistLibrary` refuses while the library's
    // own hydration failed. Reporting success there would be answering an unknown as a known-good.
    h.persists.yes = false
    const r = await savePdfAsSource({ url: URL_, bytes: PDF })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('couldn’t write')
    expect(h.log.some((l) => l.startsWith('savePdf:'))).toBe(false)
  })
})

describe('savePdfAsSource — the refusals, before anything is written', () => {
  it('refuses bytes that are not a PDF', async () => {
    const r = await savePdfAsSource({ url: URL_, bytes: new TextEncoder().encode('<!doctype html>') })
    expect(r.ok).toBe(false)
    expect(h.log).toEqual([])
  })

  it('NAMES an oversized file rather than truncating it', async () => {
    const big = new Uint8Array(21 * 1024 * 1024)
    big.set(PDF)
    const r = await savePdfAsSource({ url: URL_, bytes: big })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('21.0 MB')
    expect(!r.ok && r.reason).toContain('20.0 MB')
    expect(h.log).toEqual([])
  })
})

describe('savePdfAsSource — what the entry claims', () => {
  it('records the address and leaves author and year EMPTY', async () => {
    await savePdfAsSource({ url: URL_, bytes: PDF, pageTitle: 'Personal Identity' })
    const item = h.store.get('smith-2019') as CSLItem & { URL?: string; _iw?: IwCitationMeta }
    expect(item.title).toBe('Personal Identity')
    expect(item.URL).toBe(URL_)
    expect(item._iw?.sourceUrl).toBe(URL_)
    expect(item._iw?.pdfName).toBe('smith-2019.pdf')
    // A file tells us its address, not who wrote it. An invented attribution would look finished.
    expect(item.author).toBeUndefined()
    expect(item.issued).toBeUndefined()
  })
})

describe('explainFetchFailure — the extension is offered only where it removes the wall', () => {
  it('offers it when this origin has no route to the file at all', () => {
    const r = explainFetchFailure('no route')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.offerExtension).toBe(true)
  })

  it('does NOT offer it for a permission it already holds — that needs the popup, not an install', () => {
    const r = explainFetchFailure('needs-permission')
    expect(!r.ok && r.offerExtension).toBe(false)
    expect(!r.ok && r.reason).toContain('popup')
  })

  it('does NOT offer it where it would fail identically — a promise it knows it cannot keep', () => {
    for (const code of ['too large', 'not a pdf', 'timed out', 'http 403', 'anything else']) {
      const r = explainFetchFailure(code)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.offerExtension).toBeFalsy()
      expect(!r.ok && r.reason.length).toBeGreaterThan(10)
    }
  })

  it('quotes an HTTP status back, because a 403 and a 404 need different things from the writer', () => {
    const r = explainFetchFailure('http 403')
    expect(!r.ok && r.reason).toContain('403')
  })
})
