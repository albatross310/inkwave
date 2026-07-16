// TEXT-RENDER PROBE — the honest measurement.
//
// Measures the plaintext page renderer (src/editor/textRender.ts) IN THE REAL APP: the real built
// bundle, the real shipped+stripped fonts, the real device DPR, the real live ProseMirror document.
// Nothing here reimplements the editor's context — that is the trap this codebase has hit five times
// (a plain-div wrap harness; a ligatures-on font grid; a font we don't ship; a Chromium hinting
// artifact; and canvasShapingMatchesEditor, a gate that always returned false and silently disabled
// arithLayout in production for months).
//
// THE PROBE PROVES ITSELF FIRST. Before any timing is reported, selfTest() must show the instrument
// can see a KNOWN-POSITIVE: fonts really loaded (not the system fallback measuring against itself),
// the measure discriminates, and an injected 5% advance error really changes the line count. If the
// probe cannot see a planted error, every null it reports is meaningless and the run ABORTS.
//
// Matrix: {2k, 10k, 40k words} × {build cold/warm, paint text, paint rects, map strip}
//         vs BASELINE A (real SVG-foreignObject bake) and BASELINE B (real WebP encode→decode→blit).
//
// Probe rules honoured: headless, own port, own PID, never touches another agent's server.
// Run:  node scripts/textrender-probe/probe.mjs

import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PROBE_PORT || 4231
const BASE = `http://127.0.0.1:${PORT}`
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })

// ── Synthetic corpus (real prose shape: varied word lengths, paragraph structure) ──────────────
function buildDoc(words, id) {
  let s = 1337
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const BASE_W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis ' +
    'chapter section evidence claims analysis synthesis method critique framework ontology epistemology ' +
    'reason judgment perception substance monad harmony preestablished contingent necessary truth predicate ' +
    'office affluent finds difficult waffles first fifth flourish effigy scaffold').split(/\s+/)
  const paras = []
  let w = 0
  while (w < words) {
    const n = Math.min(30 + Math.floor(rnd() * 40), words - w)
    const out = []
    for (let i = 0; i < n; i++) out.push(BASE_W[Math.floor(rnd() * BASE_W.length)])
    let t = out.join(' ')
    paras.push(t[0].toUpperCase() + t.slice(1) + '.')
    w += n
  }
  return {
    id, title: `probe-${words}`,
    contentJson: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'probe',
  }
}

const SIZES = [2000, 10000, 40000]

function stats(xs) {
  const a = [...xs].sort((x, y) => x - y)
  return { p50: +a[Math.floor(a.length / 2)].toFixed(2), min: +a[0].toFixed(2), max: +a[a.length - 1].toFixed(2) }
}

const results = { dpr: null, selfTest: {}, sizes: {}, baselines: {}, fidelity: {} }

const browser = await chromium.launch({
  headless: true,
  // Real subpixel text — Chromium's default Linux fontconfig quantises advances to whole px, which
  // manufactures false canvas↔DOM divergences (the round-10 hinting lesson).
  args: ['--font-render-hinting=none', '--disable-lcd-text', '--enable-precise-memory-info'],
})
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 160)) })

