// THE PDF READER VIEW, DRIVEN IN A REAL BROWSER FOR THE FIRST TIME.
//
// ⚠ WHY THIS EXISTS. `src/components/pdfReflow.ts` + `PdfReaderView.tsx` shipped to master having
// passed unit tests and the gate, and nothing else. The gate cannot see any of the five things the
// feature actually promises: that the view opens, that it shows the PDF's own words, that the font
// and line-spacing controls MOVE PIXELS, that a highlight made in it survives being re-typeset, and
// that the page view it sits beside is untouched. Peter reads his sources in this viewer every day
// and has found every reader bug of the last three days himself.
//
// WHAT IT DOES. Builds a deterministic three-page PDF (./pdffixture.mjs — written here, in the
// repo, from text you can read), seeds it as a real source on a real document through the real OPFS
// paths, opens it the way Peter does (a plain click on an in-text citation), and then USES it:
// switches to the reader, changes the type, highlights a phrase, drops a note, goes back to the page
// view, and reloads. Every verdict is a measurement — computed styles, laid-out heights, normalised
// overlay rectangles, and the anchor text as it was actually written to disk.
//
// ⚠ THE INSTRUMENTS ARE ARMED BEFORE THEIR VERDICTS ARE READ. Four of the checks below could pass
// vacuously, so each carries a known-negative that must fire first:
//   · block-text equality would be true over an EMPTY list      → the count is asserted, and a
//     deliberately-wrong expectation is required to MISMATCH before the right one is believed;
//   · "the height changed" means nothing from a noisy instrument → the same height is measured twice
//     with nothing touched and must be identical;
//   · "the highlight is still placed" means nothing if the probe cannot see an UNPLACED one → two
//     rect-only legacy marks are seeded, and they must show up in the reader's "not placed here"
//     list while the anchored one does not;
//   · "the page view's rects are unmoved" means nothing from an instrument returning a constant →
//     the two legacy marks are seeded at DIFFERENT rectangles and both must read back distinctly.
//
// ⚠ VOID, NEVER PASS. A check that could not be made honestly is reported VOID and exits non-zero.
// The commonest cause is a stale `build/` — this probe reads what the browser downloads, so if the
// served bundle predates the reader view it says so instead of announcing that the feature is
// missing. (`chunk.test.ts` has bitten this repo for exactly that reason.)
//
// TWO TRAPS INHERITED FROM ./reader.prove.mjs, both of which look exactly like the feature failing:
//   · Inkwave registers a service worker that answers from its own cache — the context must be
//     created with `serviceWorkers: 'block'`.
//   · `.ProseMirror` alone matches the hidden anti-flash shell; an editor is
//     `.ProseMirror[contenteditable="true"]`.

import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { PAGES, expectedBlocks, fixtureBase64, UNIQUE_PHRASE, UNIQUE_AT } from './pdffixture.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const READER = '[data-iw-reader]'
const TOGGLE = '[data-iw-reader-toggle]'
const CITEKEY = 'harbour1974'

// The two pre-existing, RECT-ONLY marks. They are the reader view's declared stale case ("Peter
// accepted that pre-existing rect-only marks go stale — stale is not deleted") AND this probe's
// known-negative in two directions at once: the reader must LIST them as unplaceable, and the page
// view must keep drawing them at exactly these coordinates through everything the reader does.
// DIFFERENT rectangles on purpose — an instrument that returned a constant would match one of them
// and could never match both.
const LEGACY = [
  { id: 'legacy-a', page: 1, color: '#ffe066', kind: 'highlight',
    text: 'LEGACY RECT MARK A', rects: [{ x: 0.1234, y: 0.2345, w: 0.3456, h: 0.0234 }] },
  { id: 'legacy-b', page: 1, color: '#8ec5ff', kind: 'highlight',
    text: 'LEGACY RECT MARK B', rects: [{ x: 0.5432, y: 0.6543, w: 0.2109, h: 0.0198 }] },
].map(h => ({ ...h, createdAt: '2026-01-01T00:00:00.000Z' }))

const P1 = expectedBlocks(0)
const NOTE_BLOCK = 1                       // page 1, the first body paragraph
const NOTE_ANCHOR = P1[NOTE_BLOCK].slice(0, 60)   // what `noteAnchorText` must store (max = 60)

