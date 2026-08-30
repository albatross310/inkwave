// @vitest-environment jsdom
//
// "SAVE THIS PDF TO MY SOURCES" — driven through the REAL panel, over the REAL wire shape.
// Peter, 2026-08-30: "also can we have a downloads". LIVE, default-on.
//
// ⚠ WHY THIS AND NOT ONLY THE UNIT TESTS. `pdfAddress.test.ts` proves the rules and
// `savePdfSource.test.ts` proves the write order — and BOTH would stay green if the panel never
// called either of them. That is the exact failure the sibling file
// (`SourceBrowser.fetch.test.tsx`) exists to record: `pageSource.ts` was built, unit-tested and
// merged while the panel still fetched directly, so the whole feature was dead code with a green
// suite. So this asserts the SURFACE: that a PDF address raises the card, that pressing its button
// asks the extension over `reader/file`, and that the bytes that come back reach `savePdf`.
//
// OPFS is the one thing mocked, because jsdom has no `navigator.storage` and the citation library
// and PDF store both live in it. Everything between the click and those two calls is the real code.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { EXT_SOURCE, READER_FILED, READER_PONG } from '../reader/extensionProtocol'
import { _resetExtensionMemo } from '../reader/pageSource'
import type { CSLItem, IwCitationMeta } from '../types/document'

const h = vi.hoisted(() => ({
  store: new Map<string, CSLItem>(),
  savedPdfs: [] as Array<{ citekey: string; size: number }>,
}))

vi.mock('../citations/library', () => ({
  addToLibrary: async (item: CSLItem) => { h.store.set(item.id, item); return item },
}))
vi.mock('../citations/bibProvider', () => ({ bibProvider: { get: (k: string) => h.store.get(k) } }))
vi.mock('../citations/pdfStore', () => ({
  savePdf: async (citekey: string, blob: Blob) => { h.savedPdfs.push({ citekey, size: blob.size }) },
}))
vi.mock('../citations/pageOffset', () => ({ detectPageOffset: async () => {} }))

const { SourceBrowser } = await import('./SourceBrowser')

const PDF_BYTES = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n'
const PDF_URL = 'https://example.edu/papers/smith-2019.pdf'
const ARTICLE_URL = 'https://plato.stanford.edu/entries/identity/'

/**
 * The extension's content script, as far as this feature is concerned.
 *
 * ⚠ A `MessageEvent` DISPATCH, NOT `window.postMessage` — the sibling file measured why: jsdom
 * delivers a same-window postMessage with `source: null` and `origin: ""`, so `windowPort`'s two
 * real security checks reject it, the reply lands nowhere, and the test reads exactly like the
 * feature being broken.
 */
function installFakeExtension(opts: { canFetch: boolean; fileError?: string }) {
  const reply = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }))
  const seen: string[] = []
  const onMessage = (e: MessageEvent) => {
    const d = e.data as { source?: string; type?: string; uuid?: string; url?: string } | null
    if (!d || d.source !== 'inkwave-app') return
    seen.push(String(d.type))
    if (d.type === 'reader/ping') {
      reply({ source: EXT_SOURCE, type: READER_PONG, uuid: d.uuid, canFetch: opts.canFetch })
    }
    if (d.type === 'reader/file') {
      reply(opts.fileError
        ? { source: EXT_SOURCE, type: READER_FILED, uuid: d.uuid, ok: false, error: opts.fileError }
        : {
            source: EXT_SOURCE, type: READER_FILED, uuid: d.uuid,
            ok: true, finalUrl: d.url, mime: 'application/pdf',
            size: PDF_BYTES.length, b64: btoa(PDF_BYTES),
          })
    }
  }
  window.addEventListener('message', onMessage)
  return { seen, off: () => window.removeEventListener('message', onMessage) }
}

