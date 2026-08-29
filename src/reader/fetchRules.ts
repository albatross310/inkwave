// THE RULES THE EXTENSION'S FETCH OBEYS — pure, so they can be tested in the gate.
//
// The fetch itself happens in extension-src/entrypoints/background.ts, which nothing in `pnpm test`
// can reach (vitest includes `src/**` only, and no test runner here can load an unpacked
// extension). So everything about that fetch which can be decided WITHOUT a network lives here
// instead, and the background worker is left holding one `fetch` call. A rule that only exists in
// a file no test can import is a rule nobody will notice breaking.
//
// ⚠ THIS IS NOT THE SERVER'S SSRF GUARD, AND IT DELIBERATELY DOES NOT COPY IT.
// api/_reader-core.mjs resolves every hostname and refuses private addresses, because a SERVER that
// fetches a caller's URL sits inside a privileged network — 169.254.169.254 is a cloud metadata
// endpoint and nothing else. The extension sits in the writer's own browser on the writer's own
// network, where 192.168.x.x is their router and localhost is the docs server they are reading;
// fetching those is precisely what typing the address into the URL bar already does, and refusing
// them would break a real use for no gain. What DOES carry over is the part that is about the
// request rather than the network: only http(s), and never credentials embedded in a URL.
//
// Considered and accepted: a link INSIDE a fetched page is chosen by the publisher, not the writer,
// and following one in the panel issues a GET from the writer's machine. That is the same thing
// clicking a link in any browser does — it is the web's own bargain, not something this path adds.
// What this path must never do is EXECUTE what comes back, and it does not: the reply is turned
// into {kind, text, href} blocks by the shared extractor and no markup ever reaches the renderer.

import { EXT_MAX_BYTES } from './extensionProtocol'

/** Everything wrong with a URL that can be seen without asking the network. Throws the short code
 *  the reader's error map already speaks, never a sentence. */
export function assertFetchable(raw: string): URL {
  let u: URL
  try { u = new URL(String(raw)) } catch { throw new Error('bad url') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad url')
  // Credentials in a URL are never ours to forward — the server core's rule, for the same reason.
  if (u.username || u.password) throw new Error('bad url')
  return u
}

/**
 * ⚠ NO USER-AGENT HERE, ON PURPOSE, AND IT IS THE POINT OF THE WHOLE FEATURE.
 * The server core sends `InkwaveReader/1.0`; this sends nothing, so the browser sends its own real
 * one. A request that looks like a person is the difference between DuckDuckGo answering and
 * DuckDuckGo refusing. Setting a header here would hand back the exact thing we came for.
 */
export const READER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

/** True when a content-type is a page we can extract prose from. A PDF, an image or a JSON API is
 *  not an error to be dressed up — the reader has a separate answer for a PDF. */
export function isHtmlContentType(ctype: string | null | undefined): boolean {
  return /text\/html|application\/xhtml/i.test(ctype || '')
}

/** The charset the server declared, defaulted rather than guessed. */
export function charsetOf(ctype: string | null | undefined): string {
  return (/charset=([\w-]+)/i.exec(ctype || '') || [])[1] || 'utf-8'
}

/**
 * Bytes → HTML text, with the two refusals that must happen after the body arrives.
 * The size cap is applied by MEASURING, never by trusting a content-length header a server may
 * omit or lie about — the server core's rule, kept identical here so a page that is "too large"
 * means the same thing on both paths.
 */
export function decodeHtml(buf: ArrayBuffer, ctype: string | null | undefined, maxBytes = EXT_MAX_BYTES): string {
  if (!isHtmlContentType(ctype)) throw new Error('not html')
  if (buf.byteLength > maxBytes) throw new Error('too large')
  const charset = charsetOf(ctype)
  try { return new TextDecoder(charset).decode(buf) } catch { return new TextDecoder('utf-8').decode(buf) }
}
