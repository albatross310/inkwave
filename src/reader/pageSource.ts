// WHERE THE SOURCE READER'S FETCH ACTUALLY HAPPENS — the writer's own browser first, our server
// second.
//
// Peter, 2026-08-28: "is it possible for us to run the window from the user's IP?" The reason the
// question came up is MEASURED and is not going to be argued away by tuning a user-agent string:
// against the DEPLOYED endpoint, duckduckgo, lite-ddg and mojeek answer "fetch failed", searx.be
// answers "Verifying your browser…", priv.au serves a captcha and marginalia returns 5 blocks and
// ZERO links, while wikipedia and plato.stanford.edu are served normally. A search engine will
// serve a person and refuse a data centre. The extension IS a person's browser.
//
// ⚠ ONE EXTRACTOR, TWO FETCHERS. `extract.mjs` was split out of api/_reader-core.mjs for exactly
// this and is imported here — the same function turns HTML into blocks whichever machine fetched
// it. A client-side second copy would drift the first time either side was tuned, and both feed one
// renderer (the pmToText/textMap lesson, one directory along). `pageSource.test.ts` pins that the
// extension path's output is byte-identical to calling the extractor directly.
//
// ⚠ AND STILL NO HTML REACHES THE RENDERER. The extension hands back an HTML STRING — the one thing
// api/_reader-core.mjs's header says must never cross — and it is consumed HERE, in this module, by
// the extractor, which returns {kind, text, href}. Nothing downstream of `loadSource` has ever seen
// markup, so injection stays unrepresentable rather than filtered. The string does exist in this
// origin's memory for the length of one call; it is never assigned to innerHTML, never parsed by
// DOMParser, never inserted. (DOMParser would be the tempting "better" extractor and it is the one
// thing this must not become: `new DOMParser().parseFromString(html, 'text/html')` builds real
// elements — img src fires no request in a detached document today, but that is a browser
// behaviour, not a guarantee we control, and the tolerant scanner needs no such promise.)
//
// ⚠ WHAT THE EXTENSION PATH ACTUALLY BUYS, STATED PRECISELY, because the UI quotes this module:
//   • the request leaves the WRITER'S OWN ADDRESS, not a Vercel IP. That is Peter's question and it
//     is unambiguously true.
//   • our server never learns the URL, because it is not in the path at all. Strictly stronger than
//     the "sees the address for an instant, logs nothing" posture the server endpoint documents.
//   • cookies: an extension-worker fetch is cross-site by initiator, so a site's SameSite=Lax/Strict
//     cookies are NOT sent. Some session state travels, some does not, and which is the site's
//     choice. UNVERIFIED per-site, so the UI claims the ADDRESS and says nothing about being
//     signed in.

import type { ReaderBlock, ReaderDoc } from './types'
import {
  APP_SOURCE, NEEDS_PERMISSION, READER_FETCH, READER_FRAME, READER_GRANT, READER_PING,
  READER_UNFRAME,
  isReaderFetched, isReaderFramed, isReaderGranted, isReaderPong, type FetchPageResult,
} from './extensionProtocol'
// The SHIPPED extractor — the same module api/_reader-core.mjs imports. Untyped Node-free ESM, so
// the shape is asserted at the boundary here and nowhere else.
import * as extractor from './extract.mjs'

const { extractBlocks } = extractor as unknown as {
  extractBlocks: (html: string, base: string) => { title: string; blocks: ReaderBlock[] }
}

/** Which machine fetched the page the reader is looking at. Shown, never inferred. */
export type Via = 'extension' | 'server'

/**
 * What the extension can do for us right now.
 *   absent  — not installed, or installed and not answering (indistinguishable from here, and the
 *             UI says the same thing for both because the writer's remedy is the same).
 *   blocked — installed and answering, but it has not been granted permission to fetch pages. This
 *             is the state that must never be silently treated as `absent`: it is one click away
 *             from `ready` and the UI can say so.
 *   ready   — it will fetch.
 */
export type ExtensionState = 'absent' | 'blocked' | 'ready'

/** The window.postMessage bridge, as the two operations this module needs. Injected so the rules
 *  below can be tested without a browser or an extension — which, given nobody can load an
 *  unpacked extension inside `pnpm test`, is the difference between a guard and a hope. */
export interface Port {
  post(msg: unknown): void
  /** Subscribe to inbound messages; returns an unsubscribe. */
  on(fn: (data: unknown) => void): () => void
}

