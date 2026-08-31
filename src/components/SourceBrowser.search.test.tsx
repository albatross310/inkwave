// @vitest-environment jsdom
//
// ⚠ THE SEARCH CHAIN MUST JUDGE *THIS* ADDRESS'S PAGE, NOT THE ONE BEFORE IT.
//
// Found by `pnpm prove:readerflow` on 2026-08-31, in the real browser. `SourceBrowser`'s
// fall-forward effect reads `doc.blocks` to decide whether an engine came back empty — but on the
// commit where `here` changes it still holds the PREVIOUS page's doc: the load effect above it
// queues `setDoc(null)`, and a React effect closure captures the render's values, not the queued
// ones. An ARTICLE has fewer than five linked blocks by definition, so `searchLooksEmpty` was true
// for every search issued from an ordinary page and the chain advanced before the first engine had
// answered a thing.
//
// WHAT THAT COST, and why it looked like nothing: the writer always landed on the LAST engine in
// the chain, which usually serves — so search "worked". But a chain built so that one engine going
// quiet is survivable had already spent itself on arrival, which is Peter's "not searching
// anything" the moment the last engine blinks. It also truncated forward history, because `go`
// slices the stack at the current index.
//
// THE BROWSER PROBE IS THE TRUTH; IT IS NOT A GUARD. It needs a build, a server and ~60s, so six
// weeks from now a proof that ran once is indistinguishable from one that never ran. This is the
// ~1s version that fails at home instead.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { _resetExtensionMemo } from '../reader/pageSource'
import { SEARCH_ENGINES } from '../reader/address'
import { SourceBrowser } from './SourceBrowser'

/** A results page as the reader counts one: BLOCKS that carry links. */
const linkedBlocks = (n: number, label: string) =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'para', text: `${label} ${i}`,
    runs: [{ text: `${label} ${i}`, href: `https://result-${i}.example/page` }],
  }))

/** An ordinary article: prose, one incidental link. This is what `searchLooksEmpty` calls "empty",
 *  and that is the whole trap — it is not a failed search, it is the page you were just reading. */
const ARTICLE = { url: 'https://plato.stanford.edu/entries/identity/', title: 'An Article',
  blocks: [...linkedBlocks(1, 'see also'), { kind: 'para', text: 'prose', runs: [{ text: 'prose' }] }] }

let serverFetch: ReturnType<typeof vi.fn>
/** Every /api/reader page read, in order, so "which engine was asked, and when" is answerable. */
let reads: string[]

beforeEach(() => {
  _resetExtensionMemo()
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class { observe() {} unobserve() {} disconnect() {} }
  if (!window.matchMedia) {
    ;(window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent: () => false,
    })
  }
  reads = []
  serverFetch = vi.fn(async (input: unknown) => {
    const u = new URL(String(input), 'http://localhost')
    if (u.searchParams.get('probe') === '1') {
      return new Response(JSON.stringify({ framable: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const target = u.searchParams.get('url') || ''
    reads.push(target)
    // Both engines are HEALTHY here. That is deliberate: if the chain advances anyway, it did so
    // without evidence, which is the defect. A starved fixture would hide it behind a real reason.
    const eng = SEARCH_ENGINES.find((e) => target.startsWith(e.url))
    const body = eng
      ? { url: target, title: `${eng.name} results`, blocks: linkedBlocks(8, eng.name) }
      : ARTICLE
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', serverFetch)
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const engineOf = (url: string) => SEARCH_ENGINES.find((e) => url.startsWith(e.url))?.name ?? null
const enginesRead = () => reads.map(engineOf).filter(Boolean) as string[]

// The panel portals to document.body, so RTL's container is an empty div.
const mountAt = (url: string) => render(<SourceBrowser url={url} onClose={() => {}} />)

describe('the search chain does not spend itself on the previous page', () => {
  // VOID GUARD: with a one-engine chain there is nothing to fall forward TO, and every assertion
  // below would hold for a component that had no chain at all.
  it('there is a chain to reason about', () => {
    expect(SEARCH_ENGINES.length).toBeGreaterThan(1)
  })

  it('a search issued FROM AN ARTICLE is served by the FIRST engine', async () => {
    const { rerender } = mountAt(ARTICLE.url)
    await waitFor(() => expect(reads).toContain(ARTICLE.url), { timeout: 3000 })

    // Now navigate to a search, the way typing in the address bar does: the panel's `url` prop is
    // the address. This is the exact commit on which the effect used to read the article's blocks.
    const q = SEARCH_ENGINES[0].url + encodeURIComponent('identity over time')
    rerender(<SourceBrowser url={q} onClose={() => {}} />)

    // Wait for the chain to STOP, then read it whole. Waiting for the first engine specifically
    // fails as a TIMEOUT — which reads as a broken test rather than as the finding — and the bug
    // has two faces: with the advance racing the load effect's `await extensionState()`, the first
    // engine is sometimes not merely overruled but never asked at all.
    await waitFor(() => expect(enginesRead().length).toBeGreaterThan(0), { timeout: 3000 })
    await new Promise((r) => setTimeout(r, 200))
    const seen = enginesRead()
    expect(seen, 'the first engine was never even asked — the advance beat its fetch').toContain(SEARCH_ENGINES[0].name)
    expect(seen, 'the chain advanced past a healthy first engine — it judged the article you came from')
      .not.toContain(SEARCH_ENGINES[1].name)
  })

  it('KNOWN-POSITIVE: the chain still advances when THIS page really is empty', async () => {
    // Without this, the test above is satisfied by a component whose chain never advances at all —
    // which would be a worse bug wearing a passing test.
    serverFetch.mockImplementation(async (input: unknown) => {
      const u = new URL(String(input), 'http://localhost')
      if (u.searchParams.get('probe') === '1') {
        return new Response(JSON.stringify({ framable: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const target = u.searchParams.get('url') || ''
      reads.push(target)
      // The first engine answers 200 with a challenge page: well-formed, and almost no links.
      const starved = target.startsWith(SEARCH_ENGINES[0].url)
      const eng = SEARCH_ENGINES.find((e) => target.startsWith(e.url))
      const body = eng
        ? { url: target, title: `${eng.name}`, blocks: starved ? linkedBlocks(1, 'help') : linkedBlocks(8, eng.name) }
        : ARTICLE
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    mountAt(SEARCH_ENGINES[0].url + encodeURIComponent('endurantism'))
    await waitFor(() => expect(enginesRead()).toContain(SEARCH_ENGINES[1].name), { timeout: 3000 })
  })
})
