// THE SOURCE READER, DRIVEN END TO END.
//
// ⚠ WHY THIS EXISTS. Every reader bug in the 2026-08-28 session was found by Peter, not by me: the
// text was not selectable, "cite as locator" cited the sentence instead of the section, "use as
// cited sentence" looked dead, live mode had a cream border round it, SEP's anchors did nothing,
// search had never worked in production. My one attempt at an end-to-end probe mounted the
// component out of a production bundle — which has no /src module graph — so it mounted NOTHING and
// printed PASS. A probe that cannot fail is worse than no probe, because it is quoted.
//
// So this one drives the REAL app through the REAL UI: it opens a document, seeds a citation whose
// source has a web URL, opens the reader from that citation, and then uses it. No mounting
// components by hand, no shims for anything the browser can do itself.
//
// The only stub is the NETWORK: /api/reader is fulfilled from the REAL extractor
// (src/reader/extract.mjs) over a fixture page, so the probe tests the reader rather than the
// weather. The extractor being real is the point — a fake one would let the renderer pass against
// blocks the shipped code never produces.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { extractBlocks } from '../../src/reader/extract.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const PAGE_HTML = `<!doctype html><html><head><title>Identity Over Time</title></head><body><main>
  <h1>Identity Over Time</h1>
  <p>An opening paragraph that is long enough to select a real sentence out of, which is what the
     citation actions operate on. It mentions <a href="/entries/change/">change</a> in passing.</p>
  <h2 id="Intr">1. Introduction</h2>
  <p>The first section says something quotable about persistence and the puzzle of change over time.</p>
  <h2 id="Chng">2.1 Identity and Change</h2>
  <p>Consider the property version of Leibniz's Law. \\[\\tag{LL} \\forall x\\forall y[x=y]\\] The relation
     of identity mentioned in the antecedent is the one at issue.</p>
  <h2 id="Bib">Bibliography</h2>
  <p>Geach, P., 1967.</p>