try {
  // ?textRender arms the sticky flag before the app reads it (entry.client).
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500) // reveal + first pagination

  results.dpr = await page.evaluate(() => window.devicePixelRatio)
  console.log(`\ndevicePixelRatio = ${results.dpr}`)

  for (const words of SIZES) {
    const doc = buildDoc(words, `probe-tr-${words}`)
    console.log(`\n━━━ ${words} words ━━━`)
    await page.evaluate((d) => {
      window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } }))
    }, doc)
    // Wait for the editor to actually carry the new doc, then for the probe surface.
    await page.waitForFunction((n) => {
      const p = window.__iwTextRenderProbe
      return !!p && p.words() > n * 0.8
    }, words, { timeout: 60000 })
    await page.waitForTimeout(1500)

    // ── THE KNOWN-POSITIVE GATE — run before ANY timing is trusted ──
    const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
    results.selfTest[words] = st
    console.log(`  selfTest: fontsReallyLoaded=${st.fontsReallyLoaded} (fonts.check said ${st.fontsCheckSays}) ` +
      `measureDiscriminates=${st.measureDiscriminates} seesKnownPositive=${st.seesKnownPositive} ` +
      `(lines ${st.baseLines} → ${st.inflatedLines} under +5% advance)`)
    if (!st.fontsReallyLoaded || !st.measureDiscriminates || !st.seesKnownPositive) {
      throw new Error(`PROBE IS BLIND at ${words} words — refusing to report numbers. selfTest=${JSON.stringify(st)}`)
    }
    console.log(`  coverage: ${JSON.stringify(st.coverage)}`)

    const r = { words, selfTest: st }

    // ── BUILD (layout: canvas advances + greedy wrap + paginate) ──
    r.buildCold = await page.evaluate(() => {
      const p = window.__iwTextRenderProbe
      const { ms, model } = p.buildCold()
      window.__trModel = model
      return { ms, pages: model.pages, lines: model.lines.length }
    })
    const warm = []
    for (let i = 0; i < 5; i++) warm.push(await page.evaluate(() => window.__iwTextRenderProbe.build().ms))
    r.buildWarm = stats(warm)
    console.log(`  build: cold ${r.buildCold.ms.toFixed(1)}ms → warm p50 ${r.buildWarm.p50}ms  (${r.buildCold.pages} pages, ${r.buildCold.lines} lines)`)

    // ── PAINT one page at FULL device DPR ──
    // Measured on a REUSED canvas (what production holds — one persistent canvas per pane) AND on a
    // freshly-allocated one, because a 3.5-megapixel alloc per page is a harness artifact that would
    // otherwise be reported as the renderer's cost. `floor` = sizing + parchment fill with NO text:
    // the hard lower bound any page render pays, which says how much of the number is really glyphs.
    const paintOf = (mode, fresh) => page.evaluate(({ mode, fresh }) => {
      const p = window.__iwTextRenderProbe
      const out = []
      for (let i = 0; i < 8; i++) {
        const r = p.paint(window.__trModel, Math.min(i, window.__trModel.pages - 1), { mode, fresh })
        out.push({ rec: r.recordedMs, flush: r.flushedMs })
      }
      return out
    }, { mode, fresh })
    const pt = await paintOf('text', false)
    r.paintText = stats(pt.map((x) => x.flush))
    r.paintTextRecorded = stats(pt.map((x) => x.rec))
    r.paintRects = stats((await paintOf('rects', false)).map((x) => x.flush))
    r.paintTextFresh = stats((await paintOf('text', true)).map((x) => x.flush))
    r.paintFloor = stats(await page.evaluate(() => {
      const out = []
      for (let i = 0; i < 8; i++) out.push(window.__iwTextRenderProbe.paintFloor({ mode: 'text' }))
      return out
    }))
    console.log(`  paint 1 page @DPR${results.dpr} (reused canvas, RASTER FLUSHED): text p50 ${r.paintText.p50}ms · rects p50 ${r.paintRects.p50}ms`)
    console.log(`    floor (blank page) p50 ${r.paintFloor.p50}ms · fresh-alloc p50 ${r.paintTextFresh.p50}ms · ` +
      `JS-record-only p50 ${r.paintTextRecorded.p50}ms (the number that would have LIED)`)

    // ── MAP STRIP: the WHOLE document at minimap scale, one pass ──
    const mapOf = (mode) => page.evaluate((mode) => {
      const p = window.__iwTextRenderProbe
      const out = []
      for (let i = 0; i < 4; i++) out.push(p.map(window.__trModel, { mode, scale: 0.12 }).flushedMs)
      return out
    }, mode)
    r.mapRects = stats(await mapOf('rects'))
    r.mapText = stats(await mapOf('text'))
    console.log(`  map strip (${r.buildCold.pages} pages @0.12): rects p50 ${r.mapRects.p50}ms · text p50 ${r.mapText.p50}ms`)

    // ── BASELINE B: the real thumbnail present path on the same page ──
    // REPEATED — a single shot of this on WSL software raster produced a 2.2s "decode" of a 94KB
    // WebP, which is not a credible number; medians over repeats separate signal from GC/noise.
    const rt = await page.evaluate(async () => {
      const p = window.__iwTextRenderProbe
      const { canvas } = p.paint(window.__trModel, 0, { mode: 'text' })
      const out = []
      for (let i = 0; i < 5; i++) out.push(await p.thumbRoundTrip(canvas, 0.5))
      return out
    })
    r.thumb = {
      encode: stats(rt.map((x) => x.encodeMs)), decode: stats(rt.map((x) => x.decodeMs)),
      blit: stats(rt.map((x) => x.blitMs)), bytes: rt[0].bytes,
    }
    console.log(`  thumb roundtrip p50: encode ${r.thumb.encode.p50}ms · decode ${r.thumb.decode.p50}ms · ` +
      `blit ${r.thumb.blit.p50}ms · ${(r.thumb.bytes / 1024).toFixed(1)}KB`)

    // ── MEMORY: model vs bitmap ──
    r.mem = await page.evaluate(() => window.__iwTextRenderProbe.modelMem(6))
    console.log(`  memory: model heap ≈ ${(r.mem.perModelBytes / 1048576).toFixed(2)}MB/version (structural est ${(r.mem.structuralBytesEst / 1048576).toFixed(2)}MB) ` +
      `(${r.mem.pages} pages, ${r.mem.lines / 6} lines) vs ONE page bitmap @DPR${results.dpr} = ` +
      `${(r.mem.onePageBitmapBytes / 1048576).toFixed(2)}MB · ${r.mem.note}`)

    results.sizes[words] = r
  }

  // ── BASELINE A: the REAL production bake (SVG-foreignObject capture of the live pane) ──
  // Runs on the 40k doc currently loaded — same machine, same doc, same moment.
  console.log(`\n━━━ BASELINE A: real SVG-foreignObject bake (live pane, 40k doc) ━━━`)
  // The SCROLLER first: captureRegion trims the clone to the scrolled band (whole-pane captures
  // measured 4.5-13s; trimmed ones a few hundred ms), so capturing a non-scrolling element would
  // report the untrimmed worst case and flatter the text renderer unfairly.
  results.baselines.bake = []
  for (const sel of ['.inkwave-editor-surface.iw-fill', '.inkwave-editor-surface', '.scroll-paper']) {
    const b = await page.evaluate(async (s) => {
      const el = document.querySelector(s)
      if (!el) return { error: 'missing' }
      const info = { selector: s, clientW: el.clientWidth, clientH: el.clientHeight, scrollH: el.scrollHeight, scrolls: el.scrollHeight > el.clientHeight + 10 }
      const r = await window.__iwTextRenderProbe.bake(s, 1)
      return { ...info, ...r }
    }, sel)
    console.log(`  ${sel}: ${JSON.stringify(b)}`)
    if (!b.error) results.baselines.bake.push(b)
  }

  // ── FIDELITY: text render vs the REAL editor render, same page, screenshot diff ──
  console.log(`\n━━━ FIDELITY: text render vs the real editor ━━━`)
  const fid = await page.evaluate(async () => {
    const p = window.__iwTextRenderProbe
    const g = p.geom()
    const { model } = p.build()
    const { canvas } = p.paint(model, 0, { mode: 'text' })
    return { dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height, geom: g, pages: model.pages }
  })
  writeFileSync(join(OUT, 'textrender-page0.png'), Buffer.from(fid.dataUrl.split(',')[1], 'base64'))
  results.fidelity.canvas = { w: fid.w, h: fid.h }
  console.log(`  wrote textrender-page0.png (${fid.w}×${fid.h})`)

  // Map strip images, both modes, for the eyeball comparison Peter asked for.
  for (const mode of ['rects', 'text']) {
    const d = await page.evaluate((m) => {
      const p = window.__iwTextRenderProbe
      const { canvas } = p.map(window.__trModel, { mode: m, scale: 0.12 })
      return { url: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }
    }, mode)
    writeFileSync(join(OUT, `map-${mode}.png`), Buffer.from(d.url.split(',')[1], 'base64'))
    console.log(`  wrote map-${mode}.png (${d.w}×${d.h})`)
  }

  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`\nwrote ${join(OUT, 'results.json')}`)
} catch (e) {
  console.error('\nPROBE FAILED:', e.message)
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ ...results, error: e.message }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}
