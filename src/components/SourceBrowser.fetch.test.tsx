// @vitest-environment jsdom
//
// ⚠ THE GUARD FOR THE FAILURE THIS FEATURE ALREADY HAD ONCE.
//
// `src/reader/pageSource.ts` was built, unit-tested and merged while `SourceBrowser` still called
// `fetch('/api/reader?url=…')` directly — so the entire fetch-from-the-writer's-own-IP path was
// DEAD CODE that reached no user, and every test in `pageSource.test.ts` passed. That is exactly
// the "mechanism with no surface" failure CLAUDE.md records, and a green unit suite is what let it
// through: nothing anywhere asserted that the READER uses the layer.
//
// So this drives the real component. It is deliberately about ROUTING and nothing else — the panel
// renders a portal full of KaTeX, dock geometry and OPFS-adjacent imports, and asserting on its
// pixels here would be a second, worse copy of `scripts/textrender-probe/reader.prove.mjs`. What
// only a component test can cheaply keep is: WHICH FETCHER RAN.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { EXT_SOURCE, READER_FETCHED, READER_PONG } from '../reader/extensionProtocol'
import { _resetExtensionMemo } from '../reader/pageSource'
import { SourceBrowser } from './SourceBrowser'

const PAGE = `<!doctype html><html><head><title>From The Extension</title></head><body><main>
  <h1>From The Extension</h1><p>A paragraph long enough for the extractor to keep it.</p>
</main></body></html>`

/**
 * Stands in for the extension's content script, which is a page-context window listener — so a
 * faithful stand-in is exactly that and nothing more. `canFetch:false` reproduces the
 * installed-but-unpermitted state; omitting the whole listener reproduces "not installed".
 *
 * ⚠ IT DISPATCHES A MessageEvent RATHER THAN CALLING `window.postMessage`, and that is fidelity,
 * not a shortcut. MEASURED: jsdom delivers a same-window postMessage with **`source: null` and
 * `origin: ""`**, so `windowPort`'s two real security checks (`e.source !== window`,
 * `e.origin !== location.origin`) correctly reject it — the reply lands nowhere and every
 * extension test silently falls through to the server, which reads exactly like the feature being
 * broken. A real browser sets both fields; this sets what a real browser sets. If the guards in
 * `windowPort` are ever weakened, these tests keep passing, so `pageSource.test.ts` owns them
 * directly.
 */
function installFakeExtension(opts: { canFetch: boolean; html?: string }) {
  const reply = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }))
  const onMessage = (e: MessageEvent) => {
    const d = e.data as { source?: string; type?: string; uuid?: string } | null
    if (!d || d.source !== 'inkwave-app') return
    if (d.type === 'reader/ping') {
      reply({ source: EXT_SOURCE, type: READER_PONG, uuid: d.uuid, canFetch: opts.canFetch })
    }
    if (d.type === 'reader/fetch') {
      reply({
        source: EXT_SOURCE, type: READER_FETCHED, uuid: d.uuid,
        ok: true, finalUrl: 'https://plato.stanford.edu/entries/identity/', html: opts.html ?? PAGE,
      })
    }
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

let removeExt: (() => void) | null = null
let serverFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  _resetExtensionMemo()   // the probe is memoised per page load; each test is a fresh load
  // jsdom has neither, and the panel measures itself on mount.
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

afterEach(() => {
  removeExt?.(); removeExt = null
  cleanup()
  vi.unstubAllGlobals()
})

// ⚠ READ `document.body`, NOT the render container. The panel is `createPortal(..., document.body)`,
// so RTL's container is an empty div — the first cut asserted on it, found '', and reported the
// reader as rendering nothing while a full panel sat in the DOM beside it.
const mount = () => render(
  <SourceBrowser url="https://plato.stanford.edu/entries/identity/" onClose={() => {}} />,
)

/** Requests the panel made to our own endpoint, ignoring anything else that happens to use fetch. */
const readerCalls = () =>
  serverFetch.mock.calls.filter((c) => String(c[0]).includes('/api/reader') && !String(c[0]).includes('probe=1'))

describe('the source reader routes its fetch through the extension layer', () => {
  it('with the extension ready, /api/reader is never asked for the page', async () => {
    removeExt = installFakeExtension({ canFetch: true })
    mount()
    // Wait for the ARTICLE, not for a clock: the panel resolves the extension probe first.
    await waitFor(() => expect(document.body.textContent).toContain('From The Extension'), { timeout: 3000 })
    expect(readerCalls()).toHaveLength(0)
  })

  it('KNOWN-POSITIVE for that assertion: with no extension the SAME spy is called', async () => {
    // Without this, `toHaveLength(0)` above would pass just as well against a spy that can never
    // see anything — which is precisely how the dead-code state went unnoticed for a whole merge.
    mount()
    await waitFor(() => expect(readerCalls().length).toBeGreaterThan(0), { timeout: 3000 })
    expect(document.body.textContent).toContain('server text')
  })

  it('says WHICH connection fetched it — the claim is rendered, not implied', async () => {
    removeExt = installFakeExtension({ canFetch: true })
    mount()
    await waitFor(() => expect(document.body.textContent).toContain('your connection'), { timeout: 3000 })
    // And the stronger privacy sentence is only made on the path that earns it.
    expect(document.body.textContent).toContain('server was not involved')
  })

  it('…and says the opposite, just as plainly, when our server did the fetching', async () => {
    mount()
    await waitFor(() => expect(document.body.textContent).toContain('Inkwave’s server'), { timeout: 3000 })
    expect(document.body.textContent).not.toContain('server was not involved')
  })

  it('an installed-but-unpermitted extension is OFFERED the grant, not silently ignored', async () => {
    removeExt = installFakeExtension({ canFetch: false })
    mount()
    // It still reads the page — through the server — and it says the permission is one click away.
    await waitFor(() => expect(document.body.textContent).toContain('use my connection'), { timeout: 3000 })
    expect(readerCalls().length).toBeGreaterThan(0)
  })
})