</main></body></html>`

const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })
// ⚠ BLOCK THE SERVICE WORKER. Inkwave registers one (public/sw.js) and it answers from its own
// cache, so `page.route` — which does not intercept service-worker-originated requests — was
// bypassed entirely: `/api/reader` came back as the app's own index.html with status 200, the
// reader's `r.json()` threw, and the panel showed "That page couldn't be read here." Three separate
// theories (a bad glob, a route deadlock, a throwing handler) were wrong before this one, and every
// one of them looked exactly like the feature being broken.
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
let fail = 0
const check = (ok, msg, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fail++ }

try {
  // The real endpoint, answered with the real extractor over a fixture page.
  // ⚠ COUNT FROM OUTSIDE. A `page.evaluate` inside a route handler runs while that request is still
  // pending and can deadlock it — the fetch then never resolves and the reader shows its error, which
  // is a probe artefact indistinguishable from the bug it is looking for. (It did exactly that.)
  let apiCalls = 0
  page.on('request', (r) => { if (r.url().includes('/api/reader')) { apiCalls++; console.log('  [req]', r.url().slice(0, 110)) } })
  page.on('response', async (r) => {
    if (!r.url().includes('/api/reader')) return
    let body = ''
    try { body = (await r.text()).slice(0, 120) } catch (e) { body = 'UNREADABLE: ' + e.message }
    console.log('  [res]', r.status(), body)
  })
  page.on('requestfailed', (r) => { if (r.url().includes('/api/reader')) console.log('  [req FAILED]', r.failure()?.errorText, r.url().slice(0, 80)) })
  page.on('console', (m) => { const t = m.text(); if (/reader|api/i.test(t) && m.type() === 'error') console.log('  [page err]', t.slice(0, 140)) })
  // ⚠ A PREDICATE, NOT A GLOB. With `'**/api/reader**'` the interception silently did not happen and
  // the probe server's SPA FALLBACK answered instead — 200, with the app's own index.html — so the
  // reader's `r.json()` threw, its catch produced `{error:'fetch failed'}`, and the panel showed
  // "That page couldn't be read here." A route that does not match looks exactly like a feature that
  // does not work.
  await page.route((u) => u.pathname === '/api/reader', (route) => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('probe') === '1') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ framable: true }) })
    }
    const target = u.searchParams.get('url') || ''
    try {
      const { title, blocks } = extractBlocks(PAGE_HTML, target)
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: target, title, blocks }) })
    } catch (e) {
      console.log('  [route threw]', e.message)
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'probe route threw: ' + e.message }) })
    }
  })

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(2500)

  // A document with ONE citation whose source has a web URL and no PDF — the path that opens the
  // reader on a plain click.
  // ⚠ SEED THROUGH THE REAL PERSISTENCE PATH, not by importing app internals. A production bundle
  // has no /src module graph — importing `bibProvider` from the page is what made my FIRST attempt
  // at this probe mount nothing and print PASS. Writing the per-document library file that
  // citations/library.ts actually reads exercises the shipped code instead of bypassing it.
  const docId = 'reader-probe-' + Math.random().toString(36).slice(2, 8)
  const seeded = await page.evaluate(async (id) => {
    const item = {
      id: 'sider2001', type: 'article-journal', title: 'Identity Over Time',
      author: [{ family: 'Sider', given: 'T' }], issued: { 'date-parts': [[2001]] },
      URL: 'https://plato.stanford.edu/entries/identity-time/',
    }
    const doc = {
      id, title: 'Reader probe', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [
        { type: 'paragraph', content: [
          { type: 'text', text: 'As argued ' },
          { type: 'citation', attrs: { citekeys: ['sider2001'], prefix: '', suffix: '', locator: '', suppressAuthor: false } },
          { type: 'text', text: ' the puzzle persists.' },
        ] },
      ] },
    }
    // ⚠ WRITE BOTH FILES, THEN RELOAD. The library is stored PER DOCUMENT
    // (library/<id>/citations.json) and `loadLibrary` resolves that path from the tab's CURRENT
    // document — so seeding it and then opening the document reads the previous identity and finds
    // nothing, which renders the citation as "(?sider2001)". Seeding the document too and arriving
    // via ?doc= means the tab has its identity before anything loads. (Discovered by this probe
    // failing honestly, which is the whole reason to write one.)
    try {
      const root = await navigator.storage.getDirectory()
      const docs = await root.getDirectoryHandle('documents', { create: true })
      const dir = await docs.getDirectoryHandle(id, { create: true })
      const dh = await dir.getFileHandle('current.json', { create: true })
      const dw = await dh.createWritable(); await dw.write(JSON.stringify(doc)); await dw.close()

      const lib = await root.getDirectoryHandle('library', { create: true })
      const per = await lib.getDirectoryHandle(id, { create: true })
      const fh = await per.getFileHandle('citations.json', { create: true })
      const w = await fh.createWritable(); await w.write(JSON.stringify([item])); await w.close()
    } catch (e) { return 'opfs: ' + e.message }
    return 'ok'
  }, docId)
  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  check(seeded === 'ok', 'seeded a resolvable citation with a web source', String(seeded))

  // OPEN THE READER THE WAY PETER DOES: a plain click on the author-year.
  const opened = await page.evaluate(() => {
    const link = document.querySelector('.iw-cite-link')
    if (!link) {
      const pm = document.querySelector('.ProseMirror[contenteditable="true"]')
      return 'no citation rendered | editor text=' + JSON.stringify((pm?.innerText || '').slice(0, 120)) +
             ' | citationNodes=' + document.querySelectorAll('[data-citation]').length +
             ' | anySpan=' + document.querySelectorAll('.ProseMirror span').length
    }
    link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    link.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return 'clicked'
  })
  check(opened === 'clicked', 'the citation renders and takes a click', String(opened))
  try {
    await page.waitForFunction(() => /Identity Over Time/.test(document.body.innerText), null, { timeout: 20000 })
  } catch {
    const diag = await page.evaluate(() => ({
      readerPanels: document.querySelectorAll('[data-iw-selectable]').length,
      panels: document.querySelectorAll('[data-iw-selectable]').length,
      body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 260),
    }))
    check(false, 'the reader opened and rendered the article', `apiCalls=${apiCalls} ` + JSON.stringify(diag))
  }
  await page.waitForTimeout(1200)

  const body = 'div[data-iw-selectable]'
  check(await page.locator(body).count() > 0, 'the reader opened on a plain click (no hold, no "read here")')

  // THE ARTICLE IS REALLY THERE, as our own DOM.
  const stats = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return { paras: el.querySelectorAll('p').length, heads: el.querySelectorAll('h1,h2,h3').length,
             iframes: el.querySelectorAll('iframe').length, katex: el.querySelectorAll('.katex').length }
  }, body)
  check(stats.paras >= 4 && stats.heads >= 3, 'the article rendered as our own DOM', JSON.stringify(stats))
  check(stats.iframes === 0, 'reader mode, not the iframe fallback')
  check(stats.katex > 0, 'LaTeX was typeset by KaTeX, not shown as source', `${stats.katex} formula(s)`)

  // SELECTABLE — the bug that made the whole feature pointless.
  const selLen = await page.evaluate((sel) => {
    // paragraph 1 sits under "1. Introduction" — a REAL section. (Paragraph 0 is above the first
    // heading, where the only thing overhead is the article's own title; that case is asserted
    // separately below, because "cite the piece's own title" is not a locator.)
    const p = document.querySelector(sel).querySelectorAll('p')[1]
    const r = document.createRange(); r.selectNodeContents(p)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    return getSelection().toString().trim().length
  }, body)
  check(selLen > 20, 'the article text is SELECTABLE', `${selLen} chars`)
  await page.waitForTimeout(400)

  // The selection offers the PDF's coloured dots and the two citation actions.
  // ⚠ SCOPE TO THE POPOVER. Every heading carries its own "cite §" button, so scanning ALL buttons
  // finds four of them and answers a different question than the one being asked.
  const popoverActions = () => page.evaluate(() => {
    const q = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'quote this')
    const box = q?.parentElement
    return box ? [...box.querySelectorAll('button')].map((b) => b.textContent.trim()) : []
  })
  const actions = await popoverActions()
  check(actions.some((t) => t === 'quote this'), 'the selection offers "quote this"')
  const citeBtn = actions.find((t) => /^cite /.test(t))
  check(!!citeBtn, 'the selection offers to cite the SECTION it sits in', citeBtn || 'none')
  check(!!citeBtn && !/Consider the property/.test(citeBtn), 'it cites the SECTION, not the sentence')

  // CITE IT, and check the citation in the DOCUMENT actually changed.
  // Click the POPOVER's cite button. Finding the first `/^cite /` on the page clicks a HEADING's
  // own button instead — the h1's, which offered the article's title — and then the assertion below
  // fails for a reason that has nothing to do with the selection.
  await page.evaluate(() => {
    const q = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'quote this')
    const box = q?.parentElement
    const b = box && [...box.querySelectorAll('button')].find((x) => /^cite /.test(x.textContent.trim()))
    b && b.click()
  })
  await page.waitForTimeout(900)
  // Read the citation out of the EDITOR. The previous selector walked up from `.iw-cite-link` and
  // landed on the reader panel's own header, which also says "Sider, 2001" — so it was reporting the
  // panel's title as the document's citation text.
  const inlineText = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror[contenteditable="true"]')
    return (pm?.innerText || '').replace(/\s+/g, ' ').trim()
  })
  check(/§|ch\.|p\./.test(inlineText), 'the locator landed on the citation in the document', JSON.stringify(inlineText.slice(0, 60)))

  // KNOWN-NEGATIVE for the fix above: text with only the article's TITLE above it offers no "cite".
  const titleCase = await page.evaluate((sel) => {
    const p = document.querySelector(sel).querySelectorAll('p')[0]
    const r = document.createRange(); r.selectNodeContents(p)
    const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    return new Promise((res) => setTimeout(() => {
      const q = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'quote this')
      const box = q?.parentElement
      res(box ? [...box.querySelectorAll('button')].map((b) => b.textContent.trim()) : [])
    }, 350))
  }, body)
  check(!titleCase.some((t) => /^cite /.test(t)), 'no "cite" offered where the only heading above is the article’s TITLE',
    titleCase.filter((t) => /^cite/.test(t)).join(',') || 'none offered')
  check(titleCase.some((t) => t === 'quote this'), '…but quoting is still offered there')

  // SEP-STYLE IN-PAGE ANCHOR: same page, different fragment — must scroll, not refetch.
  const anchored = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const before = el.scrollTop
    const a = [...el.querySelectorAll('a')].find((x) => /change/i.test(x.textContent))
    return { hasLink: !!a, before }
  }, body)
  check(anchored.hasLink, 'links in the article render as links')
} catch (e) {
  console.log(`  ✗ ${e.message}`)
  fail++
} finally { await b.close(); await stop() }
console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
