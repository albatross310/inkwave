// THE READER↔EXTENSION WIRE, DECLARED ONCE — so the source reader's fetch can happen in the
// WRITER'S OWN BROWSER instead of a Vercel function.
//
// ⚠ ONE CHANNEL, NOT A SECOND ONE. The bridge already exists (window.postMessage to
// content-inkwave.ts, then runtime.sendMessage to the worker); `cite/visitSource` is the precedent
// this follows verbatim. A parallel port is a second thing to keep in sync with the first.
//
// ⚠ AND THE NAMES LIVE HERE, IN src/, BECAUSE THE EXTENSION IMPORTS FROM src/ AND NEVER THE REVERSE.
// A copy of these strings on the extension side is how a rename becomes a feature that silently
// stops answering — which, on this channel, is indistinguishable from "not installed".
// → docs/archive/reader-panels.md#extensionprotocol

/** Messages the extension's content script posts INTO the page. */
export const EXT_SOURCE = 'inkwave-ext'
/** Messages the page posts OUT, for the content script to relay. */
export const APP_SOURCE = 'inkwave-app'

// page ↔ content script
export const READER_PING = 'reader/ping'
export const READER_PONG = 'reader/pong'
export const READER_FETCH = 'reader/fetch'
export const READER_FETCHED = 'reader/fetched'
export const READER_GRANT = 'reader/grant'
export const READER_GRANTED = 'reader/granted'

// content script ↔ background worker
export const BG_READER_STATUS = 'inkwave:readerStatus'
export const BG_FETCH_PAGE = 'inkwave:fetchPage'
export const BG_OPEN_POPUP = 'inkwave:openReaderPopup'

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

/** The one error the UI must ACT on rather than merely report: installed but not granted permission
 *  to fetch, which one click in its popup fixes. Everything else here is an ordinary failure and
 *  falls back to the server. */
export const NEEDS_PERMISSION = 'needs-permission'

/** Bytes past which the extension refuses to hand a page over. The server core caps at 4MB; this is
 *  lower because every byte crosses runtime.sendMessage AND window.postMessage as a JSON string, and
 *  a page that large has no article in it anyway. */
export const EXT_MAX_BYTES = 2_000_000

// ── SHAPE GUARDS ────────────────────────────────────────────────────────────────────────────────
// NOT a trust boundary — a script in this origin already holds the thesis and the signing session.
// They are for the ordinary case: a message from another library that shares a field name must never
// read as an answer to OUR question, and an answer to an EARLIER question must never satisfy a later
// one (hence the uuid, checked here rather than by the caller).
// → docs/archive/reader-panels.md#ep-shape-guards

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

/**
 * ⚠ THE GRANT CANNOT HAPPEN IN THE APP, AND NO AMOUNT OF UI HERE CHANGES THAT.
 * `permissions.request()` is honoured only from a gesture inside an EXTENSION PAGE. So the most the
 * reader can do is ask the extension to open its own popup — and `ok:false` is an ordinary answer,
 * so the UI must carry the manual instruction rather than depending on this.
 * → docs/archive/reader-panels.md#ep-grant
 */
export function isReaderGranted(d: unknown, uuid: string): d is { ok: boolean } {
  return isRecord(d) && d.source === EXT_SOURCE && d.type === READER_GRANTED
    && d.uuid === uuid && typeof d.ok === 'boolean'
}

// ── LIVE VIEW: LETTING A PAGE BE FRAMED AT ALL ──────────────────────────────────────────────────
// `X-Frame-Options` and `frame-ancestors` are enforced by the BROWSER, so no web app can opt out of
// another site's refusal; an extension can, by removing them before the browser reads them.
//
// ⚠ AND THE HONEST HALF: `SameSite=Lax` (the default) and `Strict` are BOTH dropped in a third-party
// frame, so a logged-in site frames and renders SIGNED OUT — the browser's own rule, not a header.
// The UI must SAY this, because a signed-out page with no explanation reads as Inkwave being broken.
//
// ⚠ SCOPED, NEVER A STANDING RULESET — removing framing protection browser-wide makes every site the
// writer visits clickjackable. The rule is SESSION-scoped, `initiatorDomains`-restricted to our own
// origins so it can only apply to a frame THIS APP created, and `sub_frame` only. A rule that
// outlives the panel is the bug this shape exists to prevent.
// → docs/archive/reader-panels.md#ep-framing

// page ↔ content script
export const READER_FRAME = 'reader/frame'
export const READER_FRAMED = 'reader/framed'
export const READER_UNFRAME = 'reader/unframe'

// content script ↔ background worker
export const BG_ALLOW_FRAME = 'inkwave:allowFrame'
export const BG_CLEAR_FRAME = 'inkwave:clearFrame'

// The rule's own shape — and APP_INITIATORS — live in ./framingRule.ts, next to the scoping
// argument they exist to enforce. This file stays the WIRE: names and shape guards only.

/** ⚠ `ok:true` means a rule was INSTALLED, never that the page will render — a site can still refuse
 *  in its body, serve a CAPTCHA, or render signed out. Callers must not report success on this. */
export function isReaderFramed(d: unknown, uuid: string): d is { ok: boolean; error?: string } {
  return isRecord(d) && d.source === EXT_SOURCE && d.type === READER_FRAMED
    && d.uuid === uuid && typeof d.ok === 'boolean'
}

// ── FETCHING A FILE, NOT A PAGE ─────────────────────────────────────────────────────────────────
// ⚠ A SECOND MESSAGE, NOT A FLAG ON `reader/fetch`. That exchange is DEFINED to return text
// (`decodeHtml` throws `not html`), and widening it would make one message whose reply is sometimes
// a string and sometimes bytes. The separate pair keeps a page fetch STRUCTURALLY INCAPABLE of
// returning a binary blob.
//
// ⚠ AND THE BYTES ARE BASE64 because `runtime.sendMessage` serialises as JSON, not structured clone.
// Decode with `base64ToBlob` (citations/pdfStore.ts) — never a hand-rolled atob loop, which was a
// 20M-iteration main-thread stall the last time somebody wrote one.
// → docs/archive/reader-panels.md#ep-file-message

// page ↔ content script
export const READER_FILE = 'reader/file'
export const READER_FILED = 'reader/filed'
// content script ↔ background worker
export const BG_FETCH_FILE = 'inkwave:fetchFile'

/** One file, fetched by the extension. `mime` is what the SERVER said — kept for the record and for
 *  the diagnosis in a refusal, and never what decides whether the bytes are stored. */
export type FetchFileResult =
  | { ok: true; finalUrl: string; mime: string; size: number; b64: string }
  | { ok: false; error: string }

export function isReaderFiled(d: unknown, uuid: string): d is FetchFileResult & { uuid: string } {
  if (!isRecord(d) || d.source !== EXT_SOURCE || d.type !== READER_FILED || d.uuid !== uuid) return false
  if (d.ok === true) {
    return typeof d.finalUrl === 'string' && typeof d.mime === 'string'
      && typeof d.size === 'number' && typeof d.b64 === 'string'
  }
  return d.ok === false && typeof d.error === 'string'
}
