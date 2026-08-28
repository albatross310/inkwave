// THE EXTRACTOR — pure, and deliberately FREE OF NODE IMPORTS so it can run in either place.
//
// Split out of api/_reader-core.mjs on 2026-08-28. The reason is Peter's question — "is it possible
// for us to run the window from the user's IP?" — and the answer is yes, through the browser
// extension this repo already ships, which fetches with the reader's OWN address and session. What
// that needs is for the HTML→blocks step to be callable from the BROWSER as well as from the
// serverless function, and the only thing stopping it was `node:dns`/`node:net` sitting at the top
// of the same file. Those belong to the SSRF guard, which is a server concern; the extractor never
// needed them.
//
// ONE COPY, TWO CALLERS. A second implementation of this would drift the first time either side was
// tuned, and both sides feed the same renderer — the pmToText/textMap lesson, one file along.

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

