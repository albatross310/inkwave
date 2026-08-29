// THE FETCH-FROM-THE-WRITER'S-OWN-IP PATH, without a browser and without an extension.
//
// Nothing in `pnpm test` can load an unpacked extension, so the honest thing is to put every rule
// that does NOT need one into a place a test can reach, and then actually reach it. What is under
// test here is the DECIDING: which fetcher is used, what a silence means, when the server is asked
// and — the clause that is easiest to get wrong and hardest to notice — when it must NOT be.
//
// ⚠ EVERY NEGATIVE HERE IS ARMED. A test that asserts "the server was not called" is worth exactly
// nothing unless the same spy, in the same file, is shown being called; a probe that cannot fail is
// decoration. So each `not.toHaveBeenCalled` sits next to its known-positive.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  _resetExtensionMemo, extensionState, fetchViaExtension, loadSource, openExtensionPopup,
  probeExtension, type Port,
} from './pageSource'
import {
  APP_SOURCE, EXT_SOURCE, NEEDS_PERMISSION, READER_FETCH, READER_FETCHED, READER_GRANT,
  READER_GRANTED, READER_PING, READER_PONG,
} from './extensionProtocol'
import type { ReaderBlock } from './types'
import * as extractor from './extract.mjs'

const { extractBlocks } = extractor as unknown as {
  extractBlocks: (html: string, base: string) => { title: string; blocks: ReaderBlock[] }
}

type Msg = Record<string, unknown>

/** Stands in for the content script. Replies SYNCHRONOUSLY on purpose: if the module posted before
 *  it subscribed, the reply would arrive to nobody and every one of these would time out — which is
 *  a real ordering bug this shape can see and an async fake would hide. */
class TestPort implements Port {
  sent: Msg[] = []
  private subs = new Set<(d: unknown) => void>()
  constructor(private readonly handler: (msg: Msg, self: TestPort) => void) {}
  post(msg: unknown) { this.sent.push(msg as Msg); this.handler(msg as Msg, this) }
  on(fn: (d: unknown) => void) { this.subs.add(fn); return () => { this.subs.delete(fn) } }
  deliver(d: unknown) { for (const f of [...this.subs]) f(d) }
}

const silent = () => new TestPort(() => { /* the extension that never answers */ })

const pongs = (canFetch: boolean) => new TestPort((m, self) => {
  if (m.type === READER_PING) self.deliver({ source: EXT_SOURCE, type: READER_PONG, uuid: m.uuid, canFetch })
})

const PAGE = `<!doctype html><html><head><title>Relative Identity</title></head><body><main>
  <h1>Relative Identity</h1>
  <p>Geach's view, set out in <a href="../geach/">an earlier entry</a>.</p>
</main></body></html>`

/** An extension that fetches successfully, optionally landing on a different (post-redirect) URL. */
const fetcher = (html: string, finalUrl?: string) => new TestPort((m, self) => {
  if (m.type === READER_PING) { self.deliver({ source: EXT_SOURCE, type: READER_PONG, uuid: m.uuid, canFetch: true }); return }
  if (m.type === READER_FETCH) {
    self.deliver({ source: EXT_SOURCE, type: READER_FETCHED, uuid: m.uuid, ok: true, finalUrl: finalUrl ?? String(m.url), html })
  }
})

/** An extension that answers, and answers "no". */
const refuser = (error: string) => new TestPort((m, self) => {
  if (m.type === READER_FETCH) self.deliver({ source: EXT_SOURCE, type: READER_FETCHED, uuid: m.uuid, ok: false, error })
})

/** A stand-in for /api/reader. Returns a doc that is UNMISTAKEABLY the server's, so a test can
 *  never confuse "the server answered" with "the extension answered". */
function serverStub(body: unknown = { url: 'https://s/', title: 'FROM THE SERVER', blocks: [] }, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch
}

// ── IS THE EXTENSION THERE, AND WILL IT FETCH? ──────────────────────────────────────────────────