/** The real bridge. Only messages from THIS window and THIS origin are delivered — the same two
 *  checks citations/extensionChannel.ts makes, for the same reason. */
export function windowPort(): Port | null {
  if (typeof window === 'undefined') return null
  return {
    post: (msg) => window.postMessage(msg, window.location.origin),
    on: (fn) => {
      const h = (e: MessageEvent) => {
        if (e.source !== window || e.origin !== window.location.origin) return
        fn(e.data)
      }
      window.addEventListener('message', h)
      return () => window.removeEventListener('message', h)
    },
  }
}

function newId(): string {
  try { return crypto.randomUUID() } catch { return `r${Date.now()}${Math.random().toString(36).slice(2)}` }
}

/**
 * One request, one reply, correlated and deadlined — the shape all three exchanges below share.
 *
 * ⚠ ASK, DO NOT WAIT TO BE TOLD. An "the extension is here" announcement is a ONE-SHOT ASYNC SIGNAL
 * and this repo has the scar tissue: a listener attached after it fired waits for ever, silently,
 * and a feature that is merely disabled is indistinguishable from a feature nobody built. So the
 * page asks; `null` back means the deadline passed, which is an ANSWER and not a hang.
 *
 * The uuid is not decoration either: without it, a late reply to an EARLIER question satisfies a
 * later one, and the reader believes an extension that has since gone away.
 */
function ask<T>(
  port: Port,
  request: Record<string, unknown>,
  match: (d: unknown, uuid: string) => T | null,
  timeoutMs: number,
): Promise<T | null> {
  const uuid = newId()
  return new Promise<T | null>((resolve) => {
    let done = false
    const finish = (v: T | null) => { if (!done) { done = true; off(); clearTimeout(t); resolve(v) } }
    // Subscribe BEFORE posting: the content script may answer synchronously.
    const off = port.on((d) => { const hit = match(d, uuid); if (hit !== null) finish(hit) })
    const t = setTimeout(() => finish(null), timeoutMs)
    port.post({ ...request, source: APP_SOURCE, uuid })
  })
}

/** Ask the extension whether it is there and allowed to fetch. */
export async function probeExtension(port: Port | null, timeoutMs = 600): Promise<ExtensionState> {
  if (!port) return 'absent'
  const r = await ask<ExtensionState>(port, { type: READER_PING },
    (d, uuid) => (isReaderPong(d, uuid) ? (d.canFetch ? 'ready' : 'blocked') : null), timeoutMs)
  return r ?? 'absent'
}

/** One page, fetched by the extension. Rejects with the extension's own error CODE as the message
 *  (`needs-permission`, `not html`, `too large`, an http status…) so the caller can distinguish the
 *  one that is fixable from the ones that are not. */
export async function fetchViaExtension(port: Port, url: string, timeoutMs = 25_000): Promise<{ finalUrl: string; html: string }> {
  const r = await ask<FetchPageResult>(port, { type: READER_FETCH, url },
    (d, uuid) => (isReaderFetched(d, uuid) ? (d as FetchPageResult) : null), timeoutMs)
  if (!r) throw new Error('extension timed out')
  if (!r.ok) throw new Error(r.error)
  return { finalUrl: r.finalUrl, html: r.html }
}

/**
 * Ask the extension to open its own popup, where the permission button lives.
 *
 * Returns false when it could not — including when it did not answer at all — and the caller MUST
 * still show the writer how to do it by hand. `action.openPopup()` is a recent API and may simply
 * refuse; a button whose only fallback is silence is the dead button this reader has already been
 * bitten by twice.
 */
export async function openExtensionPopup(port: Port, timeoutMs = 3000): Promise<boolean> {
  const r = await ask<{ ok: boolean }>(port, { type: READER_GRANT },
    (d, uuid) => (isReaderGranted(d, uuid) ? { ok: d.ok } : null), timeoutMs)
  return !!r?.ok
}

/**
 * Ask the extension to let ONE page be framed, so live view can show a site that refuses framing.
 *
 * ⚠ TRUE MEANS A RULE WAS INSTALLED — IT DOES NOT MEAN THE PAGE WILL RENDER, and the caller must
 * not tell the writer otherwise. Measured in a real browser (docs/SEARCH-AND-THE-EXTENSION.md):
 * abc.net.au and youtube's own watch page render properly, facebook still refuses in its BODY where
 * there is no header to strip, google served a CAPTCHA, and ANY logged-in site renders SIGNED OUT
 * because `SameSite=Lax` — the default a cookie gets when it says nothing — is dropped in a
 * third-party frame. That last one is the browser's own rule and no header we remove touches it.
 */
