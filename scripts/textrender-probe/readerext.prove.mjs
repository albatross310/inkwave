// DOES SEARCH WORK WHEN THE EXTENSION IS THE FETCHER? — driven through the REAL reader UI.
//
// ⚠ READ THIS BEFORE QUOTING THE RESULT. What this probe exercises and what it does NOT:
//
//   EXERCISED, for real, in a real browser: the app's own half. The reader asks over
//   window.postMessage, honours the answer, fetches the search page through that channel instead of
//   `/api/reader`, runs the SHIPPED extractor on the HTML that comes back, renders the results, and
//   SAYS which connection fetched them. The "no /api/reader request" claim is observed at the
//   NETWORK, by Playwright, not inferred from a spy.
//
//   NOT EXERCISED: the extension's own `fetch` to DuckDuckGo. Nothing here loads a real unpacked
//   extension (it would need a wxt build, a `<all_urls>` grant that only a popup gesture can give,
//   and a live request to a third party — a probe measuring the weather). The stand-in is the
//   content script's PAGE-FACING half, which is exactly a window listener, so what sits behind it
//   is a fixture rather than Peter's IP.
//
//   THEREFORE: this proves "given an extension that fetches, search works here". It does NOT prove
//   "DuckDuckGo serves Peter's browser" — that is a claim about the network, and the honest way to
//   settle it is Peter loading the extension and searching once. The measured half of the argument
//   is already in hand and is not from this box: against the DEPLOYED function duckduckgo, lite-ddg
//   and mojeek answer "fetch failed", searx.be "Verifying your browser…", priv.au a captcha, while
//   wikipedia and plato.stanford.edu are served normally.
//
// The KNOWN-NEGATIVE is the whole reason to trust the positive: the SAME probe, with the SAME
// fixture, and one field flipped (`canFetch: false` — installed but not permitted) must send the
// identical search to `/api/reader` and say so on screen. Without that arm, "0 server requests"
// could just as well mean the search never ran.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'

// What html.duckduckgo.com/html returns, in miniature: a page of result links. The point of the
// fixture is that its words CANNOT come from anywhere else, so finding them on screen is proof the
// extension's bytes were the ones rendered.
const SEARCH_HTML = `<!doctype html><html><head><title>relative identity at DuckDuckGo</title></head><body><main>
  <h1>Results</h1>
  <p><a href="https://plato.stanford.edu/entries/identity-relative/">SEP: Relative Identity</a> —
     GEACHS-DOCTRINE-FROM-THE-EXTENSION, a phrase that exists nowhere but this fixture.</p>
  <p><a href="https://example.org/two">Absolute and relative identity</a> — a second result, so the
     extracted page is unmistakably a list of results rather than an article.</p>
  <p><a href="https://example.org/three">Identity, ontology and language</a> — a third.</p>
</main></body></html>`

// The article the reader opens on first, before the search is typed. Distinct words again.
const ARTICLE_HTML = `<!doctype html><html><head><title>Identity Over Time</title></head><body><main>
  <h1>Identity Over Time</h1>
  <p>An opening paragraph with enough prose in it for the extractor to keep, mentioning
     SIDER-BASELINE-TEXT so its provenance is never in doubt.</p>
  <h2 id="Intr">1. Introduction</h2>
  <p>The first section says something about persistence and the puzzle of change over time.</p>
</main></body></html>`

const { base, stop } = await startProbeServer()
let fail = 0
const check = (ok, msg, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fail++ }

/**
 * One run of the whole flow. `canFetch` is the ONLY difference between the two cells.
 * Returns what was observed rather than asserting inside, so the two cells can be compared.
 */
