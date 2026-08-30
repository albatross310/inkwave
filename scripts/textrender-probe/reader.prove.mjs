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

// The LIVE-VIEW fixture. Deliberately TALL and NOT WIDE: the site must have its own vertical
// scrolling (so the frame keeps that axis) and no horizontal scroll of its own (so a horizontal
// gesture CHAINS out of the frame into our host, which is the whole pan mechanism).
const LIVE_HTML = `<!doctype html><html><head><title>Identity Over Time</title>
  <style>body{margin:0;font:16px/1.6 serif}main{padding:24px}p{max-width:100%}</style></head>
  <body><main><h1>Identity Over Time</h1>${'<p>A paragraph of the live page, long enough to make it scroll vertically the way a real article does.</p>'.repeat(60)}</main></body></html>`

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
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // LIVE VIEW — ZOOM, PAN, REFRESH, AND THE SELF-FRAME REFUSAL (2026-08-30)
  // Peter: "need zoom and left right two finger scroll to work on the windowed browser" and "copy a
  // bunch of the editing and the centre around text buttons from the pdf viewer".
  //
  // WARNING THESE CELLS MEASURE PAINTED PIXELS, NOT THE PRESENCE OF A HANDLER. A cell that asserts a
  // listener exists proves nothing - this repo is full of probes that passed while the feature was
  // broken. Every check below reads geometry off the layout engine or a real scroll offset.
  //
  // AND getBoundingClientRect UNDER A TRANSFORM RETURNS VISUAL px. That is what is wanted here
  // (the question IS how big the page is drawn), but it must be deliberate - CLAUDE.md records the
  // magnify convention for exactly this confusion.
  // ⚠ `ctx.route`, NOT `page.route`. A cross-origin frame is an OUT-OF-PROCESS iframe in Chromium
  // and a page-level route does not reach it: MEASURED, the frame navigated to
  // `chrome-error://chromewebdata/` while every geometry cell above still passed, because those
  // measure OUR element. The pan cell in particular would then have been scoring a chained scroll
  // out of an ERROR PAGE — which has no content of its own to consume the gesture, i.e. the
  // easiest possible case, dressed up as the real one. A probe that passes against a fixture that
  // never loaded is the house disease.
  await ctx.route((u) => u.hostname === 'plato.stanford.edu',
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: LIVE_HTML }))
  // ⚠ COUNT THE FRAME'S OWN NAVIGATIONS, NOT `page.on('request')`. A cross-origin sub-frame
  // navigation does not surface as a page-level request event here (measured: the first cut read
  // 0 loads on a frame that had visibly loaded, which would have reported a working refresh button
  // as broken — the most expensive direction to be wrong in). `page.on('framenavigated')` is the
  // event that describes what actually happened.
  let liveLoads = 0
  page.on('framenavigated', (f) => { if (f !== page.mainFrame() && f.url().includes('plato.stanford.edu')) liveLoads++ })
  page.on('requestfailed', (r) => { if (r.url().includes('plato.stanford')) console.log('  [frame req FAILED]', r.failure()?.errorText, r.resourceType()) })

  const clickBy = (title) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith(t) || (x.getAttribute('aria-label') || '') === t)
    if (!b) return false
    b.click(); return true
  }, title)

  // Geometry, read from the layout engine. Returns NULL - never an empty object - when the frame is
  // not on screen, so "the page did not grow" and "there is no page" stay different answers (the
  // distinction readJson and readSnapshotsFromDisk exist to keep).
  const liveGeom = () => page.evaluate(() => {
    const f = document.querySelector('[data-iw-selectable] iframe')
    if (!f) return null
    const host = f.parentElement && f.parentElement.parentElement
    if (!host) return null
    const r = f.getBoundingClientRect()
    const fit = [...document.querySelectorAll('button')].find((b) => b.hasAttribute('data-iw-live-fit'))
    return {
      paintedW: Math.round(r.width * 100) / 100, paintedH: Math.round(r.height * 100) / 100,
      cssW: f.clientWidth, cssH: f.clientHeight,
      hostW: host.clientWidth, hostH: host.clientHeight,
      scrollW: host.scrollWidth, scrollLeft: Math.round(host.scrollLeft),
      overflowX: getComputedStyle(host).overflowX, overflowY: getComputedStyle(host).overflowY,
      pct: ((fit && fit.textContent) || '').trim(),
    }
  })

  // Into live view, by the header toggle a reader actually presses.
  await clickBy('Live page')
  await page.waitForSelector('[data-iw-selectable] iframe', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(900)

  // ⚠ VOID GUARD, AND IT EARNED ITSELF IMMEDIATELY. The probe server sent no `frame-src`, so
  // `default-src 'self'` refused the frame before any request existed and it sat at
  // `chrome-error://chromewebdata/` — and EVERY cell below still passed, because they measure OUR
  // element. The pan cell was the dangerous one: it was scoring a scroll chained out of an error
  // page, which has no content to consume the gesture. So the fixture must be proved LOADED, with
  // real content and its own vertical scroll, before any verdict here is read.
  const loaded = await page.evaluate(async () => {
    const f = document.querySelector('[data-iw-selectable] iframe')
    return f ? f.getAttribute('src') : null
  })
  const frameUrls = page.frames().filter((f) => f !== page.mainFrame()).map((f) => f.url())
  check(!!loaded && frameUrls.some((u) => u.startsWith('https://plato.stanford.edu')),
    'VOID GUARD: the live fixture actually LOADED — an error page would pass every cell below',
    frameUrls.join(' | ') || 'no child frame')
  const inner = page.frames().find((f) => f.url().startsWith('https://plato.stanford.edu'))
  const innerScroll = inner ? await inner.evaluate(() => ({
    v: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    h: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  })).catch(() => null) : null
  check(!!innerScroll && innerScroll.v > 200 && innerScroll.h <= 1,
    '…and it is the shape the pan claim needs: its OWN vertical scroll, and no horizontal scroll to swallow the gesture',
    JSON.stringify(innerScroll))
  const g0 = await liveGeom()
  if (!g0) {
    check(false, 'VOID: live view never rendered a frame - nothing below can be read')
  } else {
    check(Math.abs(g0.paintedW - g0.hostW) <= 1.5,
      'at fit the page is drawn exactly as wide as the panel - no dead background strip',
      `painted ${g0.paintedW} vs host ${g0.hostW}`)
    check(g0.overflowY === 'hidden',
      'the host never scrolls vertically - the SITE keeps that axis, so there is no second scrollbar',
      g0.overflowY)
    check(g0.pct === '100%', 'the zoom reads 100% at fit', g0.pct)

    // ZOOM IN, three presses of the ported + button.
    await clickBy('Zoom in'); await clickBy('Zoom in'); await clickBy('Zoom in')
    await page.waitForTimeout(400)
    const g1 = await liveGeom()
    const want = g0.hostW * Math.pow(1.15, 3)
    check(!!g1 && Math.abs(g1.paintedW - want) <= 2,
      'three presses of + draw the page 1.15^3 WIDER - measured in painted px, not asserted',
      g1 ? `${g0.paintedW} -> ${g1.paintedW} (expected ${Math.round(want * 100) / 100})` : 'no frame')
    check(!!g1 && Math.abs(g1.paintedH - g0.paintedH) <= 1.5,
      'and NOT taller - the frame still fills the host, so the site keeps its own vertical scroll',
      g1 ? `${g0.paintedH} -> ${g1.paintedH}` : 'no frame')
    check(!!g1 && g1.cssW === g0.cssW,
      'the CSS viewport handed to the site is UNCHANGED - zoom magnifies, it does not re-lay-out',
      g1 ? `${g0.cssW} -> ${g1.cssW}` : 'no frame')
    check(!!g1 && g1.overflowX === 'auto' && g1.scrollW > g1.hostW + 1,
      'the host has become a real horizontal scroller',
      g1 ? `overflow-x ${g1.overflowX}, scrollWidth ${g1.scrollW} > host ${g1.hostW}` : 'no frame')
    check(!!g1 && g1.pct === '152%', 'the readout follows', g1 ? g1.pct : 'no frame')

    // PAN. THE POINT OF THE WHOLE MEASUREMENT: a two-finger horizontal gesture delivered OVER the
    // cross-origin frame - where no listener of ours is ever called - must still move the host,
    // because the browser chains the scroll out of the frame. If this reads 0 the feature is dead
    // however many handlers exist.
    const box = await page.locator('[data-iw-selectable] iframe').boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(60, 0); await page.waitForTimeout(60) }
      await page.waitForTimeout(400)
    }
    const g2 = await liveGeom()
    check(!!g2 && g2.scrollLeft > 20,
      'a horizontal two-finger scroll OVER the frame pans the page - the browser chains it out',
      g2 ? `scrollLeft ${g2.scrollLeft}` : 'no frame')

    // FIT. The honest port of the PDF's fit button: there is no text bounding box to read inside a
    // cross-origin document, so it fits the PAGE to the panel and resets the pan.
    await clickBy('Fit the page to the panel width and re-centre')
    await page.waitForTimeout(400)
    const g3 = await liveGeom()
    check(!!g3 && g3.pct === '100%' && Math.abs(g3.paintedW - g3.hostW) <= 1.5 && g3.scrollLeft === 0,
      'fit-to-width returns the page to the panel and re-centres the pan',
      g3 ? `${g3.pct}, painted ${g3.paintedW} vs host ${g3.hostW}, scrollLeft ${g3.scrollLeft}` : 'no frame')
    check(!!g3 && g3.overflowX === 'hidden',
      'and the scrollbar goes away - a page that fits is not pannable', g3 ? g3.overflowX : 'no frame')

    // ZOOM OUT IS REFUSED BELOW FIT. The PDF's minUserZoom argument: below fit the page is
    // narrower than the panel and sits in a strip of dead background, which is what Peter reported
    // on the PDF and what got fixed there this morning.
    await clickBy('Zoom out'); await clickBy('Zoom out')
    await page.waitForTimeout(300)
    const g4 = await liveGeom()
    check(!!g4 && g4.pct === '100%' && Math.abs(g4.paintedW - g4.hostW) <= 1.5,
      'zooming out below fit is refused - the page can never be narrower than the panel',
      g4 ? `${g4.pct}, painted ${g4.paintedW} vs host ${g4.hostW}` : 'no frame')
  }

  // REFRESH (Peter, 2026-08-30). LIVE reloads by remounting the frame; the site decides where it
  // lands. Counted as a real document request, because "the button exists" is not the claim.
  const beforeLoads = liveLoads
  await page.evaluate(() => { const b = document.querySelector('[data-iw-reader-refresh]'); if (b) b.click() })
  await page.waitForTimeout(1500)
  check(liveLoads > beforeLoads, 'refresh in LIVE view re-fetches the page', `${beforeLoads} -> ${liveLoads} document loads`)

  // INKWAVE MAY NOT OPEN INKWAVE - and the KNOWN-NEGATIVE is the other half. Refusing something
  // proves nothing about whether the check DISCRIMINATES; an ordinary site must still frame in the
  // same run, on the same build, seconds apart.
  const typeAddress = async (u) => {
    await page.evaluate((url) => {
      const i = [...document.querySelectorAll('input')].find((x) => x.placeholder === 'address or search')
      if (!i) return
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(i, url)
      i.dispatchEvent(new Event('input', { bubbles: true }))
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }, u)
    await page.waitForTimeout(1600)
  }
  await typeAddress('https://iwzero.me/')
  const self = await page.evaluate(() => ({
    said: /can.t open Inkwave in its own panel/.test(document.body.innerText),
    frames: document.querySelectorAll('[data-iw-selectable] iframe').length,
    blamedHeader: /header telling browsers/.test(document.body.innerText),
  }))
  check(self.said && self.frames === 0,
    'Inkwave refuses to open Inkwave in its own panel, and renders NO frame',
    JSON.stringify(self))
  check(!self.blamedHeader,
    'and it does NOT blame a framing header - that sentence is false about our own app',
    String(self.blamedHeader))
  await typeAddress('https://plato.stanford.edu/entries/identity-time/')
  const ordinary = await page.evaluate(() => document.querySelectorAll('[data-iw-selectable] iframe').length)
  check(ordinary === 1,
    'KNOWN-NEGATIVE: an ordinary source still frames in the same run - the check discriminates',
    `${ordinary} frame(s)`)

  // REFRESH IN READER MODE KEEPS THE WRITER'S PLACE. Deliberate and different from live: it is
  // the same article re-fetched, so losing your position would be a punishment for a slow network.
  await clickBy('Reader view')
  await page.waitForFunction(() => document.querySelectorAll('[data-iw-selectable] p').length > 3, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(900)
  const scrolled = await page.evaluate(() => {
    const el = document.querySelector('[data-iw-selectable]')
    if (!el || el.scrollHeight - el.clientHeight < 60) return null
    el.scrollTop = 120
    el.dispatchEvent(new Event('scroll'))
    return el.scrollTop
  })
  if (scrolled == null) {
    console.log('  - SKIPPED: the reader fixture is too short to scroll; position cannot be measured here')
  } else {
    await page.waitForTimeout(500)
    await page.evaluate(() => { const b = document.querySelector('[data-iw-reader-refresh]'); if (b) b.click() })
    await page.waitForTimeout(2500)
    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-iw-selectable]')
      return { top: el ? Math.round(el.scrollTop) : -1, paras: document.querySelectorAll('[data-iw-selectable] p').length }
    })
    check(after.paras >= 4, 'refresh in READER view re-renders the article', JSON.stringify(after))
    check(Math.abs(after.top - scrolled) <= 24,
      'and keeps the reader place - it is the same article, not a new navigation',
      `${scrolled} -> ${after.top}`)
  }

  const anchored = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const before = el.scrollTop
    const a = [...el.querySelectorAll('a')].find((x) => /change/i.test(x.textContent))
    return { hasLink: !!a, before }
  }, body)
  check(anchored.hasLink, 'links in the article render as links')

  // ── "SAVE THIS PDF TO MY SOURCES" (Peter, 2026-08-30: "also can we have a downloads") ──────────
  // The unit tests prove the rules and the write order; the component test proves the panel calls
  // them. What only a real browser can show is that the bytes END UP ON DISK — so this audits OPFS
  // DIRECTLY, out of the app's own code path. Asking the suspect to certify itself is how a probe
  // ends up structurally incapable of seeing its bug (the archive-guard lesson, one lane along).
  // ⚠ SAME ORIGIN, AND THAT IS A FINDING RATHER THAN A CONVENIENCE. The first cut of this cell
  // served the PDF from example.edu with `access-control-allow-origin: *` and it FAILED — not on
  // CORS, but on Inkwave's OWN Content-Security-Policy: `middleware.ts` sets
  // `connect-src 'self' <named hosts>`, so a cross-origin fetch is refused before it leaves the
  // document. That refuted the "try the extension, fall back to a direct fetch" design, and the
  // panel now decides the route BEFORE drawing a button (`pdfRouteFor`). What remains fetchable by
  // the page alone is `'self'` — a PDF on Inkwave's own origin — which is what this serves, and
  // which is the ONLY save path a probe can drive, since no probe can load an unpacked extension.
  // The cross-origin case is measured too, a few cells down, as the state it actually is: no route.
  const PDF_ADDR = `${base}/probe/probe-source-2026.pdf`
  // A real, minimal, openable PDF — one page, no fonts. `%PDF-` matters (it is what the byte check
  // reads); the rest is here so nothing downstream is looking at a truncated file.
  const PDF_BODY = [
    '%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
    'trailer<</Root 1 0 R>>', '%%EOF',
  ].join('\n')
  await page.route((u) => u.pathname === '/probe/probe-source-2026.pdf', (route) => route.fulfill({
    status: 200, contentType: 'application/pdf', body: PDF_BODY,
  }))

  const apiBefore = apiCalls
  await typeAddress(PDF_ADDR)
  const card = await page.evaluate(() => ({
    said: /This is a PDF\./.test(document.body.innerText),
    named: /probe-source-2026\.pdf/.test(document.body.innerText),
    save: !!document.querySelector('[data-iw-pdf-save]'),
    show: !!document.querySelector('[data-iw-pdf-show]'),
  }))
  check(card.said && card.named, 'a PDF address raises the save card instead of a read failure',
    JSON.stringify(card))
  // The escape hatch is load-bearing: without it a writer whose save cannot fetch would be left
  // with LESS than before, since live mode renders a PDF perfectly well in the browser's own viewer.
  check(card.show, 'and still offers to show the file in the panel')
  check(apiCalls === apiBefore, 'and spends no /api/reader fetch on a file it cannot extract prose from',
    `${apiBefore} -> ${apiCalls}`)

  if (!card.save) {
    check(false, 'VOID: no save button, so nothing below can be read')
  } else {
    await page.evaluate(() => document.querySelector('[data-iw-pdf-save]').click())
    await page.waitForFunction(() => /Saved as|couldn|won’t let|didn’t return/.test(document.body.innerText),
      null, { timeout: 15000 }).catch(() => {})
    const said = await page.evaluate(() => document.body.innerText.match(/Saved as “([^”]+)”/)?.[1] ?? null)
    check(said === 'probe-source-2026', 'pressing it saves the file as a source',
      said === null ? 'panel said: ' + (await page.evaluate(() => (document.body.innerText.match(/[^\n]*(couldn|won’t let|didn’t return)[^\n]*/) || [''])[0])) : said)

    // THE AUDIT, off the disk, not through the app. `hasPdf` is `!!_iw.pdfName` and nothing else,
    // so an entry claiming a PDF with no bytes behind it is the "file is gone" bug this whole
    // ordering exists to prevent — and only a read of OPFS can tell those two states apart.
    const onDisk = await page.evaluate(async () => {
      try {
        const root = await navigator.storage.getDirectory()
        const lib = await root.getDirectoryHandle('library')
        const pdfs = await lib.getDirectoryHandle('pdfs')
        const f = await (await pdfs.getFileHandle('probe-source-2026.pdf')).getFile()
        const head = new TextDecoder().decode(await f.slice(0, 5).arrayBuffer())
        return { size: f.size, head }
      } catch (e) {
        // An absence and a failure are different answers; say which.
        return { error: e && e.name === 'NotFoundError' ? 'absent' : String((e && e.message) || e) }
      }
    })
    check(onDisk.head === '%PDF-' && onDisk.size > 0,
      'and the BYTES are really in OPFS, audited outside the app’s own read path',
      JSON.stringify(onDisk))
  }

  // ⚠ NIGHT, MEASURED RATHER THAN REASONED. `prove:nightaudit` walks this panel but never navigates
  // to a PDF, so the card is a surface it cannot reach — and the reader's night is recent enough
  // that "it uses the same tokens" is the kind of claim that has been wrong here twice. The one
  // genuinely new pairing is the SUCCESS line: `--iw-verified` laid on reader PAPER, which is a
  // warm charcoal at night and near-white by day.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'))
  await page.waitForTimeout(500)
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((n) => {
      const v = Number(n) / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const nightPair = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      d.children.length === 0 && /^Saved as/.test((d.textContent || '').trim()))
    if (!el) return null   // null, never a fabricated pair — the panel may be showing the error state
    // Walk to the first ancestor that actually paints, so the "background" is what is really behind.
    let bg = 'rgba(0, 0, 0, 0)'
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break }
    }
    return { fg: getComputedStyle(el).color, bg }
  })
  if (!nightPair) check(false, 'VOID: no success line on screen at night, so its colours cannot be read')
  else {
    const [a, bb] = [lum(nightPair.fg), lum(nightPair.bg)].sort((x, y) => y - x)
    const ratio = (a + 0.05) / (bb + 0.05)
    check(ratio >= 4.5, 'the “saved” line is legible on the night reading page',
      `${nightPair.fg} on ${nightPair.bg} → ${ratio.toFixed(2)}:1`)
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  await page.waitForTimeout(300)

  // ⚠ THE CROSS-ORIGIN CASE, WHICH IS EVERY REAL PUBLISHER WITHOUT THE EXTENSION. It must NOT draw
  // a save button: with `connect-src 'self'` the fetch cannot leave this document, so a button
  // labelled "save" would be guaranteed to fail — the dead control wearing an error message.
  await typeAddress('https://example.edu/papers/no-route-2026.pdf')
  const noRoute = await page.evaluate(() => ({
    card: /This is a PDF\./.test(document.body.innerText),
    save: !!document.querySelector('[data-iw-pdf-save]'),
    said: /only allowed to\s+talk to a short list|only allowed to talk to a short list/.test(document.body.innerText),
    offered: /The Inkwave extension fixes this\./.test(document.body.innerText),
    tab: !!document.querySelector('[data-iw-pdf-show]'),
  }))
  check(noRoute.card, 'a cross-origin PDF still raises the card', JSON.stringify(noRoute))
  check(!noRoute.save, 'but draws NO save button, because this document cannot fetch it')
  check(noRoute.said, 'and says why BEFORE a press rather than after one')
  check(noRoute.offered, 'and offers the extension, which is what removes that wall')
  check(noRoute.tab, 'and still lets the writer show the file in the panel')

  await typeAddress(PDF_ADDR)
  await page.waitForTimeout(400)

  // The literal half of the ask, read off the LIVE element rather than off the source: without
  // `allow-downloads` a download link inside a framed page does nothing at all, silently.
  await clickBy('Live page')
  await page.waitForTimeout(900)
  const sandbox = await page.evaluate(() => {
    const f = document.querySelector('[data-iw-selectable] iframe')
    return f ? f.getAttribute('sandbox') : null   // null, never '', when there is no frame to read
  })
  if (sandbox === null) check(false, 'VOID: no live frame on screen, so its sandbox cannot be read')
  else {
    check(sandbox.split(/\s+/).includes('allow-downloads'), 'the live frame may start a download', sandbox)
    check(!sandbox.includes('allow-top-navigation'),
      'and nothing else was widened — a framed page still cannot replace the Inkwave tab')
  }

  // 375px: the card is a column of wrapped pill buttons, and Peter reads on an iPhone.
  await page.setViewportSize({ width: 375, height: 667 })
  await clickBy('Reader view')
  await page.waitForTimeout(900)
  const phone = await page.evaluate(() => {
    const btn = document.querySelector('[data-iw-pdf-show]')
    if (!btn) return null
    const row = btn.parentElement
    const r = row.getBoundingClientRect()
    return { rowRight: Math.round(r.right), rowLeft: Math.round(r.left), vw: window.innerWidth,
      h: Math.round(btn.getBoundingClientRect().height) }
  })
  if (!phone) check(false, 'VOID: the PDF card is not on screen at 375px, so nothing can be measured')
  else {
    check(phone.rowLeft >= -1 && phone.rowRight <= phone.vw + 1,
      'at 375px the card’s actions stay inside the screen', JSON.stringify(phone))
    check(phone.h >= 26, 'and its buttons are not hairlines', `${phone.h}px`)
  }
} catch (e) {
  console.log(`  ✗ ${e.message}`)
  fail++
} finally { await b.close(); await stop() }
console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