let ext: { seen: string[]; off: () => void } | null = null
let serverFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  _resetExtensionMemo()
  h.store.clear(); h.savedPdfs.length = 0
  localStorage.clear()
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class { observe() {} unobserve() {} disconnect() {} }
  if (!window.matchMedia) {
    ;(window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent: () => false,
    })
  }
  serverFetch = vi.fn(async () => new Response(
    JSON.stringify({ url: 'https://x/', title: 'FROM THE SERVER', blocks: [{ kind: 'para', runs: [{ text: 'server text' }], text: 'server text' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ))
  vi.stubGlobal('fetch', serverFetch)
})

afterEach(() => { ext?.off(); ext = null; cleanup(); vi.unstubAllGlobals() })

// The panel portals to document.body, so RTL's container is an empty div.
const mount = (url: string) => render(<SourceBrowser url={url} onClose={() => {}} />)
const readerCalls = () =>
  serverFetch.mock.calls.filter((c) => String(c[0]).includes('/api/reader') && !String(c[0]).includes('probe=1'))
const saveButton = () => document.querySelector<HTMLButtonElement>('[data-iw-pdf-save]')

describe('a PDF address raises the card instead of an extractor failure', () => {
  // ⚠ NO EXTENSION IN THESE TWO CELLS, AND THAT IS WHAT MAKES THEM DISCRIMINATE. The first cut
  // installed a ready extension and asserted `/api/reader` was never called — which was true
  // WHATEVER the panel did, because a ready extension takes the extension path and this fake
  // answers no `reader/fetch`, so the fallback sits behind a 25s deadline that outlives the
  // assertion. MUTATION-PROVED at the time: deleting the short-circuit left the cell fully green.
  // That is CLAUDE.md's own rule — a cell whose pass condition is satisfiable by the mechanism
  // that disables the feature is not a control. With no extension, a fetch would land at once, and
  // the article cell below proves that it does.
  it('says it is a PDF, names the file, and does NOT spend a fetch on it', async () => {
    // What used to happen: the extractor was handed a PDF, found no prose, and the panel said
    // "That page couldn't be read here" — a dead end for the commonest thing an academic clicks.
    mount(PDF_URL)
    await waitFor(() => expect(document.body.textContent).toContain('This is a PDF.'), { timeout: 3000 })
    expect(document.body.textContent).toContain('smith-2019.pdf')
    expect(readerCalls()).toHaveLength(0)
  })

  it('with no extension it draws NO save button, and says why before a press', async () => {
    // ⚠ MEASURED IN A REAL BROWSER FIRST (`pnpm prove:reader`), and it refuted the design this
    // feature shipped with in draft: the wall is not CORS, it is Inkwave's OWN `connect-src 'self'`,
    // which refuses a cross-origin fetch before it leaves the document. So a "save" button here
    // could never once succeed for any publisher — the dead control wearing an error message.
    mount(PDF_URL)   // cross-origin from jsdom's own origin, exactly as a publisher is
    await waitFor(() => expect(document.body.textContent).toContain('This is a PDF.'), { timeout: 3000 })
    expect(saveButton()).toBeNull()
    expect(document.body.textContent).toContain('only allowed to')
    // …and the offer is made at the wall it removes, not as a banner.
    expect(document.body.textContent).toContain('The Inkwave extension fixes this.')
    // The escape hatch survives: the writer can still look at the file.
    expect(document.querySelector('[data-iw-pdf-show]')).not.toBeNull()
  })

  it('KNOWN-POSITIVE / KNOWN-NEGATIVE: an ordinary article DOES fetch, and raises no card', async () => {
    // Two jobs in one cell, both load-bearing: it proves the spy above can see a call at all, and
    // it proves the card does not render on every address — which would cost the reader every
    // article it has.
    mount(ARTICLE_URL)
    await waitFor(() => expect(readerCalls().length).toBeGreaterThan(0), { timeout: 3000 })
    expect(document.body.textContent).not.toContain('This is a PDF.')
    expect(saveButton()).toBeNull()
  })
})

describe('pressing save asks the extension and stores what comes back', () => {
  it('asks over reader/file and files the bytes under the source’s citekey', async () => {
    ext = installFakeExtension({ canFetch: true })
    mount(PDF_URL)
    await waitFor(() => expect(saveButton()).not.toBeNull(), { timeout: 3000 })
    saveButton()!.click()

    await waitFor(() => expect(h.savedPdfs).toHaveLength(1), { timeout: 3000 })
    expect(ext!.seen).toContain('reader/file')
    expect(h.savedPdfs[0]).toEqual({ citekey: 'smith-2019', size: PDF_BYTES.length })
    // The bytes landing is only half of it: the entry must then CLAIM them, and only then.
    const meta = (h.store.get('smith-2019') as { _iw?: IwCitationMeta } | undefined)?._iw
    expect(meta?.pdfName).toBe('smith-2019.pdf')
    expect(meta?.sourceUrl).toBe(PDF_URL)
    await waitFor(() => expect(document.body.textContent).toContain('Saved as'), { timeout: 3000 })
  })

  it('a refusal is SHOWN, never a silent no-op — and only offers the extension where it helps', async () => {
    // `not a pdf` is a verdict about this FILE: it would fail identically with the extension
    // installed, so the card must not answer it by telling the writer to install one.
    ext = installFakeExtension({ canFetch: true, fileError: 'not a pdf' })
    mount(PDF_URL)
    await waitFor(() => expect(saveButton()).not.toBeNull(), { timeout: 3000 })
    saveButton()!.click()

    await waitFor(() => expect(document.body.textContent).toContain('didn’t return a PDF'), { timeout: 3000 })
    expect(h.savedPdfs).toHaveLength(0)
    expect(h.store.size).toBe(0)
    expect(document.body.textContent).not.toContain('The Inkwave extension fixes this.')
  })
})