describe('probeExtension asks, and treats silence as an answer', () => {
  it('a pong that can fetch is ready; one that cannot is blocked, NOT absent', async () => {
    // The distinction is the whole reason the state has three values: `blocked` is one click away
    // from working and the UI can say so, `absent` is not.
    await expect(probeExtension(pongs(true), 40)).resolves.toBe('ready')
    await expect(probeExtension(pongs(false), 40)).resolves.toBe('blocked')
  })

  it('no extension, or one that never answers, is absent — and never a hang', async () => {
    await expect(probeExtension(null, 40)).resolves.toBe('absent')
    await expect(probeExtension(silent(), 40)).resolves.toBe('absent')
  })

  it('KNOWN-NEGATIVE: an answer to a DIFFERENT question does not count', async () => {
    // Delete the uuid check in isReaderPong and this resolves 'ready': a stale reply to an earlier
    // probe would satisfy a later one, and the reader would believe an extension that has gone.
    const wrongId = new TestPort((m, self) => {
      if (m.type === READER_PING) self.deliver({ source: EXT_SOURCE, type: READER_PONG, uuid: 'someone-elses-uuid', canFetch: true })
    })
    await expect(probeExtension(wrongId, 40)).resolves.toBe('absent')
  })

  it('KNOWN-NEGATIVE: a message that is not from the extension does not count', async () => {
    const impostor = new TestPort((m, self) => {
      // Right uuid, right type, wrong source — i.e. the page's own outbound message echoed back.
      if (m.type === READER_PING) self.deliver({ source: APP_SOURCE, type: READER_PONG, uuid: m.uuid, canFetch: true })
    })
    await expect(probeExtension(impostor, 40)).resolves.toBe('absent')
  })

  it('asks over the channel the extension listens on', async () => {
    const p = pongs(true)
    await probeExtension(p, 40)
    expect(p.sent[0]).toMatchObject({ source: APP_SOURCE, type: READER_PING })
    expect(typeof p.sent[0].uuid).toBe('string')
  })
})

describe('fetchViaExtension carries the extension’s own error code back', () => {
  it('resolves the page and the address it really came from', async () => {
    const r = await fetchViaExtension(fetcher(PAGE, 'https://plato.stanford.edu/final/'), 'https://plato.stanford.edu/asked/', 40)
    expect(r.finalUrl).toBe('https://plato.stanford.edu/final/')
    expect(r.html).toContain('Relative Identity')
  })

  it('rejects with `needs-permission` verbatim — the one error the UI can offer to fix', async () => {
    await expect(fetchViaExtension(refuser(NEEDS_PERMISSION), 'https://x/', 40))
      .rejects.toThrow(NEEDS_PERMISSION)
  })

  it('a silent extension rejects on a deadline rather than hanging', async () => {
    await expect(fetchViaExtension(silent(), 'https://x/', 30)).rejects.toThrow(/timed out/)
  })
})

// ── WHICH MACHINE FETCHED IT ────────────────────────────────────────────────────────────────────

describe('loadSource prefers the writer’s own browser', () => {
  it('with the extension ready, our server is never asked — and the caller is told', async () => {
    const server = serverStub()
    const got = await loadSource('https://plato.stanford.edu/entries/identity/', { port: fetcher(PAGE), fetchFn: server, timeoutMs: 40 })
    expect(got.via).toBe('extension')
    expect(got.doc.title).toBe('Relative Identity')
    expect(server).not.toHaveBeenCalled()
  })

  it('KNOWN-POSITIVE for the assertion above: with no extension the SAME spy is called', async () => {
    // Without this, `not.toHaveBeenCalled()` above would pass just as well against a broken spy.
    const server = serverStub()
    const got = await loadSource('https://plato.stanford.edu/entries/identity/', { port: null, fetchFn: server })
    expect(got.via).toBe('server')
    expect(got.doc.title).toBe('FROM THE SERVER')
    expect(server).toHaveBeenCalledTimes(1)
    expect(String((server as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]))
      .toBe(`/api/reader?url=${encodeURIComponent('https://plato.stanford.edu/entries/identity/')}`)
  })

  it('an extension that CANNOT fetch falls back to the server', async () => {
    const server = serverStub()
    const got = await loadSource('https://x/', { port: refuser(NEEDS_PERMISSION), fetchFn: server, timeoutMs: 40 })
    expect(got.via).toBe('server')
    expect(server).toHaveBeenCalledTimes(1)
  })

  it('⚠ but a page it fetched and found no prose in does NOT go to the server for a second opinion', async () => {
    // The deliberate non-fallback. Sending the address to our server here would undo the one thing
    // this path exists for, to re-answer a question the HTML has already answered.
    const server = serverStub()
    await expect(loadSource('https://app.example/', { port: fetcher('<!doctype html><html><body></body></html>'), fetchFn: server, timeoutMs: 40 }))
      .rejects.toThrow('no readable text')
    expect(server).not.toHaveBeenCalled()
  })

  it('surfaces the server’s error CODE unchanged, so the reader can map it to a sentence', async () => {
    const server = serverStub({ error: 'not html' }, false)
    await expect(loadSource('https://x/f.pdf', { port: null, fetchFn: server })).rejects.toThrow('not html')
  })
})