let fail = 0, voids = 0
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`)
  if (!ok) fail++
  return ok
}
const voidCheck = (msg, why) => { console.log(`  ⊘ VOID ${msg} — ${why}`); voids++ }
const near = (a, b, tol) => Math.abs(a - b) <= tol

const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 1500, height: 980 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [page error]', String(e).slice(0, 160)))

/** Read the persisted library for this document straight off OPFS — the bytes, not React state. */
const readLibrary = (docId) => page.evaluate(async (id) => {
  try {
    const root = await navigator.storage.getDirectory()
    const lib = await root.getDirectoryHandle('library')
    const per = await lib.getDirectoryHandle(id)
    const fh = await per.getFileHandle('citations.json')
    return JSON.parse(await (await fh.getFile()).text())
  } catch (e) { return { error: String(e) } }
}, docId)

/** Every mark the reader view has actually painted, with the text it covers.
 *  NULL — never an empty list — when the reader is not on screen at all. "No marks painted" and
 *  "there is nothing to paint on" are different answers, and reading the second as the first is how
 *  a probe reports a working feature as broken (it did, on the first run: Escape had closed the
 *  whole PDF panel and every mark read as missing). */
const placedMarks = () => page.evaluate((sel) => {
  const root = document.querySelector(sel)
  if (!root) return null
  return [...root.querySelectorAll('span[data-mark-id]')].map(s => {
    const p = s.closest('[data-block]'), wrap = s.closest('[data-page-block]')
    const r = s.getBoundingClientRect()
    return { id: s.dataset.markId, text: s.textContent, block: p ? Number(p.dataset.block) : -1,
             pageBlock: wrap?.dataset.pageBlock ?? null,
             bg: getComputedStyle(s).backgroundColor,
             rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) } }
  })
}, READER)

/** The reader's own honest count of what it could not place, and the list behind it. */
const orphanReport = () => page.evaluate(async (sel) => {
  const root = document.querySelector(sel)
  if (!root) return null                       // same distinction as placedMarks: absent ≠ zero
  const btn = [...root.querySelectorAll('button')].find(x => /not placed here/.test(x.textContent || ''))
  if (!btn) return { count: 0, items: [] }
  const n = Number(/^(\d+)/.exec(btn.textContent.trim())?.[1] ?? 0)
  btn.click()
  await new Promise(r => setTimeout(r, 200))
  const items = [...root.querySelectorAll('li')].map(li => li.textContent.trim())
  btn.click()
  return { count: n, items }
}, READER)

/** The paragraph carrying the unique phrase: computed type, and its laid-out box. */
const typeMetrics = () => page.evaluate(({ sel, phrase }) => {
  const root = document.querySelector(sel)
  const p = [...root.querySelectorAll('[data-block]')].find(el => (el.textContent || '').includes(phrase))
  if (!p) return null
  const cs = getComputedStyle(p)
  const r = p.getBoundingClientRect()
  const flow = root.querySelector('[data-page]')?.parentElement
  return {
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
    height: Math.round(r.height * 100) / 100,
    width: Math.round(r.width * 100) / 100,
    flowHeight: flow ? flow.scrollHeight : -1,
  }
}, { sel: READER, phrase: UNIQUE_PHRASE })

/** Every legacy overlay rectangle the PAGE view has drawn, normalised against the layer it sits in
 *  — the same 0..1 space the mark is stored in, so the number is comparable to the seed AND stable
 *  across zoom and scrolling (which are not bugs). */
const pageOverlayRects = () => page.evaluate((titles) => {
  const out = {}
  for (const t of titles) {
    const div = document.querySelector(`div[title="${t}"]`)
    if (!div) { out[t] = null; continue }
    // hlLayer > group(multiply) > rect  — normalise against the layer, which is the page box.
    const layer = div.parentElement?.parentElement
    if (!layer) { out[t] = null; continue }
    const dr = div.getBoundingClientRect(), lr = layer.getBoundingClientRect()
    if (!(lr.width > 0 && lr.height > 0)) { out[t] = null; continue }
    const r4 = (v) => Math.round(v * 10000) / 10000
    out[t] = { x: r4((dr.x - lr.x) / lr.width), y: r4((dr.y - lr.y) / lr.height),
               w: r4(dr.width / lr.width), h: r4(dr.height / lr.height) }
  }
  return out
}, LEGACY.map(l => l.text))

/** Move a React-controlled range input the way a drag does. `.value = x` alone is swallowed by
 *  React's value tracker; the prototype setter + an `input` event is what it listens to. */
const setRange = (label, value) => page.evaluate(({ sel, label, value }) => {
  const el = document.querySelector(`${sel} input[aria-label="${label}"]`)
  if (!el) return 'no input'
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(el, String(value))
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
}, { sel: READER, label, value })

/**
 * Arm one of the VIEWER's markup tools.
 *
 * ⚠ SCOPED, AND THE SCOPE IS THE POINT. `button[title^="Highlight"]` also matches the EDITOR's own
 * StyleBar H button — two elements, and Playwright takes the first, which is in a different
 * component entirely. The viewer's tools are the buttons whose title is `<label> — …`, and this
 * asserts there is exactly one before clicking anything.
 */
const armTool = (label) => page.evaluate((label) => {
  const hits = [...document.querySelectorAll('button')].filter(b => b.title.startsWith(label + ' — '))
  if (hits.length !== 1) return `expected 1 "${label}" tool button, found ${hits.length} (0 usually means the PDF panel closed)`
  hits[0].click()
  return 'ok'
}, label)

// ⚠ DISARM BY CLICKING THE TOOL AGAIN, NEVER BY PRESSING ESCAPE. Two components listen for Escape:
// PdfViewer disarms the tool, and PdfSidePanel CLOSES THE WHOLE PANEL — and the panel wins. The
// first run of this probe pressed Escape, lost the reader, and reported "no marks painted" about a
// highlight that had in fact been created and written to disk. `armTool` toggles, so it is its own
// off switch.
const disarmTool = (label) => armTool(label)

/** Wait until the reader has read every page of the fixture. */
async function waitReaderReady(pages) {
  await page.waitForSelector(READER, { timeout: 30000 })
  await page.waitForFunction((n) => document.querySelectorAll('[data-iw-reader] section[data-page]').length >= n,
    pages, { timeout: 30000 })
  await page.waitForTimeout(400)
}

/** Open the source the way Peter does: a plain click on the in-text author-year. */
async function openViewer() {
  await page.waitForSelector('.iw-cite-link', { timeout: 30000 })
  await page.evaluate(() => {
    const link = document.querySelector('.iw-cite-link')
    link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    link.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForSelector(TOGGLE, { timeout: 30000 })
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, null, { timeout: 30000 })
}

try {
  // ── SEED ──────────────────────────────────────────────────────────────────────────────────────
  // Through the real persistence paths, never by importing app internals: a production bundle has
  // no /src module graph, and reaching into one is what made the FIRST attempt at ./reader.prove.mjs
  // mount nothing and print PASS.
  const docId = 'pdfreader-probe-' + Math.random().toString(36).slice(2, 8)
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })

  const seeded = await page.evaluate(async ({ id, b64, key, legacy }) => {
    const item = {
      id: key, type: 'book', title: 'Notes on a Harbour Ledger',
      author: [{ family: 'Marlin', given: 'E' }], issued: { 'date-parts': [[1974]] },
      _iw: { pdfName: 'harbour-ledger.pdf', highlights: legacy },
    }
    const doc = {
      id, title: 'PDF reader probe', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'As recorded ' },
        { type: 'citation', attrs: { citekeys: [key], prefix: '', suffix: '', locator: '', suppressAuthor: false } },
        { type: 'text', text: ' the ledger disagrees with itself.' },
      ] }] },
    }
    try {
      const root = await navigator.storage.getDirectory()
      const write = async (path, text) => {
        let dir = root
        for (const seg of path.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true })
        const fh = await dir.getFileHandle(path[path.length - 1], { create: true })
        const w = await fh.createWritable(); await w.write(text); await w.close()
      }
      await write(['documents', id, 'current.json'], JSON.stringify(doc))
      await write(['library', id, 'citations.json'], JSON.stringify([item]))
      // atob, not `fetch('data:…')` — the app ships a CSP whose connect-src has no `data:`, so the
      // convenient decode is refused and the failure reads as "OPFS is broken".
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const lib = await root.getDirectoryHandle('library', { create: true })
      const pdfs = await lib.getDirectoryHandle('pdfs', { create: true })
      const ph = await pdfs.getFileHandle(`${encodeURIComponent(key)}.pdf`, { create: true })
      const pw = await ph.createWritable(); await pw.write(bytes); await pw.close()
      return 'ok:' + bytes.length
    } catch (e) { return 'opfs: ' + e.message }
  }, { id: docId, b64: fixtureBase64(), key: CITEKEY, legacy: LEGACY })
  check(seeded.startsWith('ok:'), 'seeded a source with an embedded 3-page PDF and two legacy rect marks', seeded)
  if (!seeded.startsWith('ok:')) throw new Error('seeding failed — nothing downstream is readable')

  // Reader-view type settings are per-device localStorage. Start from the defaults so the numbers
  // below are a property of the build, not of whatever the last run left behind.
  await page.evaluate(() => {
    for (const k of ['inkwave:pdfReaderMode', 'inkwave:pdfReaderFont', 'inkwave:pdfReaderSize', 'inkwave:pdfReaderLeading'])
      localStorage.removeItem(k)
  })

  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(1500)
  await openViewer()

  // ⚠ IS THE SERVED BUILD THE ONE UNDER TEST? A `build/` that predates the reader view has no
  // toggle, and every check below would then report a working feature as missing.
  if (!(await page.locator(TOGGLE).count())) {
    voidCheck('the whole probe', 'the served bundle has no reader-view toggle — run `pnpm build` first')
    throw new Error('stale build')
  }

  // ── 5a. PAGE VIEW BASELINE (measured BEFORE the reader is ever opened) ────────────────────────
  console.log('\n— the page view, before the reader is opened —')
  const pageStats = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    textLayers: document.querySelectorAll('.textLayer').length,
    layerText: [...document.querySelectorAll('.textLayer')].map(l => l.textContent).join(' ').replace(/\s+/g, ' '),
  }))
  check(pageStats.canvases > 0, 'the page view renders pages', `${pageStats.canvases} canvas(es)`)
  check(pageStats.layerText.includes('harbour master keeps a ledger'),
    'the page view’s own text layer carries the fixture text',
    `${pageStats.layerText.length} chars`)

  const beforeRects = await pageOverlayRects()
  // KNOWN-NEGATIVE FOR THE INSTRUMENT: two marks seeded at DIFFERENT rectangles must read back as
  // two DIFFERENT numbers that each match their own seed. An instrument returning a constant, or
  // reading the wrong element, cannot satisfy both.
  let rectInstrumentOk = true
  for (const l of LEGACY) {
    const got = beforeRects[l.text], want = l.rects[0]
    const ok = !!got && near(got.x, want.x, 0.004) && near(got.y, want.y, 0.004) &&
      near(got.w, want.w, 0.006) && near(got.h, want.h, 0.006)
    if (!check(ok, `the page view draws ${l.id} at the rectangle it was stored at`,
      `${JSON.stringify(got)} vs ${JSON.stringify(want)}`)) rectInstrumentOk = false
  }
  check(rectInstrumentOk && beforeRects[LEGACY[0].text].y !== beforeRects[LEGACY[1].text].y,
    'the rect instrument DISCRIMINATES (two different seeds read back differently)')

  // ── 1. DOES THE READER OPEN, AND SHOW THE PDF'S ACTUAL TEXT? ──────────────────────────────────
  console.log('\n— 1. the reader view opens and shows the PDF’s own words —')
  check(await page.locator(`${READER} [data-block]`).count() === 0,
    'no reflowed paragraphs exist before the reader is asked for')
  await page.click(TOGGLE)
  await waitReaderReady(PAGES.length)
  check(await page.locator(READER).count() === 1, 'the reader view opened')

  const seenBlocks = await page.evaluate((sel) => {
    const out = []
    for (const s of document.querySelectorAll(`${sel} section[data-page]`)) {
      out.push({ page: Number(s.dataset.page),
                 blocks: [...s.querySelectorAll('[data-block]')].map(p => p.textContent),
                 noTextLayer: /no text layer/.test(s.textContent || '') })
    }
    return out
  }, READER)

  const expectedAll = PAGES.map((_, i) => expectedBlocks(i))
  if (seenBlocks.length !== PAGES.length || seenBlocks.every(p => p.noTextLayer)) {
    voidCheck('the reflowed-text checks',
      `the reader read ${seenBlocks.length}/${PAGES.length} pages and found no text layer — pdf.js did not extract, so nothing about the RENDERER can be read here`)
  } else {
    // ARM THE COMPARISON FIRST: an equality over an empty list is true, and an expectation that
    // cannot mismatch proves nothing. A deliberately-wrong expectation must FAIL.
    const cmp = (exp) => seenBlocks.length === exp.length &&
      seenBlocks.every((p, i) => p.blocks.length === exp[i].length && p.blocks.every((t, j) => t === exp[i][j]))
    const bogus = expectedAll.map((p, i) => i === 0 ? [...p.slice(0, -1), 'a paragraph the PDF does not contain'] : p)
    check(!cmp(bogus), 'the text comparison can FAIL (a wrong expectation is rejected)')
    check(cmp(expectedAll), 'every reflowed paragraph is EXACTLY the PDF’s text',
      `${seenBlocks.reduce((n, p) => n + p.blocks.length, 0)} blocks over ${seenBlocks.length} pages`)
    const heads = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-block]`)]
      .filter(p => Number(getComputedStyle(p).fontWeight) >= 600).map(p => p.textContent), READER)
    check(heads.length === PAGES.length && PAGES.every(p => heads.includes(p.heading)),
      'the three headings are set as headings, not as body paragraphs', heads.join(' | ').slice(0, 90))
  }

  // ── 2. DO THE TYPE CONTROLS MOVE PIXELS? ──────────────────────────────────────────────────────
  console.log('\n— 2. the font and line-spacing controls —')
  const t0 = await typeMetrics()
  if (!t0) {
    voidCheck('the type-control checks', 'the paragraph carrying the fixture phrase was not rendered')
  } else {
    // KNOWN-NEGATIVE: the same measurement, twice, with nothing touched. If this is not identical
    // the instrument is noisy and no "the height changed" verdict below can be attributed.
    await page.waitForTimeout(250)
    const t0b = await typeMetrics()
    const stable = t0b.height === t0.height && t0b.lineHeight === t0.lineHeight
    check(stable, 'the height instrument is STABLE (nothing touched ⇒ identical measurement)',
      `${t0.height}px then ${t0b.height}px`)

    // FONT. Garamond (the default) → JetBrains Mono: a serif to a monospace, so if the family truly
    // changes the same words cannot occupy the same number of lines. The HEIGHT is the proof the
    // font really swapped — `document.fonts.check()` famously answers true for a family with no
    // @font-face, so a style string alone would not settle it.
    await page.selectOption(`${READER} select`, { label: 'JetBrains' })
    await page.waitForTimeout(400)
    const tFont = await typeMetrics()
    check(tFont.fontFamily !== t0.fontFamily, 'the reading font changed',
      `${t0.fontFamily.split(',')[0]} → ${tFont.fontFamily.split(',')[0]}`)
    check(tFont.width === t0.width, 'the column width is unchanged, so any height change is the FONT',
      `${t0.width}px`)
    check(tFont.height !== t0.height,
      'the paragraph is LAID OUT DIFFERENTLY — the change reaches the pixels',
      `${t0.height}px → ${tFont.height}px (${((tFont.height / t0.height - 1) * 100).toFixed(1)}%)`)
    check(tFont.flowHeight !== t0.flowHeight, 'the whole reflowed column changed height',
      `${t0.flowHeight}px → ${tFont.flowHeight}px`)
    await page.selectOption(`${READER} select`, { label: 'Garamond' })
    await page.waitForTimeout(300)

    // LINE SPACING. 1.7 → 3.0. Same font, same width, same words: the height must scale with the
    // computed line-height, which is a number the control has no other way of producing.
    const before = await typeMetrics()
    check((await setRange('Line spacing', 30)) === 'ok', 'the line-spacing control exists')
    await page.waitForTimeout(400)
    const after = await typeMetrics()
    const lhBefore = parseFloat(before.lineHeight), lhAfter = parseFloat(after.lineHeight)
    check(lhAfter > lhBefore, 'the computed line-height changed', `${before.lineHeight} → ${after.lineHeight}`)
    const want = lhAfter / lhBefore, got = after.height / before.height
    check(near(got, want, 0.06),
      'the paragraph grew IN PROPORTION to the line-height (same lines, more leading)',
      `height ×${got.toFixed(3)} vs line-height ×${want.toFixed(3)}`)
    await setRange('Line spacing', 17)
    await page.waitForTimeout(300)
  }

  // ── 3. A HIGHLIGHT, AND WHETHER TEXT ANCHORING IS REAL ────────────────────────────────────────
  console.log('\n— 3. a highlight, and whether it survives being re-typeset —')
  // Arm the ▮ tool first, THEN select: with the tool armed the mark is created inside the same
  // mouseup that ends the drag, so no React re-render can land between the selection and the click
  // that reads it.
  check(await armTool('Highlight') === 'ok', 'the viewer’s ▮ highlight tool is armed')
  await page.waitForTimeout(150)
  const made = await page.evaluate(({ sel, phrase }) => {
    const root = document.querySelector(sel)
    const p = [...root.querySelectorAll('[data-block]')].find(el => (el.textContent || '').includes(phrase))
    if (!p) return 'no paragraph carries the phrase'
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let node = null, at = -1
    while ((node = walker.nextNode())) { at = node.data.indexOf(phrase); if (at >= 0) break }
    if (!node || at < 0) return 'the phrase is split across spans'
    const r = document.createRange()
    r.setStart(node, at); r.setEnd(node, at + phrase.length)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    const box = r.getBoundingClientRect()
    // ⚠ READ THE SELECTION BEFORE THE EVENT. `createFromSelection` clears it synchronously on
    // success, so asking afterwards reports an empty string — i.e. the probe reads the feature
    // WORKING as "the text is not selectable". (It did, on the first run.)
    const got = s.toString()
    node.parentElement.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, clientX: box.right, clientY: box.bottom }))
    return 'selected:' + got
  }, { sel: READER, phrase: UNIQUE_PHRASE })
  check(made.startsWith('selected:') && made.slice(9) === UNIQUE_PHRASE,
    'the reflowed text is SELECTABLE and the exact phrase was selected', made.slice(0, 80))
  await page.waitForTimeout(600)
  await disarmTool('Highlight')

  let marks = await placedMarks()
  if (!marks) { voidCheck('every reader-side check from here on', 'the reader view is no longer on screen'); throw new Error('reader gone') }
  const mine = marks.find(m => m.text === UNIQUE_PHRASE)
  const highlightMade = check(!!mine, 'the highlight was created and painted over EXACTLY the phrase',
    marks.map(m => JSON.stringify(m.text)).join(' ') || 'no marks painted')


  // What actually reached the disk — the anchor is the whole claim, so read it rather than infer it.
  let lib = await readLibrary(docId)
  const stored = (lib?.[0]?._iw?.highlights ?? []).find(h => h.anchor?.text === UNIQUE_PHRASE)
  check(!!stored, 'the mark was PERSISTED with a TEXT anchor, not just coordinates',
    stored ? `block ${stored.anchor.block}, start ${stored.anchor.start}` : 'no anchored mark on disk')

  // ── THE FILL IS ACTUALLY PAINTED, AND IT IS THE MARK'S OWN COLOUR ────────────────────────────
  // `placedMarks` has always COLLECTED `bg` and nothing ever read it — the shape CLAUDE.md calls a
  // metric that collects nothing. It matters now: the wash moved from a JS `rgba()` string to CSS
  // `color-mix(in srgb, var(--iw-mark) var(--iw-reader-wash), transparent)` under an `@supports`
  // guard (2026-08-30, so a highlight stays YELLOW instead of compositing to olive on the night
  // reading page). If that declaration were ever invalid at computed-value time the property would
  // fall to `unset` — TRANSPARENT — NOT to the opaque fallback in the base rule. A highlight that
  // silently paints nothing is exactly the class this file exists to catch.
  // Compared against the mark's OWN persisted colour rather than a literal: the tool's default
  // colour is the viewer's to choose, and a probe that hardcodes it tests the probe's assumption.
  if (mine && stored) {
    // ⚠ `color-mix()` COMPUTES TO `color(srgb r g b / a)`, NOT to `rgb()`, and its channels are
    // 0-1 rather than 0-255. The first cut of this check read only `rgba?()` and reported a
    // PERFECTLY CORRECT fill — `color(srgb 1 0.878431 0.4 / 0.55)`, which IS #ffe066 at 0.55 — as
    // both "transparent" and "the wrong colour". A parser blind to its own subject fails toward
    // "the feature is broken", the most expensive direction to be wrong in (CLAUDE.md records the
    // identical trap in RichDiffView's conservation extractor).
    const rgb255 = (s) => {
      const c = /color\(\s*srgb\s+([^)]+)\)/i.exec(s || '')
      if (c) {
        const p = c[1].split(/[\s/]+/).filter(Boolean).map(Number)
        return { rgb: p.slice(0, 3).map(v => Math.round(v * 255)), a: p.length > 3 ? p[3] : 1 }
      }
      const m = /rgba?\(([^)]+)\)/.exec(s || '')
      if (!m) return { rgb: [], a: 0 }
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
      return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }
    }
    const painted = rgb255(mine.bg)
    const want = [1, 3, 5].map(i => parseInt(stored.color.replace('#', '').slice(i - 1, i + 1), 16))
    // The instrument is armed on a known value before its verdict is read, because the format the
    // engine hands back is exactly what this check got wrong once already.
    const armed = rgb255('color(srgb 1 0.878431 0.4 / 0.55)')
    check(armed.rgb.join(',') === '255,224,102' && armed.a === 0.55,
      'the colour parser reads color(srgb …) as well as rgb()', JSON.stringify(armed))
    check(painted.a > 0.2, 'the highlight FILL is really painted, not transparent', mine.bg)
    check(painted.rgb.join(',') === want.join(','),
      'the fill is the STORED colour — no theme reinterprets a mark', `${mine.bg} vs stored ${stored.color}`)
  }
  if (stored) {
    check(stored.page === UNIQUE_AT.page && stored.anchor.block === UNIQUE_AT.block,
      'the anchor names the right page and paragraph',
      `page ${stored.page}, block ${stored.anchor.block} (want ${UNIQUE_AT.page}/${UNIQUE_AT.block})`)
    check(Array.isArray(stored.rects) && stored.rects.length > 0,
      'it ALSO carries page rectangles, so the page view can draw it', `${stored.rects?.length} rect(s)`)
  }

  // KNOWN-NEGATIVE FOR "STILL PLACED": the reader must be able to say NO. The two rect-only legacy
  // marks have no text to hang on, so they must be counted as unplaceable — and the anchored one
  // must not be among them. Without this, "the highlight is still there" is unfalsifiable.
  const orph = await orphanReport()
  check(!!orph && orph.count === LEGACY.length,
    'the reader REFUSES to place the two rect-only marks, and says how many', `${orph?.count} listed`)
  check(!!orph && !orph.items.some(t => t.includes(UNIQUE_PHRASE)),
    'the anchored mark is NOT among them')

  if (!highlightMade) {
    voidCheck('the highlight-survival checks', 'no highlight was created, so nothing can be said about whether one survives')
  } else {
    const survives = async (what) => {
      const now = await placedMarks()
      const o = await orphanReport()
      if (!now || !o) { voidCheck(`whether the highlight survives ${what}`, 'the reader view vanished'); return false }
      const m = now.find(x => x.id === mine.id)
      return check(!!m && m.text === UNIQUE_PHRASE && !o.items.some(t => t.includes(UNIQUE_PHRASE)),
        `the highlight survives ${what}`,
        m ? `still over "${m.text}" at y=${m.rect.y}` : `GONE (orphans now ${o.count})`)
    }
    await page.selectOption(`${READER} select`, { label: 'JetBrains' })
    await page.waitForTimeout(500)
    await survives('a FONT change')
    await setRange('Line spacing', 28)
    await page.waitForTimeout(500)
    await survives('a LINE-SPACING change')
    // Back to a legible default before the note work.
    await page.selectOption(`${READER} select`, { label: 'Garamond' })
    await setRange('Line spacing', 17)
    await page.waitForTimeout(400)
  }

  // The bare-selection path (no tool armed) must also offer its colours — that is the gesture most
  // readers use. Asserted as WIRED; the load-bearing mark above was made with the tool armed so the
  // survival verdict cannot rest on a popover race.
  await page.evaluate(({ sel }) => {
    const root = document.querySelector(sel)
    const p = root.querySelectorAll('[data-block]')[2]
    const r = document.createRange(); r.selectNodeContents(p)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    const box = p.getBoundingClientRect()
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: box.left + 20, clientY: box.bottom }))
  }, { sel: READER })
  await page.waitForTimeout(350)
  check(await page.locator(`${READER} button[title="Highlight"]`).count() >= 4,
    'a bare selection offers the colour card, with no tool armed')
  // ⚠ DISMISS THE CARD FROM INSIDE THE READER. A click on the editor behind the panel is how
  // PdfSidePanel is DESIGNED to close while bottom-docked ("tapping back into the editor drops the
  // PDF"), so `page.mouse.click(5, 5)` tore the viewer down mid-probe and the next three checks
  // reported the note feature missing. Collapse the selection and hand the reader its own mouseup.
  await page.evaluate((sel) => {
    getSelection().removeAllRanges()
    const root = document.querySelector(sel)
    root?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
  }, READER)
  await page.waitForTimeout(250)
  if (!(await page.locator(TOGGLE).count())) {
    voidCheck('the note + page-view checks', 'the PDF panel closed — nothing below can be measured')
    throw new Error('viewer gone')
  }

  // ── 4. A TEXT NOTE, AND WHERE IT LANDS ────────────────────────────────────────────────────────
  console.log('\n— 4. a text note, anchored to the nearest paragraph —')
  check(await armTool('Text note — click on the page to place') === 'ok', 'the viewer’s T note tool is armed')
  await page.waitForTimeout(150)
  const noteDropped = await page.evaluate(({ sel, bi }) => {
    const root = document.querySelector(sel)
    const p = root.querySelector(`section[data-page="1"] [data-block="${bi}"]`)
    if (!p) return 'no such paragraph'
    const box = p.getBoundingClientRect()
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }))
    return 'clicked'
  }, { sel: READER, bi: NOTE_BLOCK })
  check(noteDropped === 'clicked', 'clicked into the paragraph with the note tool armed', noteDropped)
  await page.waitForTimeout(700)
  await disarmTool('Text note — click on the page to place')

  const noteInfo = await page.evaluate(({ sel, bi }) => {
    const root = document.querySelector(sel)
    const n = root.querySelector('[data-note-id]')
    if (!n) return null
    const wrap = n.closest('[data-page-block]')
    const p = wrap?.querySelector('[data-block]')
    const nr = n.getBoundingClientRect(), pr = p?.getBoundingClientRect()
    return { id: n.dataset.noteId, pageBlock: wrap?.dataset.pageBlock ?? null,
             blockIdx: p ? Number(p.dataset.block) : -1,
             gap: pr ? Math.round(nr.top - pr.bottom) : null,
             insideP: pr ? (nr.top >= pr.top - 2) : false,
             want: bi }
  }, { sel: READER, bi: NOTE_BLOCK })
  const noteMade = check(!!noteInfo, 'the note was created and rendered')
  if (!noteMade) {
    voidCheck('the note-placement checks', 'no note was created')
  } else {
    check(noteInfo.pageBlock === `1:${NOTE_BLOCK}`,
      'the note is attached to the paragraph it was dropped on', `page:block = ${noteInfo.pageBlock}`)
    check(noteInfo.insideP && noteInfo.gap !== null && noteInfo.gap >= 0 && noteInfo.gap < 60,
      'it renders IMMEDIATELY under that paragraph, not floating elsewhere',
      `${noteInfo.gap}px below the paragraph`)
    lib = await readLibrary(docId)
    const sn = (lib?.[0]?._iw?.highlights ?? []).find(h => h.id === noteInfo.id)
    check(!!sn && sn.anchor?.text === NOTE_ANCHOR,
      'its stored anchor is that paragraph’s own opening words, character for character',
      sn ? JSON.stringify(sn.anchor?.text?.slice(0, 46)) : 'not on disk')
    // The anchoring claim again, for the note: re-typeset, still under the same paragraph.
    await page.selectOption(`${READER} select`, { label: 'JetBrains' })
    await page.waitForTimeout(500)
    const after = await page.evaluate((sel) => {
      const n = document.querySelector(`${sel} [data-note-id]`)
      return n ? n.closest('[data-page-block]')?.dataset.pageBlock ?? null : null
    }, READER)
    check(after === `1:${NOTE_BLOCK}`, 'the note is still on that paragraph after a FONT change', String(after))
    await page.selectOption(`${READER} select`, { label: 'Garamond' })
    await page.waitForTimeout(300)
  }

  // ── 5b. BACK TO THE PAGE VIEW: NOTHING MOVED ──────────────────────────────────────────────────
  console.log('\n— 5. the page view, after all of that —')
  await page.click(TOGGLE)
  await page.waitForTimeout(900)
  check(await page.locator(READER).count() === 0, 'the reader closes and the page view is back')
  const afterRects = await pageOverlayRects()
  for (const l of LEGACY) {
    const a = beforeRects[l.text], z = afterRects[l.text]
    check(!!z && JSON.stringify(a) === JSON.stringify(z),
      `${l.id} is drawn at exactly the same place as before the reader was ever opened`,
      `${JSON.stringify(a)} → ${JSON.stringify(z)}`)
  }
  const readerMarkOnPage = await page.evaluate((phrase) =>
    !!document.querySelector(`div[title="${phrase}"]`), UNIQUE_PHRASE)
  check(readerMarkOnPage, 'the highlight made in the READER also draws in the PAGE view')

  // ── 3b. RELOAD ────────────────────────────────────────────────────────────────────────────────
  console.log('\n— 3b. and after a reload —')
  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(1500)
  await openViewer()
  // The type settings persist too, so the mark is being re-found in a DIFFERENTLY typeset column —
  // which is the point rather than an inconvenience.
  const stillReader = await page.locator(READER).count() > 0 ||
    (await page.click(TOGGLE), await page.waitForTimeout(300), true)
  check(stillReader, 'the reader view is available after the reload')
  await waitReaderReady(PAGES.length)
  marks = await placedMarks()
  if (!marks) { voidCheck('the post-reload reader checks', 'the reader view is not on screen after the reload') }
  const reMark = (marks ?? []).find(m => m.text === UNIQUE_PHRASE)
  check(!!marks && !!reMark && (!mine || reMark.id === mine.id),
    'the highlight came back, same id, over the same words', reMark ? reMark.id : 'gone')
  const reNote = await page.evaluate((sel) => {
    const n = document.querySelector(`${sel} [data-note-id]`)
    return n ? n.closest('[data-page-block]')?.dataset.pageBlock ?? null : null
  }, READER)
  check(reNote === `1:${NOTE_BLOCK}`, 'the note came back on its own paragraph', String(reNote))
  const orph2 = await orphanReport()
  check(!!orph2 && orph2.count === LEGACY.length,
    'the two legacy rect marks are still listed as unplaceable — untouched, not deleted', `${orph2?.count}`)

  await page.click(TOGGLE)
  await page.waitForTimeout(900)
  const finalRects = await pageOverlayRects()
  for (const l of LEGACY) {
    check(JSON.stringify(finalRects[l.text]) === JSON.stringify(beforeRects[l.text]),
      `${l.id} is STILL at its original rectangle after a reload`,
      JSON.stringify(finalRects[l.text]))
  }
} catch (e) {
  console.log(`  ✗ ${e.message}`)
  if (e.message !== 'stale build') fail++
} finally { await b.close(); await stop() }

console.log(voids ? `\nVOID (${voids} unmeasurable${fail ? `, ${fail} failed` : ''}) — this is NOT a pass`
  : fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail || voids ? 1 : 0