export async function allowFramingVia(port: Port, url: string, timeoutMs = 3000): Promise<boolean> {
  const r = await ask<{ ok: boolean }>(port, { type: READER_FRAME, url },
    (d, uuid) => (isReaderFramed(d, uuid) ? { ok: d.ok } : null), timeoutMs)
  return !!r?.ok
}

/**
 * Release it. Fire-and-forget BY DESIGN: this runs from the panel's teardown, and on a tab close
 * there is no later turn in which an ack could arrive — waiting would make the common path the one
 * that never completes. The rule is session-scoped in the worker precisely so that a lost release
 * cannot leave framing open past the browser session.
 */
export function releaseFraming(port: Port | null): void {
  try { port?.post({ source: APP_SOURCE, type: READER_UNFRAME, uuid: newId() }) } catch { /* gone */ }
}

// ── THE SESSION'S ANSWER, ASKED ONCE ────────────────────────────────────────────────────────────
// The probe costs a round trip, and re-running it per navigation would put its deadline in front of
// every link the reader follows. So it is memoised for the page's lifetime — with two rules that
// are easy to get wrong and expensive to get wrong:
//   • NEVER CACHE THE SSR ANSWER. There is no window during prerender, so an eager module-scope
//     probe would bake 'absent' into the build's first paint and the extension would be invisible
//     until a reload. `typeof window === 'undefined'` returns without writing the memo.
//   • `refresh` EXISTS BECAUSE THE ANSWER CHANGES. Granting the permission happens in the
//     extension's popup, which cannot tell the page anything; the reader re-asks when the window
//     regains focus, which is exactly when the writer has come back from doing it.
let memo: Promise<ExtensionState> | null = null

export function extensionState(refresh = false): Promise<ExtensionState> {
  if (typeof window === 'undefined') return Promise.resolve('absent')
  if (!memo || refresh) memo = probeExtension(windowPort())
  return memo
}

/** Test-only: forget the memoised answer. Exported rather than reached into, so the memo can stay
 *  module-private and a test cannot accidentally depend on its shape. */
export function _resetExtensionMemo(): void { memo = null }

/** The server half, unchanged in behaviour from what SourceBrowser used to do inline: a short error
 *  CODE comes back and is re-thrown as-is, because the component maps codes to sentences. */
async function fetchViaServer(url: string, fetchFn: typeof fetch): Promise<ReaderDoc> {
  const r = await fetchFn(`/api/reader?url=${encodeURIComponent(url)}`)
  const j = await r.json().catch(() => ({ error: 'fetch failed' })) as Partial<ReaderDoc> & { error?: string }
  if (!r.ok || j.error) throw new Error(j.error || 'fetch failed')
  return j as ReaderDoc
}

export interface LoadOptions {
  /** Omit (or pass null) to go straight to the server — that is what `absent`/`blocked` mean. */
  port?: Port | null
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/**
 * Read a source page. Extension first, server second — and the caller is TOLD which happened,
 * because a privacy posture nobody can see is a privacy posture nobody has.
 *
 * ⚠ THE FALLBACK IS FOR A FAILED FETCH, NOT FOR A DISAPPOINTING PAGE. If the extension fetched the
 * page and the extractor found no prose in it, that IS the answer: falling back would send the
 * address to our server for a second opinion the writer did not ask for, on the one path whose
 * whole point is that our server is not in it. A JS-rendered app has no article in its HTML from
 * anyone's IP. The reader offers Live mode for that, as it already did.
 */
export async function loadSource(url: string, o: LoadOptions = {}): Promise<{ doc: ReaderDoc; via: Via }> {
  const fetchFn = o.fetchFn ?? fetch
  if (o.port) {
    let fetched: { finalUrl: string; html: string } | null = null
    try {
      fetched = await fetchViaExtension(o.port, url, o.timeoutMs)
    } catch {
      fetched = null       // could not fetch AT ALL — the server may still manage it
    }
    if (fetched) {
      const { title, blocks } = extractBlocks(fetched.html, fetched.finalUrl)
      if (!blocks.length) throw new Error('no readable text')
      return { doc: { url: fetched.finalUrl, title, blocks }, via: 'extension' }
    }
  }
  return { doc: await fetchViaServer(url, fetchFn), via: 'server' }
}

export { NEEDS_PERMISSION }