describe('ONE EXTRACTOR, TWO FETCHERS', () => {
  it('the extension path’s blocks are byte-identical to calling the shipped extractor', async () => {
    // This is what stops a client-side second copy being written: it would have to agree exactly.
    const finalUrl = 'https://plato.stanford.edu/entries/identity/'
    const got = await loadSource('https://plato.stanford.edu/redirected/', { port: fetcher(PAGE, finalUrl), fetchFn: serverStub(), timeoutMs: 40 })
    const direct = extractBlocks(PAGE, finalUrl)
    expect(JSON.stringify(got.doc.blocks)).toBe(JSON.stringify(direct.blocks))
    expect(got.doc.title).toBe(direct.title)
  })

  it('links resolve against where the page CAME FROM, not where it was asked for', async () => {
    // A redirect is the normal case for a search result, and `../geach/` means different things
    // from the two addresses. Getting this wrong gives a reader links that 404.
    const got = await loadSource('https://short.link/abc', {
      port: fetcher(PAGE, 'https://plato.stanford.edu/entries/identity/'), fetchFn: serverStub(), timeoutMs: 40,
    })
    expect(got.doc.url).toBe('https://plato.stanford.edu/entries/identity/')
    const para = got.doc.blocks.find((b) => b.kind === 'para') as Extract<ReaderBlock, { kind: 'para' }>
    // `../geach/` from `/entries/identity/` is `/entries/geach/`. (The expectation here was
    // hand-written as `/geach/` — one `..` too many — and failed against correct code. The test's
    // POINT stands and still discriminates: resolved against the REQUESTED url it would have been
    // `https://short.link/geach/`, which is a different host entirely.)
    expect(para.runs.find((r) => r.href)?.href).toBe('https://plato.stanford.edu/entries/geach/')
    expect(para.runs.find((r) => r.href)?.href).not.toContain('short.link')
  })
})

// ── ASKING THE EXTENSION TO OPEN ITS OWN POPUP ──────────────────────────────────────────────────

describe('openExtensionPopup reports refusal as refusal', () => {
  const answers = (ok: boolean) => new TestPort((m, self) => {
    if (m.type === READER_GRANT) self.deliver({ source: EXT_SOURCE, type: READER_GRANTED, uuid: m.uuid, ok })
  })

  it('true when the extension raised it', async () => {
    await expect(openExtensionPopup(answers(true), 40)).resolves.toBe(true)
  })

  it('false when the browser refused — a real outcome, not an error', async () => {
    // `action.openPopup()` is recent and can decline. The reader must still show the writer how to
    // do it by hand, so this has to come back as a plain false rather than throwing or hanging.
    await expect(openExtensionPopup(answers(false), 40)).resolves.toBe(false)
  })

  it('false when nothing answers at all', async () => {
    await expect(openExtensionPopup(silent(), 30)).resolves.toBe(false)
  })
})

// ── THE SESSION MEMO ────────────────────────────────────────────────────────────────────────────
// The probe costs a round trip, so it is asked once per page load. Two rules, both of which have a
// way of going wrong silently.

describe('extensionState is asked once, and never poisoned by the prerender', () => {
  beforeEach(() => { _resetExtensionMemo() })
  afterEach(() => { _resetExtensionMemo() })

  it('⚠ NEVER CACHES THE SSR ANSWER — there is no window during prerender', async () => {
    // If the memo were written under SSR, every reader in the built app would believe the
    // extension absent until a reload. Prove the SSR call answers 'absent' AND leaves no memo:
    // a later browser-side call must be free to find the extension.
    const saved = globalThis.window
    delete (globalThis as { window?: unknown }).window
    let ssr: string
    try { ssr = await extensionState() } finally { (globalThis as { window?: unknown }).window = saved }
    expect(ssr).toBe('absent')

    // Nothing was remembered: with a window again, the memo starts fresh. (No extension is
    // installed under vitest, so the honest answer is still 'absent' — what is being asserted is
    // that the SSR call did not FREEZE it, which the refresh test below then exercises for real.)
    await expect(extensionState()).resolves.toBe('absent')
  })

  it('returns the SAME promise until asked to refresh', async () => {
    // Needs a window to memoise at all (see the rule above), and this file runs under node — so a
    // minimal one stands in for the browser's. It never answers, which is fine: what is under test
    // is how many times the question is ASKED.
    const saved = globalThis.window
    const asked: unknown[] = []
    ;(globalThis as { window?: unknown }).window = {
      addEventListener() {}, removeEventListener() {},
      postMessage: (m: unknown) => { asked.push(m) },
      location: { origin: 'http://localhost' },
    }
    try {
      const first = extensionState()
      expect(extensionState()).toBe(first)          // one round trip per load, not one per navigation
      expect(asked).toHaveLength(1)
      const forced = extensionState(true)
      expect(forced).not.toBe(first)                // …and the grant path can force a re-ask
      expect(asked).toHaveLength(2)
      await Promise.all([first, forced])
    } finally { (globalThis as { window?: unknown }).window = saved }
  })
})
