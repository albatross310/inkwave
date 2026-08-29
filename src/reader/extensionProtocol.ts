// THE READER↔EXTENSION WIRE, DECLARED ONCE.
//
// Peter, 2026-08-28: "is it possible for us to run the window from the user's IP?" — yes, and this
// is the seam. The source reader's fetch can happen in the WRITER'S OWN BROWSER, through the
// extension this repo already ships, instead of in a Vercel function. MEASURED reason it matters:
// against the DEPLOYED endpoint duckduckgo / lite-ddg / mojeek answer "fetch failed", searx.be
// answers "Verifying your browser…", priv.au a captcha, marginalia 5 blocks and zero links —
// while wikipedia and plato.stanford.edu are served normally. Search engines serve people, not
// data centres. The extension is a person's browser, so it is served.
//
// ⚠ ONE CHANNEL, NOT A SECOND ONE. The bridge already exists: the app talks to
// extension-src/entrypoints/content-inkwave.ts with window.postMessage (citations/extensionChannel.ts
// is the other end of it), and that content script talks to the background worker with
// runtime.sendMessage. `cite/visitSource` → `inkwave:watchPanel` is the precedent this follows
// verbatim. A parallel port would be a second thing to keep in sync with the first.
//
// ⚠ AND THE NAMES LIVE HERE, IN src/, BECAUSE THE EXTENSION IMPORTS FROM src/ AND NEVER THE
// REVERSE (the `@inkwave/citations` alias in extension-src/wxt.config.ts). A copy of these strings
// on the extension side is how a rename becomes a feature that silently stops answering — which,
// on this channel, is indistinguishable from the extension not being installed.

/** Messages the extension's content script posts INTO the page. */
export const EXT_SOURCE = 'inkwave-ext'
/** Messages the page posts OUT, for the content script to relay. */
export const APP_SOURCE = 'inkwave-app'

// page ↔ content script
export const READER_PING = 'reader/ping'
export const READER_PONG = 'reader/pong'
export const READER_FETCH = 'reader/fetch'
export const READER_FETCHED = 'reader/fetched'

// content script ↔ background worker
export const BG_READER_STATUS = 'inkwave:readerStatus'
export const BG_FETCH_PAGE = 'inkwave:fetchPage'

/** What the background worker knows about its own ability to fetch an arbitrary page. */
export interface ReaderStatus {
  /** `<all_urls>` actually granted — see the optional-permission note in wxt.config.ts. */
  canFetch: boolean
}

/** The background worker's answer to one fetch. `finalUrl` is post-redirect, so relative links in
 *  the extracted blocks resolve against where the page really came from. */
export type FetchPageResult =
  | { ok: true; finalUrl: string; html: string }
  | { ok: false; error: string }

/** The one error the UI must ACT on rather than merely report: the extension is installed but has
 *  not been granted permission to fetch, which one click in its popup fixes. Everything else on
 *  this path is an ordinary failure and falls back to the server. */
export const NEEDS_PERMISSION = 'needs-permission'

/** Bytes past which the extension refuses to hand a page over. The server core caps at 4MB; this is
 *  lower because every byte crosses runtime.sendMessage AND window.postMessage as a JSON string, and
 *  a page that large has no article in it anyway. */
export const EXT_MAX_BYTES = 2_000_000

// ── SHAPE GUARDS ────────────────────────────────────────────────────────────────────────────────
// The page listens on `window`, so anything in this origin could post one of these. That is the
// same trust boundary citations/extensionChannel.ts already sits on, and it is not the interesting
// one: a script running in this origin already holds the writer's thesis and their signing session.
// What these guards are actually for is the ordinary case — a message from some other library that
// happens to share a field name must never be read as an answer to OUR question, and an answer to
// an EARLIER question must never satisfy a later one (hence the uuid, checked here and not by the
// caller).

function isRecord(d: unknown): d is Record<string, unknown> {
  return !!d && typeof d === 'object'
}

export function isReaderPong(d: unknown, uuid: string): d is { canFetch: boolean } {
  return isRecord(d) && d.source === EXT_SOURCE && d.type === READER_PONG
    && d.uuid === uuid && typeof d.canFetch === 'boolean'
}

export function isReaderFetched(d: unknown, uuid: string): d is FetchPageResult & { uuid: string } {
  if (!isRecord(d) || d.source !== EXT_SOURCE || d.type !== READER_FETCHED || d.uuid !== uuid) return false
  if (d.ok === true) return typeof d.finalUrl === 'string' && typeof d.html === 'string'
  return d.ok === false && typeof d.error === 'string'
}
