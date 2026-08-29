// PROVE THE MARKED-UP EXPORT IN A REAL BROWSER — Lane C (Peter: "a three dots button with an export
// and print button that export/print the marked up pdf as a pdf … or to printer").
//
// The unit tests pin the pure rules (the xref, the single-fill union, the refusal, the wrap). What
// they structurally cannot see is the part that only exists in a browser: a real pdf.js document, a
// real <canvas>, a real JPEG encoder, and whether the marks are actually IN the pixels that come
// out. That is what this drives.
//
// THE LOOP IS DELIBERATE. The source PDF under test is built by our OWN writer and then handed to
// pdf.js to open. That makes pdf.js a second independent validator of `buildImagePdf` (CoreGraphics
// via qlmanage was the first), and it means the probe needs no committed binary fixture.
//
// THE CONTROL IS THE POINT. "A pixel inside the highlight is yellow" proves nothing on its own — a
// page could be yellow. So every render is done TWICE, with the marks and with none, and the verdict
// is the DIFFERENCE. Cell B must show the pixel unchanged, or cell A is not measuring the painter.
//
//   node scripts/pdfexport.prove.mjs

import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

// An explicit high random port, not 0: with 0 the plugin chain still settles on vite's default
// 5173, and taking 5173 on a shared box kills somebody else's dev server (CLAUDE.md's probe rule).
const server = await createServer({
  server: { port: 41000 + Math.floor(Math.random() * 2000), strictPort: false }, logLevel: 'error',
})
await server.listen()
// The LISTENING port, not the configured one — with port 0 the config still reports vite's
// default and the probe would print an origin it is not using.
const port = server.httpServer.address().port
const origin = `http://localhost:${port}`
console.log(`probe server on ${origin}\n`)