async function run(browser, { canFetch }) {
  // ⚠ serviceWorkers: 'block'. Inkwave registers one and it answers from its own cache, which
  // `page.route` does not intercept — `/api/reader` then comes back as the app's index.html with
  // status 200 and the reader shows "That page couldn't be read here." (reader.prove.mjs records
  // three wrong theories chased before this one; every single one looked like a feature bug.)
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()

  // THE STAND-IN FOR THE CONTENT SCRIPT — installed BEFORE any app code runs, because the reader
  // asks its question during the panel's first effect and a listener attached later would miss it.
  // It is a page-context window listener and nothing else, which is precisely what
  // extension-src/entrypoints/content-inkwave.ts is on this side of the bridge.
  await page.addInitScript(({ canFetch, searchHtml, articleHtml }) => {
    window.addEventListener('message', (e) => {
      const d = e.data
      if (!d || d.source !== 'inkwave-app') return
      const reply = (msg) => window.postMessage(msg, window.location.origin)
      if (d.type === 'reader/ping') {
        reply({ source: 'inkwave-ext', type: 'reader/pong', uuid: d.uuid, canFetch })
        return
      }
      if (d.type === 'reader/fetch') {
        // Record every URL the app asked the "extension" to fetch, so the probe can prove the
        // search really went down this path rather than merely not going down the other one.
        ;(window.__extFetches = window.__extFetches || []).push(d.url)
        const isSearch = /duckduckgo|\?q=/.test(String(d.url))
        reply({
          source: 'inkwave-ext', type: 'reader/fetched', uuid: d.uuid, ok: true,
          finalUrl: String(d.url), html: isSearch ? searchHtml : articleHtml,
        })
      }
    })
  }, { canFetch, searchHtml: SEARCH_HTML, articleHtml: ARTICLE_HTML })

  // OBSERVE THE NETWORK FROM OUTSIDE THE PAGE. A spy inside the app could be fooled by the app;
  // this is Playwright watching the socket.
  const serverFetches = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.pathname === '/api/reader' && u.searchParams.get('probe') !== '1') {
      serverFetches.push(u.searchParams.get('url') || '')
    }
  })

  // The real endpoint, answered from the fixture — so the SERVER arm renders something too and the
  // two cells differ only in WHO fetched, never in whether anything was found.
  await page.route((u) => u.pathname === '/api/reader', async (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('probe') === '1') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ framable: true }) })
    }
    const target = u.searchParams.get('url') || ''
    const { extractBlocks } = await import('../../src/reader/extract.mjs')
    const html = /duckduckgo|\?q=/.test(target) ? SEARCH_HTML : ARTICLE_HTML
    const { title, blocks } = extractBlocks(html, target)
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: target, title, blocks }) })
  })

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(2000)

  // Seed a document with ONE citation whose source has a web URL — the path that opens the reader
  // on a plain click. Written through the real persistence layer, then arrived at with ?doc= so the
  // tab has its identity before the library loads (reader.prove.mjs discovered that ordering).
  const docId = 'readerext-' + Math.random().toString(36).slice(2, 8)
  await page.evaluate(async (id) => {
    const item = {
      id: 'sider2001', type: 'article-journal', title: 'Identity Over Time',
      author: [{ family: 'Sider', given: 'T' }], issued: { 'date-parts': [[2001]] },
      URL: 'https://plato.stanford.edu/entries/identity-time/',
    }
    const doc = {
      id, title: 'Reader ext probe', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'As argued ' },
        { type: 'citation', attrs: { citekeys: ['sider2001'], prefix: '', suffix: '', locator: '', suppressAuthor: false } },
        { type: 'text', text: ' the puzzle persists.' },
      ] }] },
    }
    const root = await navigator.storage.getDirectory()
    const docs = await root.getDirectoryHandle('documents', { create: true })
    const dir = await docs.getDirectoryHandle(id, { create: true })
    const dh = await dir.getFileHandle('current.json', { create: true })
    const dw = await dh.createWritable(); await dw.write(JSON.stringify(doc)); await dw.close()
    const lib = await root.getDirectoryHandle('library', { create: true })
    const per = await lib.getDirectoryHandle(id, { create: true })
    const fh = await per.getFileHandle('citations.json', { create: true })
    const w = await fh.createWritable(); await w.write(JSON.stringify([item])); await w.close()
  }, docId)

  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(1500)

  await page.evaluate(() => {
    const link = document.querySelector('.iw-cite-link')
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  // Wait for the ARTICLE, not for a clock — a sleep here reports "the reader is broken" about a
  // reader that is merely still fetching (the pdfposthoc lesson).
  await page.waitForFunction(() => /SIDER-BASELINE-TEXT/.test(document.body.innerText), null, { timeout: 25000 })
    .catch(() => {})
  const articleShown = await page.evaluate(() => /SIDER-BASELINE-TEXT/.test(document.body.innerText))

  // NOW SEARCH, the way a writer does: type words into the address bar and press Enter.
  const addr = page.locator('input[placeholder="address or search"]')
  await addr.click()
  await addr.fill('relative identity')
  await addr.press('Enter')
  await page.waitForFunction(() => /GEACHS-DOCTRINE-FROM-THE-EXTENSION|Search engines don/.test(document.body.innerText),
    null, { timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(800)

  const seen = await page.evaluate(() => ({
    results: /GEACHS-DOCTRINE-FROM-THE-EXTENSION/.test(document.body.innerText),
    saysExtension: /your connection/.test(document.body.innerText),
    saysServer: /Inkwave.s server/.test(document.body.innerText),
    offersGrant: /use my connection/.test(document.body.innerText),
    extFetches: window.__extFetches || [],
  }))

  await ctx.close()
  return { ...seen, articleShown, serverFetches }
}

const b = await chromium.launch({ headless: true })
try {
  console.log('\n  CELL A — the extension is installed AND permitted')
  const on = await run(b, { canFetch: true })
  check(on.articleShown, 'the reader opened and rendered the article through the extension')
  check(on.results, 'THE SEARCH RETURNED RESULTS, rendered from the extension’s bytes')
  check(on.extFetches.some((u) => /duckduckgo/.test(u)),
    'the search URL was fetched over the extension channel', JSON.stringify(on.extFetches.slice(-1)))
  check(on.serverFetches.length === 0,
    'and /api/reader was never asked — observed at the network, not inferred',
    `serverFetches=${JSON.stringify(on.serverFetches)}`)
  check(on.saysExtension, 'the panel SAYS the page came through the writer’s own connection')

  console.log('\n  CELL B — KNOWN-NEGATIVE: installed, NOT permitted (one field flipped)')
  const off = await run(b, { canFetch: false })
  check(off.results, 'the same search still returns results (so cell A’s 0 cannot mean “nothing ran”)')
  check(off.extFetches.length === 0, 'nothing went over the extension channel', JSON.stringify(off.extFetches))
  check(off.serverFetches.some((u) => /duckduckgo/.test(u)),
    'the search went to /api/reader instead', `serverFetches=${off.serverFetches.length}`)
  check(off.saysServer, 'the panel SAYS our server fetched it')
  check(off.offersGrant, 'and OFFERS the permission, at the moment it would help')

  // The two cells must actually differ, or both are measuring the same thing.
  check(on.serverFetches.length !== off.serverFetches.length,
    'the two cells genuinely diverge — the flag changes who fetches',
    `A=${on.serverFetches.length} B=${off.serverFetches.length}`)
} catch (e) {
  console.log(`  ✗ ${e.message}`)
  fail++
} finally { await b.close(); await stop() }

console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
console.log('\n  SCOPE: this proves the APP half — given an extension that fetches, search works and')
console.log('  says so. The extension\'s own request to DuckDuckGo from the writer\'s IP is NOT')
console.log('  exercised here and needs one real search on Peter\'s machine.')
process.exitCode = fail ? 1 : 0
