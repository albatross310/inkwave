// THE SOURCE READER'S SERVER HALF — fetch a web page and return it as STRUCTURED BLOCKS.
//
// Peter, 2026-08-28: "let's build a browser inside our app like ChatGPT does", after being told the
// iframe reader could show a page but never see a selection inside it (cross-origin). That is true
// of an iframe and only of an iframe: to select a heading and cite it, the page has to be in OUR
// document, which means WE have to fetch it, because the sources that matter (plato.stanford.edu,
// checked) send no Access-Control-Allow-Origin and the browser will not.
//
// ⚠ THE PRIVACY COST IS REAL AND IT IS THE POINT OF THIS COMMENT. This repo deleted its last such
// relay on purpose (2026-07-08: `api/pdf.mjs?proxy=` was "the one PDF path through our server").
// This one is back by an explicit decision, so it is built to give away as little as a fetching
// proxy can:
//   • it LOGS NOTHING — no url, no ip, no body, no timing (the api/ots.mjs rule);
//   • it is STATELESS and caches nothing — no store, so nothing to subpoena or leak later;
//   • it forwards NO identity — no cookies, no auth, no referer, no client IP;
//   • it returns TEXT ONLY, so no request for an image, font or tracker is ever made on the
//     reader's behalf, by us or by their browser.
// What it unavoidably sees is the URL, for the instant it takes to fetch it. The UI says so.
//
// ⚠ AND THE REASON IT RETURNS BLOCKS RATHER THAN HTML. The client renders this into ITS OWN
// document, in an origin holding the writer's thesis, their OPFS archive and their signing session.
// A sanitiser is a filter, and a filter has bugs. So no HTML string ever crosses: the client gets a
// tree of {kind, text, href} and renders React elements from it. There is no innerHTML anywhere in
// the path, which makes injection UNREPRESENTABLE rather than merely filtered — the distinction
// this codebase keeps making about illegal states.

import { extractBlocks } from '../src/reader/extract.mjs'
import dns from 'node:dns/promises'
import net from 'node:net'

const MAX_BYTES = 4_000_000     // a very long article is ~1MB of HTML; past this something is wrong
const MAX_REDIRECTS = 4
const FETCH_TIMEOUT_MS = 12_000
const UA = 'Mozilla/5.0 (compatible; InkwaveReader/1.0; +https://inkwave.studio)'

// ── SSRF ────────────────────────────────────────────────────────────────────────────────────────
// A server that fetches a URL the caller chose is a server that can be pointed at the inside of its
// own network. Literal-address checks alone are not enough (a hostname can RESOLVE to 127.0.0.1),
// so the host is resolved and EVERY answer is checked; and because a redirect is a second URL
// chosen by someone else, every hop is re-checked rather than trusting the first.

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)          // link-local: the cloud metadata endpoint lives here
      || (a === 100 && b >= 64 && b <= 127) // carrier NAT
      || a >= 224                           // multicast / reserved
  }
  const v = ip.toLowerCase()
  if (v === '::' || v === '::1') return true
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true
  // IPv4-mapped (::ffff:127.0.0.1) — check the embedded address, not the wrapper.
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  return m ? isPrivateIp(m[1]) : false
}

const BLOCKED_HOST = /(^|\.)(localhost|local|internal|localdomain|home|lan)$/i

export async function assertSafeUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { throw new Error('bad url') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad url')
  if (u.username || u.password) throw new Error('bad url')       // creds in a URL are never ours to forward
  if (BLOCKED_HOST.test(u.hostname)) throw new Error('blocked host')
  if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) throw new Error('blocked host')
  // A NAME can resolve inward — this is the check the literal test cannot do.
  try {
    const addrs = await dns.lookup(u.hostname, { all: true })
    if (!addrs.length) throw new Error('blocked host')
    for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('blocked host')
  } catch (e) {
    if (e?.message === 'blocked host') throw e
    throw new Error('unreachable')                                // NXDOMAIN etc. — never "allow on error"
  }
  return u
}

/** Fetch with manual redirect handling so every hop passes assertSafeUrl. */
async function fetchChecked(url) {
  let current = await assertSafeUrl(url)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' },
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error('bad redirect')
      current = await assertSafeUrl(new URL(loc, current).toString())
      continue
    }
    if (!res.ok) throw new Error(`http ${res.status}`)
    const ctype = res.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml/i.test(ctype)) throw new Error('not html')
    // Cap by READING, not by trusting content-length (which a server may omit or lie about).
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) throw new Error('too large')
    const charset = (/charset=([\w-]+)/i.exec(ctype) || [])[1] || 'utf-8'
    let text
    try { text = new TextDecoder(charset).decode(buf) } catch { text = new TextDecoder('utf-8').decode(buf) }
    return { finalUrl: current.toString(), html: text }
  }
  throw new Error('too many redirects')
}

/** The whole endpoint, in one function so the dev middleware and the Vercel handler share it. */
export async function readSource(url) {
  const { finalUrl, html } = await fetchChecked(url)
  const { title, blocks } = extractBlocks(html, finalUrl)
  if (!blocks.length) throw new Error('no readable text')
  return { url: finalUrl, title, blocks }
}


// ── CAN THIS PAGE BE SHOWN IN A FRAME? ───────────────────────────────────────────────────────────
// ⚠ THE BROWSER CANNOT TELL YOU, AND `onLoad` LIES. A refused frame fires `load` — on Chrome's own
// "refused to connect" error page — so the obvious client-side detector (a deadline cancelled by
// onLoad) never fires, which is exactly why Peter kept seeing the grey broken-page icon after that
// detector was written. `contentWindow` and `contentDocument` throw identically for a real
// cross-origin document and for the error page, so nothing in the page discriminates.
//
// The headers do, and only the server can read them. This asks for them and nothing else: no body
// is parsed, nothing is stored, nothing is logged — the same posture as readSource above.
export async function checkFramable(url) {
  const u = await assertSafeUrl(url)
  const res = await fetch(u.toString(), {
    method: 'GET',                       // some hosts answer HEAD differently (or not at all)
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
  })
  const xfo = (res.headers.get('x-frame-options') || '').toLowerCase()
  const csp = (res.headers.get('content-security-policy') || '').toLowerCase()
  const fa = /frame-ancestors\s+([^;]*)/.exec(csp)?.[1]?.trim()
  // DENY / SAMEORIGIN both refuse us; ALLOW-FROM is obsolete and unreliable, so treat it as refusal.
  if (xfo.includes('deny') || xfo.includes('sameorigin') || xfo.includes('allow-from')) {
    return { framable: false, reason: `x-frame-options: ${xfo}` }
  }
  // frame-ancestors 'none'/'self', or any list that cannot include us. A wildcard or an https: source
  // may permit us; we do not try to match our own origin here — over-refusing would hide pages that
  // work, so only the unambiguous refusals count.
  if (fa !== undefined && !/[*]|https:(?!\/)/.test(fa)) {
    return { framable: false, reason: `frame-ancestors ${fa}` }
  }
  return { framable: true }
}