const browser = await chromium.launch()
// The service worker answers from its own cache and page.route does not intercept it — a stale
// bundle would be measured as a broken feature. (scripts/textrender-probe/reader.prove.mjs)
const context = await browser.newContext({ serviceWorkers: 'block' })
const page = await context.newPage()
page.on('console', m => { if (m.type() === 'error') console.log('   [page error]', m.text().slice(0, 300)) })
// A bare document on the app's origin: the module graph is the real dev server's, but none of the
// app boots, so nothing races the probe.
await page.route('**/__pdfexport-probe', route =>
  route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>probe</title><body></body>' }))
await page.goto(`${origin}/__pdfexport-probe`)

const out = await page.evaluate(async () => {
  const { buildImagePdf, jpegSize } = await import('/src/components/minimalPdf.ts')
  const { renderAnnotatedPages, paintAnnotations, planAnnotatedRender } =
    await import('/src/components/pdfAnnotatedPages.ts')
  const { getPdfjs, PDF_DOC_PARAMS } = await import('/src/citations/pdfjsSetup.ts')

  const bytesOf = (canvas, q = 0.9) => new Promise(res =>
    canvas.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/jpeg', q))

  // ── A source PDF: two white pages with a black band, built by our own writer ──
  const src = document.createElement('canvas')
  src.width = 612; src.height = 792
  const sctx = src.getContext('2d')
  sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, 612, 792)
  sctx.fillStyle = '#000000'; sctx.fillRect(60, 700, 400, 14) // a "line of text", far from the mark
  const srcJpeg = await bytesOf(src)
  const srcPdf = buildImagePdf([
    { jpeg: srcJpeg, widthPt: 612, heightPt: 792 },
    { jpeg: srcJpeg, widthPt: 612, heightPt: 792 },
  ])

  // ── pdf.js — an independent parser — must accept it ──
  const pdfjs = await getPdfjs()
  const doc = await pdfjs.getDocument({ data: srcPdf.slice(), ...PDF_DOC_PARAMS }).promise
  const vp1 = (await doc.getPage(1)).getViewport({ scale: 1 })

  // ── Render with a red highlight over a known band, and without it ──
  const RECT = { x: 0.1, y: 0.1, w: 0.6, h: 0.06 }
  const marks = [{
    id: 'h', page: 1, kind: 'highlight', rects: [RECT],
    color: '#ff0000', text: 'x', createdAt: '2026-08-30T00:00:00Z',
  }]
  const withMarks = await renderAnnotatedPages({ doc, marks, scale: 2 })
  const without = await renderAnnotatedPages({ doc, marks: [], scale: 2 })

  // Sample the middle of the highlight on page 1 of each render.
  async function sample(jpeg) {
    const bmp = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    c.getContext('2d').drawImage(bmp, 0, 0)
    const px = (fx, fy) => Array.from(
      c.getContext('2d').getImageData(Math.round(fx * bmp.width), Math.round(fy * bmp.height), 1, 1).data)
    return { w: bmp.width, h: bmp.height, inside: px(0.4, 0.13), outside: px(0.4, 0.5) }
  }
  // ── THE PRINT PATH: the images must actually LOAD in the print document ──
  // window.print() cannot be driven headlessly, but the failure worth catching is upstream of it and
  // silent: a print fired before the blob: images decode puts BLANK SHEETS on paper. So build the
  // real print document, put it in a real iframe, and wait on the images the way the shipping code
  // does — if they never load, that is the blank print, observed.
  const { buildPrintHtml } = await import('/src/components/pdfAnnotatedPages.ts')
  const printUrls = withMarks.map(pg => URL.createObjectURL(new Blob([pg.jpeg], { type: 'image/jpeg' })))
  const printHtml = buildPrintHtml(
    withMarks.map((pg, i) => ({ url: printUrls[i], widthPt: pg.widthPt, heightPt: pg.heightPt })), 'probe')
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;'
  document.body.appendChild(frame)
  frame.contentDocument.open(); frame.contentDocument.write(printHtml); frame.contentDocument.close()
  const printImgs = Array.from(frame.contentDocument.images)
  await Promise.all(printImgs.map(img => img.complete
    ? Promise.resolve()
    : new Promise(r => { img.onload = () => r(); img.onerror = () => r() })))
  const printReport = {
    imgs: printImgs.length,
    loaded: printImgs.filter(i => i.complete && i.naturalWidth > 0).length,
    naturalW: printImgs[0]?.naturalWidth ?? 0,
    hasPageRule: /@page \{ size: 612pt 792pt; margin: 0 \}/.test(printHtml),
    breaks: (printHtml.match(/page-break-after: always/g) || []).length,
  }
  printUrls.forEach(URL.revokeObjectURL)
  frame.remove()

  const a = await sample(withMarks[0].jpeg)
  const b = await sample(without[0].jpeg)
  const p2 = await sample(withMarks[1].jpeg)

  return {
    pdfjsPages: doc.numPages,
    vp1: { w: vp1.width, h: vp1.height },
    jpegSize: jpegSize(withMarks[0].jpeg),
    renderedPages: withMarks.length,
    pagePt: { w: withMarks[0].widthPt, h: withMarks[0].heightPt },
    canvasPx: { w: a.w, h: a.h },
    marked: a, control: b, page2: p2, printReport,
    plan30: planAnnotatedRender(30, vp1.width, vp1.height),
    plan4000: planAnnotatedRender(4000, vp1.width, vp1.height),
  }
})

// ── Verdicts ─────────────────────────────────────────────────────────────────────────────────────
const white = c => c[0] > 235 && c[1] > 235 && c[2] > 235
// ⚠ THE FIRST VERSION OF THIS PREDICATE WAS WRONG, AND THE PROBE CAUGHT IT RATHER THAN THE CODE.
// It demanded a SATURATED red (g < 140, b < 140) from a mark painted at globalAlpha 0.4 with
// `multiply` — which over white gives (255, 153, 153) by definition, because 60% of the white page
// is meant to show through. Asserting saturation would have been asserting that highlighting makes
// the text underneath UNREADABLE, i.e. demanding the bug. The property that actually matters is a
// WASH: the hue arrives (green and blue drop a long way) while the page still shows through (they
// do not drop to zero). Both halves are load-bearing — a mutant that drops globalAlpha paints
// (255, 0, 0) and fails the second.
const washOf = (marked, control) => ({
  drop: (control[1] - marked[1] + control[2] - marked[2]) / 2, // how much colour arrived
  keptRed: marked[0],
  showsThrough: Math.min(marked[1], marked[2]),
})

check('pdf.js opens a PDF written by buildImagePdf', out.pdfjsPages === 2, `${out.pdfjsPages} pages`)
check('the page box survives the round trip', Math.abs(out.vp1.w - 612) < 0.6 && Math.abs(out.vp1.h - 792) < 0.6,
  `${out.vp1.w.toFixed(1)} × ${out.vp1.h.toFixed(1)} pt`)
check('every page is rendered', out.renderedPages === 2, `${out.renderedPages}`)
check('the export carries the page size in points', out.pagePt.w === out.vp1.w && out.pagePt.h === out.vp1.h,
  `${out.pagePt.w.toFixed(1)} × ${out.pagePt.h.toFixed(1)} pt`)
check('scale 2 really renders at 2× the points', out.canvasPx.w === Math.floor(out.vp1.w * 2),
  `${out.canvasPx.w} × ${out.canvasPx.h} px`)
check('the declared JPEG size matches the canvas', out.jpegSize.width === out.canvasPx.w && out.jpegSize.height === out.canvasPx.h,
  `${out.jpegSize.width} × ${out.jpegSize.height}`)

const wash = washOf(out.marked.inside, out.control.inside)
check('THE MARK IS IN THE PIXELS: the highlight tints the page',
  wash.drop > 80 && wash.keptRed > 240,
  `rgba ${out.marked.inside} (colour arrived: ${wash.drop.toFixed(0)}/255)`)
check('and it is a WASH, not paint — the page still shows through',
  wash.showsThrough > 100,
  `min(g,b) = ${wash.showsThrough}, so ~${Math.round(100 * wash.showsThrough / 255)}% of the page survives`)
check('CONTROL: the same pixel with no marks is white', white(out.control.inside), `rgba ${out.control.inside}`)
check('the paint is bounded — outside the rect stays white', white(out.marked.outside), `rgba ${out.marked.outside}`)
check('a page with no marks of its own is left clean', white(out.page2.inside), `rgba ${out.page2.inside}`)

check('PRINT: every page becomes a sheet in the print document',
  out.printReport.imgs === 2 && out.printReport.breaks >= 1, `${out.printReport.imgs} images`)
check('PRINT: the images DECODE before print would fire (a blank print, caught upstream)',
  out.printReport.loaded === out.printReport.imgs && out.printReport.naturalW === out.canvasPx.w,
  `${out.printReport.loaded}/${out.printReport.imgs} loaded at ${out.printReport.naturalW}px`)
check('PRINT: the sheet is the source page size with no browser margin',
  out.printReport.hasPageRule)

check('an ordinary source plans full resolution', out.plan30.ok === true && out.plan30.scale === 2, JSON.stringify(out.plan30))
check('an enormous source is refused, not truncated', out.plan4000.ok === false,
  out.plan4000.ok ? 'WRONGLY ALLOWED' : out.plan4000.reason.slice(0, 60) + '…')

await browser.close()
await server.close()

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILED:', failed.map(f => f.name).join(' · ')); process.exit(1) }
console.log('PDF EXPORT PROBE PASSED')
