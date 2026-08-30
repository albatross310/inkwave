// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE PDF PAGE'S PAINTED GEOMETRY — does it fill the panel, and does it follow the window?
//
// Peter, 2026-08-30: "there's also a bug now where PDFs no longer change size, and there's a no
// man's land space of empty background between the page and left side — page is a bit narrower than
// web page viewer."  (Feature: the PDF reading panel. LIVE, no flag, and it is the panel he reads
// his sources in beside the honours proposal.)
//
// THREE CLAIMS, ONE STATE. All three fall out of a PERSISTED USER ZOOM below 1:
//   1. "no longer change size" — every re-fit path bailed on `zoom !== 1` ("manual zoom wins"),
//      and `zoom` is persisted and can never land back on exactly 1 through the gesture. One
//      ctrl+wheel — a trackpad pinch will do — froze the page size for every PDF, for ever.
//   2. "no man's land" — at zoom 0.6 the page renders narrower than the pane and floats in a strip
//      of the scroller's own background.
//   3. "narrower than web page viewer" — the source reader's column is `flex-1` minus 64px of
//      padding, so it always fills its dock; the frozen PDF page did not.
//
// WHAT IT MEASURES, in painted pixels off the real DOM:
//   gapLeft   = page.left − scroller.left      (12 = the scroller's own padding = flush; >12 = dead
//                                               background; <0 = the page overflows, which is what
//                                               fit-to-TEXT does on purpose)
//   pageW     before and after the window widens by 300px
//   readerW   the source reader's reading column in the SAME dock, for claim 3
//
// KNOWN-NEGATIVE IN THE SAME BUILD: `window.__iwPdfFitRule = 'legacy'` restores both halves — the
// `zoom !== 1` bails and the absence of a pane-derived zoom floor. Cell A must REPRODUCE Peter's
// symptom or nothing may be read from cell B. This seam exists FOR this probe; if the probe goes,
// the seam goes (the rule this repo already applies to __iwPdfZoomAnchor and __iwArchiveGuard).
//
// WIDTH RANGE, NOT A POINT: Peter runs a ~570px window (half-screen on a Mac) and a whole class of
// footer/dock bugs here was invisible at the 900-2000px everyone else tested at.
//
// HARNESS TRAPS this repo has already paid for: `serviceWorkers: 'block'` (a service worker answers
// from its own cache and page.route does not intercept it), and `page.mouse.wheel` drops a modifier
// held with keyboard.down — the ctrl+wheel is dispatched by hand.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { chromium } from '@playwright/test'
import { startProbeServer } from '../textrender-probe/serve.mjs'
import { makePdf } from './fixture.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const PDFKEY = 'geom2026'
const WEBKEY = 'web2026'
const STUCK_ZOOM = 0.6          // what one trackpad pinch leaves behind
const WIDEN_BY = 300            // px added to the viewport, which widens the dock with it
const SCROLLER_PAD = 12         // the scroller's own padding — "flush" is exactly this, never 0
const pdfB64 = Buffer.from(makePdf({ pages: 4 })).toString('base64')

