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

// ── EXTRACTION ──────────────────────────────────────────────────────────────────────────────────
// A tolerant tag scanner, not a parser: we are not trying to be a browser, only to find the prose.
// Hand-rolled deliberately — this repo has no HTML parser and adding one to a serverless function
// for six element names is the dependency it has consistently declined (the charts precedent).

const DROP_SUBTREE = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'object',
  'embed', 'canvas', 'form', 'button', 'select', 'textarea', 'nav', 'aside', 'footer', 'figure'])
const BLOCK_END = new Set(['p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'tr', 'td', 'th', 'table', 'dd', 'dt', 'dl'])

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', deg: '°' }

export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const cp = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, g) ? ENTITIES[g] : m
  })
}

/** Attributes of one tag, lowercased names, entity-decoded values. */
function attrsOf(tag) {
  const out = {}
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  }
  return out
}

/** The narrowest subtree that plausibly holds the article, else the body, else everything. */
function contentSlice(html) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)
  const hay = body ? body[1] : html
  // Ordered by how strongly each signals "this is the article".
  const candidates = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<div\b[^>]*\bid\s*=\s*["']?(?:main-text|article|content|main-content|entry-content)["']?[^>]*>([\s\S]*)/i,
    /<[^>]+\brole\s*=\s*["']main["'][^>]*>([\s\S]*)/i,
  ]
  for (const re of candidates) {
    const m = re.exec(hay)
    // A candidate that captures almost nothing is a false positive (an empty <main> wrapper).
    if (m && m[1] && m[1].length > hay.length * 0.15) return m[1]
  }
  return hay
}

/**
 * html → { title, blocks }. Blocks are the ONLY thing the client ever sees.
 * `base` resolves relative hrefs so a link in the reader still points somewhere real.
 */
export function extractBlocks(html, base) {
  const titleRaw = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || ''
  const title = decodeEntities(titleRaw).replace(/\s+/g, ' ').trim()

  const src = contentSlice(html.replace(/<!--[\s\S]*?-->/g, ''))
  const blocks = []
  // Current open block: what kind it is and the runs collected so far.
  let cur = null                    // { kind, level?, runs: [] }
  let list = null                   // { ordered, items: [] } while inside ul/ol
  let drop = 0                      // depth inside a dropped subtree
  let dropTag = ''
  const fmt = { em: 0, strong: 0, code: 0 }
  let href = null
  let pre = 0

  const pushRun = (text) => {
    if (!text) return
    if (!cur) cur = { kind: 'para', runs: [] }
    const run = { text }
    if (fmt.em) run.em = true
    if (fmt.strong) run.strong = true
    if (fmt.code || pre) run.code = true
    if (href) run.href = href
    const last = cur.runs[cur.runs.length - 1]
    // Merge adjacent identical-format runs so a paragraph is a handful of runs, not hundreds.
    if (last && last.em === run.em && last.strong === run.strong && last.code === run.code && last.href === run.href) last.text += text
    else cur.runs.push(run)
  }
  const closeBlock = () => {
    if (!cur) return
    const runs = cur.runs
    // Trim the block's outer whitespace across run boundaries.
    while (runs.length && !runs[0].text.trim()) runs.shift()
    while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop()
    if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ''); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '') }
    const text = runs.map((r) => r.text).join('')
    if (text.trim()) {
      if (list && cur.kind === 'item') list.items.push(runs)
      else if (cur.kind !== 'item') blocks.push({ ...cur, runs, text })
    }
    cur = null
  }
  const closeList = () => {
    closeBlock()
    if (list && list.items.length) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  const re = /<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)\/?>/g
  let last = 0, m
  while ((m = re.exec(src))) {
    const raw = src.slice(last, m.index)
    last = re.lastIndex
    if (!drop && raw) pushRun(pre ? decodeEntities(raw) : decodeEntities(raw).replace(/\s+/g, ' '))
    const closing = m[0][1] === '/'
    const tag = m[1].toLowerCase()

    if (drop) {
      if (tag === dropTag) { if (closing) drop--; else drop++ }
      continue
    }
    if (!closing && DROP_SUBTREE.has(tag)) {
      // Self-closing / void forms of these carry no subtree to skip.
      if (!/\/>$/.test(m[0])) { drop = 1; dropTag = tag }
      continue
    }

    if (tag === 'br') { if (!pre) pushRun(' '); else pushRun('\n'); continue }
    if (tag === 'a') {
      if (closing) href = null
      else {
        const h = attrsOf(m[2]).href
        // ONLY http(s) and only when resolvable. A javascript: or data: href never reaches the
        // client — the client also refuses them, because one rule in two places is how a hole opens.
        try { const abs = new URL(h ?? '', base); href = (abs.protocol === 'https:' || abs.protocol === 'http:') ? abs.toString() : null }
        catch { href = null }
      }
      continue
    }
    if (tag === 'em' || tag === 'i') { fmt.em += closing ? -1 : 1; if (fmt.em < 0) fmt.em = 0; continue }
    if (tag === 'strong' || tag === 'b') { fmt.strong += closing ? -1 : 1; if (fmt.strong < 0) fmt.strong = 0; continue }
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') { fmt.code += closing ? -1 : 1; if (fmt.code < 0) fmt.code = 0; continue }

    if (/^h[1-6]$/.test(tag)) {
      closeBlock()
      if (!closing) cur = { kind: 'heading', level: Number(tag[1]), runs: [], id: attrsOf(m[2]).id || '' }
      continue
    }
    if (tag === 'blockquote') { closeBlock(); if (!closing) cur = { kind: 'quote', runs: [] }; continue }
    if (tag === 'pre') { closeBlock(); pre += closing ? -1 : 1; if (pre < 0) pre = 0; if (!closing) cur = { kind: 'code', runs: [] }; continue }
    if (tag === 'ul' || tag === 'ol') { closing ? closeList() : (closeList(), list = { ordered: tag === 'ol', items: [] }); continue }
    if (tag === 'li') { closeBlock(); if (!closing && list) cur = { kind: 'item', runs: [] }; continue }
    if (BLOCK_END.has(tag)) { closeBlock(); continue }
  }
  const tailRaw = src.slice(last)
  if (!drop && tailRaw) pushRun(decodeEntities(tailRaw).replace(/\s+/g, ' '))
  closeList()
  closeBlock()

  // Give every heading a stable id so the client can offer "cite this section" against something.
  let n = 0
  for (const b of blocks) if (b.kind === 'heading' && !b.id) b.id = `h${++n}`
  return { title, blocks }
}

/** The whole endpoint, in one function so the dev middleware and the Vercel handler share it. */
export async function readSource(url) {
  const { finalUrl, html } = await fetchChecked(url)
  const { title, blocks } = extractBlocks(html, finalUrl)
  if (!blocks.length) throw new Error('no readable text')
  return { url: finalUrl, title, blocks }
}