let fail = 0, voids = 0
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`)
  if (!ok) fail++
}
const voidCheck = (msg, extra = '') => { console.log(`  ⊘ VOID ${msg}${extra ? ' — ' + extra : ''}`); voids++ }

/** Seed a document (with one citation to a web-only source) + the library + the PDF bytes. */
async function seed(page, docId) {
  return page.evaluate(async ({ id, b64, pk, wk }) => {
    const items = [
      { id: pk, type: 'article-journal', title: 'A Generated Fixture', author: [{ family: 'Fixture', given: 'A' }],
        issued: { 'date-parts': [[2026]] }, _iw: { pdfName: 'fixture.pdf' } },
      { id: wk, type: 'webpage', title: 'A Web Source', author: [{ family: 'Webby', given: 'B' }],
        issued: { 'date-parts': [[2026]] }, URL: 'https://example.invalid/article' },
    ]
    const doc = {
      id, title: 'PDF geometry probe', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Body ' }, { type: 'citation', attrs: { citekeys: [wk] } }, { type: 'text', text: ' end.' },
      ] }] },
    }
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    try {
      const root = await navigator.storage.getDirectory()
      const docs = await root.getDirectoryHandle('documents', { create: true })
      const dir = await docs.getDirectoryHandle(id, { create: true })
      let h = await dir.getFileHandle('current.json', { create: true })
      let w = await h.createWritable(); await w.write(JSON.stringify(doc)); await w.close()
      const lib = await root.getDirectoryHandle('library', { create: true })
      const per = await lib.getDirectoryHandle(id, { create: true })
      h = await per.getFileHandle('citations.json', { create: true })
      w = await h.createWritable(); await w.write(JSON.stringify(items)); await w.close()
      const pdfs = await lib.getDirectoryHandle('pdfs', { create: true })
      h = await pdfs.getFileHandle(encodeURIComponent(pk) + '.pdf', { create: true })
      w = await h.createWritable(); await w.write(bin); await w.close()
    } catch (e) { return 'opfs: ' + e.message }
    return 'ok'
  }, { id: docId, b64: pdfB64, pk: PDFKEY, wk: WEBKEY })
}

/** The one geometry read. Returns null — never zeros — when the page is not on screen. */
const GEOM = () => {
  const viewer = document.querySelector('.pdfViewer')
  const sc = viewer && viewer.parentElement
  const pg = document.querySelector('.pdfViewer .page[data-idx="0"]')
  if (!sc || !pg) return null
  const scr = sc.getBoundingClientRect(), pr = pg.getBoundingClientRect()
  const vs = getComputedStyle(viewer)
  return {
    scClientW: sc.clientWidth,
    pgW: +pr.width.toFixed(1),
    gapLeft: +(pr.left - scr.left).toFixed(1),
    gapRight: +(scr.right - pr.right).toFixed(1),
    viewerPadL: parseFloat(vs.paddingLeft) || 0,
    scrollLeft: +sc.scrollLeft.toFixed(1),
    scrollW: sc.scrollWidth,
  }
}

const { base, stop } = await startProbeServer()
const browser = await chromium.launch({ headless: true })

async function open({ width, height, rule, userZoom, tag }) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.addInitScript((o) => {
    if (o.rule) window.__iwPdfFitRule = o.rule
    try {
      localStorage.setItem('inkwave:pdfPanelOrientation', 'side')
      localStorage.setItem('inkwave:pdfDockSide', 'right')
      if (o.userZoom != null) localStorage.setItem('inkwave:pdfUserZoom', String(o.userZoom))
      else localStorage.removeItem('inkwave:pdfUserZoom')
    } catch { /* private mode */ }
  }, { rule, userZoom, tag })
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(1200)
  const docId = 'geom-' + tag
  const s = await seed(page, docId)
  if (s !== 'ok') throw new Error('seed: ' + s)
  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(1800)
  return { ctx, page }
}

async function openPdf(page) {
  await page.evaluate((key) => window.dispatchEvent(new CustomEvent('inkwave:open-pdf', { detail: { citekey: key, page: 1, label: key } })), PDFKEY)
  // Wait for the CONTENT, never a clock: a probe that fails by luck accuses a working feature.
  await page.waitForSelector('.pdfViewer .page[data-idx="0"] canvas', { timeout: 30000 })
  await page.waitForTimeout(2500) // the open-time fit + scroll settle chain
}

/**
 * WIDEN THE PANEL BY ITS OWN MECHANISM — and the two docks do not share one.
 * A SIDE dock has a fixed pixel `width` that does NOT follow the window (PdfSidePanel seeds it once
 * from innerWidth and only a drag changes it), so resizing the viewport there widens nothing and the
 * probe would read "frozen" about a working build. A BOTTOM dock spans `left:0;right:0`, so the
 * viewport IS its width. Use each dock's own handle.
 */
async function widen(page, kind, W) {
  if (kind === 'bottom') { await page.setViewportSize({ width: W + WIDEN_BY, height: 900 }); return true }
  const h = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => d.style.cursor === 'col-resize')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 300 }
  })
  if (!h) return false
  await page.mouse.move(h.x, h.y); await page.mouse.down()
  await page.mouse.move(h.x - WIDEN_BY, h.y, { steps: 12 }); await page.mouse.up()
  return true
}

/**
 * The margin-note reach: background you can scroll onto past each edge of the page.
 *
 * ⚠ MEASURED, AND IT IS ASYMMETRIC — a pre-existing property of the shipped 180px gutter, present
 * identically in both cells, unchanged by this lane and NOT fixed here. `.pdfViewer` is a block, so
 * a page wider than its content box overflows it symmetrically under `margin: 0 auto`; the LEFT
 * overflow is not scrollable, and the right padding sits underneath the right overflow. Sweeping the
 * gutter 0 → 180 → 600 moved the LEFT reach 12 → 192 → 612 and the RIGHT reach 0 → 0 → 0. So the
 * reach exists on the left margin only. Reported, not implied closed.
 */
const reachOf = (page) => page.evaluate(() => {
  const sc = document.querySelector('.pdfViewer')?.parentElement
  const pg = document.querySelector('.pdfViewer .page[data-idx="0"]')
  if (!sc || !pg) return null
  const was = sc.scrollLeft
  sc.scrollLeft = sc.scrollWidth
  const right = +(sc.getBoundingClientRect().right - pg.getBoundingClientRect().right).toFixed(1)
  sc.scrollLeft = 0
  const left = +(pg.getBoundingClientRect().left - sc.getBoundingClientRect().left).toFixed(1)
  sc.scrollLeft = was
  return { left, right }
})

const wheelIn = (page, notches) => page.evaluate((n) => {
  const sc = document.querySelector('.pdfViewer').parentElement
  const b = sc.getBoundingClientRect()
  for (let i = 0; i < n; i++) {
    sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
      deltaY: -120, deltaMode: 0, clientX: b.left + b.width * 0.3, clientY: b.top + b.height * 0.5 }))
  }
}, notches)

// ── THE SWEEP ───────────────────────────────────────────────────────────────────────────────────
// 570 is Peter's own half-screen window (below 1024 the dock is a BOTTOM dock, so the panel is the
// window); 1100 and 1440 are the side dock, widened by its own drag handle.
for (const { W, kind } of [{ W: 570, kind: 'bottom' }, { W: 1100, kind: 'side' }, { W: 1440, kind: 'side' }]) {
  console.log(`\n══ viewport ${W}×900 (${kind} dock), a persisted zoom of ${STUCK_ZOOM} ${'═'.repeat(20)}`)

  // CELL A — the control. It MUST reproduce, or cell B proves nothing.
  const A = await open({ width: W, height: 900, rule: 'legacy', userZoom: STUCK_ZOOM, tag: `legacy${W}` })
  await openPdf(A.page)
  const a0 = await A.page.evaluate(GEOM)
  if (!(await widen(A.page, kind, W))) { voidCheck(`control at ${W}px: no way to widen the ${kind} dock`); await A.ctx.close(); continue }
  await A.page.waitForTimeout(1800)
  const a1 = await A.page.evaluate(GEOM)
  await wheelIn(A.page, 6)
  await A.page.waitForTimeout(2600)
  const aReach = await reachOf(A.page)
  await A.ctx.close()

  if (!a0 || !a1) { voidCheck(`control at ${W}px: the page never rendered`); continue }
  console.log(`   CONTROL  rest: pane ${a0.scClientW} page ${a0.pgW} gapLeft ${a0.gapLeft} · widened: pane ${a1.scClientW} page ${a1.pgW} gapLeft ${a1.gapLeft}`)
  const reproDead = a0.gapLeft > SCROLLER_PAD + 20
  const reproFrozen = Math.abs(a1.pgW - a0.pgW) < 1 && a1.scClientW > a0.scClientW + 100
  check(reproDead, `CONTROL reproduces the dead strip at ${W}px`, `${a0.gapLeft}px of background left of the page`)
  check(reproFrozen, `CONTROL reproduces the frozen size at ${W}px`, `page ${a0.pgW} → ${a1.pgW} while the pane grew ${a0.scClientW} → ${a1.scClientW}`)
  if (!reproDead || !reproFrozen) { voidCheck(`fixed cell at ${W}px is unreadable — the control did not reproduce`); continue }

  // CELL B — the shipped rule, same seeded state.
  const B = await open({ width: W, height: 900, rule: null, userZoom: STUCK_ZOOM, tag: `fixed${W}` })
  await openPdf(B.page)
  const b0 = await B.page.evaluate(GEOM)
  await widen(B.page, kind, W)
  await B.page.waitForTimeout(1800)
  const b1 = await B.page.evaluate(GEOM)
  if (!b0 || !b1) { voidCheck(`fixed at ${W}px: the page never rendered`); await B.ctx.close(); continue }
  console.log(`   FIXED    rest: pane ${b0.scClientW} page ${b0.pgW} gapLeft ${b0.gapLeft} · widened: pane ${b1.scClientW} page ${b1.pgW} gapLeft ${b1.gapLeft}`)
  check(b0.gapLeft <= SCROLLER_PAD + 1, `no dead strip at ${W}px`, `gapLeft ${b0.gapLeft} (padding is ${SCROLLER_PAD})`)
  check(b1.gapLeft <= SCROLLER_PAD + 1, `no dead strip after the window widens`, `gapLeft ${b1.gapLeft}`)
  check(b0.pgW >= b0.scClientW - 2 * SCROLLER_PAD - 1, `the page fills the panel at ${W}px`, `page ${b0.pgW} in a ${b0.scClientW} pane`)
  check(b1.pgW > b0.pgW + 100, `the PDF changes size with the window`, `page ${b0.pgW} → ${b1.pgW}`)

  // REGRESSION, NOT A CONTROL: the overscroll reach Peter asked for must survive the floor. Scored
  // against the CONTROL's own reach at the same viewport, not a number I picked — this change does
  // not touch the gutter, so the claim is "no worse", and an absolute threshold would be a guess
  // about a mechanism I was not asked to change.
  await wheelIn(B.page, 6)
  await B.page.waitForTimeout(2600)
  const bz = await B.page.evaluate(GEOM)
  const bReach = await reachOf(B.page)
  if (!bz || aReach == null || bReach == null) { voidCheck(`overscroll at ${W}px: no page after the zoom`) }
  else {
    check(bz.viewerPadL === 180, `the overscroll gutter is still there when zoomed in at ${W}px`, `paddingLeft ${bz.viewerPadL}, page ${bz.pgW}`)
    check(bReach.left >= aReach.left - 1 && bReach.right >= aReach.right - 1,
      `the reach past the page edge is no worse than before`,
      `left ${bReach.left} / right ${bReach.right} vs the control's ${aReach.left} / ${aReach.right}`)
  }
  await B.ctx.close()
}

// ── CLAIM 3: the PDF page beside the source reader's column, in the SAME dock ───────────────────
console.log(`\n══ the PDF page vs the web reader's column, same dock ${'═'.repeat(24)}`)
{
  const { ctx, page } = await open({ width: 1440, height: 900, rule: null, userZoom: STUCK_ZOOM, tag: 'vsreader' })
  await openPdf(page)
  const pdf = await page.evaluate(GEOM)
  // Click the in-text citation hook — the source has a URL and no PDF, so it opens the reader.
  await page.evaluate(() => {
    const wrap = document.querySelector('.ProseMirror .node-citation')
    if (!wrap) return
    const spans = [...wrap.querySelectorAll('span')].filter(s => (s.textContent || '').trim().length > 1)
    ;(spans[spans.length - 1] || wrap).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(3500)
  const reader = await page.evaluate(() => {
    const body = document.querySelector('.iw-reader-page')
    if (!body) return null
    const r = body.getBoundingClientRect(), cs = getComputedStyle(body)
    return { columnW: +(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)).toFixed(1) }
  })
  if (!pdf) voidCheck('the PDF page never rendered')
  else if (!reader) voidCheck('the source reader never opened — nothing to compare against')
  else {
    console.log(`   PDF page ${pdf.pgW}px · reader column ${reader.columnW}px`)
    check(pdf.pgW >= reader.columnW, 'the PDF page is not narrower than the web reader beside it', `${pdf.pgW} vs ${reader.columnW}`)
  }
  await ctx.close()
}

// ── The DEFAULT path must be byte-for-byte what it was: fit-to-text still overflows on purpose ──
console.log(`\n══ regression: no persisted zoom, fit-to-text is untouched ${'═'.repeat(14)}`)
{
  const { ctx, page } = await open({ width: 1440, height: 900, rule: null, userZoom: null, tag: 'default' })
  await openPdf(page)
  const g0 = await page.evaluate(GEOM)
  await widen(page, 'side', 1440)
  await page.waitForTimeout(1800)
  const g1 = await page.evaluate(GEOM)
  if (!g0 || !g1) voidCheck('the default path never rendered')
  else {
    console.log(`   rest: pane ${g0.scClientW} page ${g0.pgW} gapLeft ${g0.gapLeft} · widened: pane ${g1.scClientW} page ${g1.pgW}`)
    check(g0.gapLeft < 0, 'fit-to-text still zooms past page fit (the page overflows, by design)', `gapLeft ${g0.gapLeft}`)
    check(g1.pgW > g0.pgW + 100, 'and it still tracks the window', `page ${g0.pgW} → ${g1.pgW}`)
  }
  await ctx.close()
}

await browser.close()
await stop()
console.log(`\n${fail === 0 && voids === 0 ? 'ALL CHECKS PASSED' : `${fail} FAILED, ${voids} VOID`}`)
process.exit(fail === 0 && voids === 0 ? 0 : 1)
