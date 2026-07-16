// FIDELITY: the text render vs the REAL editor render, same page, same machine, pixel diff.
//
// The brief said "do not hand-wave this", so this is a real screenshot diff against the real
// ProseMirror, not a claim.
//
// ALIGNMENT (measured, not assumed — see _geo.mjs): the editor's `.iw-magnify-box` IS the page box.
// Its rect is 793.6875 × (pageHeight) CSS px with padding 96px, and .ProseMirror starts exactly at
// paper.x+96 / paper.y+96. The renderer paints a pageWidth×pageHeight canvas with the same 96px
// margins, so the two map 1:1 with no fudge factor.
//
// The renderer takes the editor's OWN computed colour + background, so the diff measures GEOMETRY
// and GLYPH RASTER — not a palette mismatch that would swamp the signal.
//
// Run: PROBE_PORT=4231 node scripts/textrender-probe/fidelity.mjs

import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PNG } = require('/root/dev/iw-textrender/node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4231}`

function makeDoc(words, id) {
  let s = 1337
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter ' +
    'section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment ' +
    'perception substance monad harmony preestablished contingent necessary truth predicate office affluent finds ' +
    'difficult waffles first fifth flourish effigy scaffold').split(/\s+/)
  const paras = []
  let w = 0
  while (w < words) {
    const n = Math.min(30 + Math.floor(rnd() * 40), words - w)
    const o = []
    for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)])
    const t = o.join(' ')
    paras.push(t[0].toUpperCase() + t.slice(1) + '.')
    w += n
  }
  return {
    id, title: id,
    contentJson: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'fid',
  }
}

// Per-channel threshold: antialiasing makes near-identical glyphs differ by a few levels, so a raw
// !== count would report ~100% and say nothing. THRESH=16 counts a pixel as different only if a
// channel moves >16/255 — a visible difference. STRICT=0 is reported alongside so the tolerance
// isn't hiding anything.
const THRESH = 16

function diff(a, b) {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
  const out = new PNG({ width: w, height: h })
  let differing = 0, strict = 0, total = w * h
  const bands = 20
  const bandDiff = new Array(bands).fill(0)
  const bandTotal = new Array(bands).fill(0)
  const colBands = 10
  const colDiff = new Array(colBands).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (a.width * y + x) << 2
      const ib = (b.width * y + x) << 2
      const io = (w * y + x) << 2
      const dr = Math.abs(a.data[ia] - b.data[ib])
      const dg = Math.abs(a.data[ia + 1] - b.data[ib + 1])
      const db = Math.abs(a.data[ia + 2] - b.data[ib + 2])
      const m = Math.max(dr, dg, db)
      if (m > 0) strict++
      const bi = Math.min(bands - 1, Math.floor((y / h) * bands))
      bandTotal[bi]++
      if (m > THRESH) {
        differing++
        bandDiff[bi]++
        colDiff[Math.min(colBands - 1, Math.floor((x / w) * colBands))]++
        out.data[io] = 255; out.data[io + 1] = 0; out.data[io + 2] = 0; out.data[io + 3] = 255
      } else {
        const g = 255 - Math.round((a.data[ia] + a.data[ia + 1] + a.data[ia + 2]) / 3 / 4)
        out.data[io] = g; out.data[io + 1] = g; out.data[io + 2] = g; out.data[io + 3] = 255
      }
    }
  }
  return {
    pctDiffering: +((differing / total) * 100).toFixed(3),
    pctAnyDelta: +((strict / total) * 100).toFixed(3),
    differing, total, w, h, png: out,
    bands: bandDiff.map((d, i) => ({ band: i, yFrom: Math.round((i / bands) * h), pct: +((d / Math.max(1, bandTotal[i])) * 100).toFixed(2) })),
    cols: colDiff.map((d, i) => ({ col: i, pct: +((d / Math.max(1, total / colBands)) * 100).toFixed(2) })),
  }
}

// Diff at an (dx,dy) offset — the OFFSET SWEEP. "6% of pixels differ" is not yet an answer: it could
// be correct glyphs with antialiasing noise, or every glyph sitting 1px off. Those demand opposite
// responses (accept vs fix the baseline), and only the sweep tells them apart: if the minimum lands
// at (0,0) the geometry is right and the residue is raster; if it lands at (0,-1) there is a real,
// fixable systematic offset.
function diffAt(a, b, dx, dy) {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
  let differing = 0, total = 0
  for (let y = 0; y < h; y++) {
    const sy = y + dy
    if (sy < 0 || sy >= h) continue
    for (let x = 0; x < w; x++) {
      const sx = x + dx
      if (sx < 0 || sx >= w) continue
      const ia = (a.width * y + x) << 2
      const ib = (b.width * sy + sx) << 2
      total++
      const m = Math.max(Math.abs(a.data[ia] - b.data[ib]), Math.abs(a.data[ia + 1] - b.data[ib + 1]), Math.abs(a.data[ia + 2] - b.data[ib + 2]))
      if (m > THRESH) differing++
    }
  }
  return +((differing / Math.max(1, total)) * 100).toFixed(3)
}

// How much of the page is INK at all? A page is mostly parchment, so "6% of pixels differ" means
// something completely different depending on whether ink covers 6% or 60%. Expressing the diff as a
// fraction of the editor's own ink pixels is the only honest denominator.
function inkCoverage(png, parch) {
  let ink = 0
  for (let i = 0; i < png.data.length; i += 4) {
    const m = Math.max(Math.abs(png.data[i] - parch[0]), Math.abs(png.data[i + 1] - parch[1]), Math.abs(png.data[i + 2] - parch[2]))
    if (m > THRESH) ink++
  }
  return { inkPx: ink, pct: +((ink / (png.width * png.height)) * 100).toFixed(3) }
}

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
const report = {}

try {
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const doc = makeDoc(4000, 'fid-doc')
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 3000, null, { timeout: 60000 })
  await page.waitForTimeout(3000)

  const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.seesKnownPositive) throw new Error('PROBE BLIND: ' + JSON.stringify(st))
  console.log(`selfTest OK — fontsReallyLoaded=${st.fontsReallyLoaded} seesKnownPositive=${st.seesKnownPositive}`)
  report.selfTest = st

  // ── THE DIFFER MUST PROVE ITSELF FIRST ───────────────────────────────────────────────────────
  // A pixel differ is exactly the "measure X, compare to Y" shape that fails silently. So before any
  // fidelity number is believed: (1) identical images MUST read 0% — otherwise the tolerance/index
  // maths is broken and every number is inflated; (2) a 2px vertical shift MUST read high —
  // otherwise the differ is blind to precisely the misregistration it exists to catch, and a "0%"
  // would mean nothing.
  {
    const shot = await page.screenshot({ clip: { x: 400, y: 100, width: 400, height: 400 } })
    const a = PNG.sync.read(shot)
    const same = diff(a, a)
    const shifted = new PNG({ width: a.width, height: a.height })
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        const src = (a.width * Math.min(a.height - 1, y + 4) + x) << 2
        const dst = (a.width * y + x) << 2
        for (let c = 0; c < 4; c++) shifted.data[dst + c] = a.data[src + c]
      }
    }
    const moved = diff(a, shifted)
    console.log(`differ selfTest: identical=${same.pctDiffering}% (must be 0) · 4px-shift=${moved.pctDiffering}% (must be >0)`)
    report.differSelfTest = { identical: same.pctDiffering, shifted: moved.pctDiffering }
    if (same.pctDiffering !== 0) throw new Error('DIFFER BROKEN: identical images do not read 0%')
    if (moved.pctDiffering <= 0) throw new Error('DIFFER BLIND: a 4px shift reads as no difference')
  }

  const PAGES = [0, 1, 2, 3]
  report.pages = []

  for (const pageIdx of PAGES) {
    // REGISTRATION: use the page's OWN sheet element. The editor is GAPPED — page-gap widgets add
    // 266-275px between sheets — so pages do NOT sit at even N×pageHeight offsets. Assuming they did
    // put page 1 a whole gap out of register and reported 94.5% differing: a "the renderer is
    // broken" verdict that was purely the harness comparing the wrong pixels. `.inkwave-sheet` is
    // the parchment panel itself, so its rect IS the page box.
    const geo = await page.evaluate((pageIdx) => {
      const surf = document.querySelector('.inkwave-editor-surface')
      const pm = document.querySelector('.ProseMirror')
      const sheet = document.querySelectorAll('.inkwave-sheet')[pageIdx]
      if (!sheet) return null
      const top = sheet.getBoundingClientRect().top + surf.scrollTop
      surf.scrollTop = Math.max(0, top - 40)
      return { color: getComputedStyle(pm).color }
    }, pageIdx)
    if (!geo) { console.log(`  page ${pageIdx}: no sheet element — skipped`); continue }
    await page.waitForTimeout(500)

    const box = await page.evaluate((pageIdx) => {
      const sheet = document.querySelectorAll('.inkwave-sheet')[pageIdx]
      const r = sheet.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }, pageIdx)

    // NB the editor's page N region is only comparable while it's actually on screen.
    if (box.y < 0 || box.y + box.height > 1400) {
      console.log(`  page ${pageIdx}: box off-screen (y=${box.y.toFixed(0)}) — skipped`)
      continue
    }

    const shot = await page.screenshot({ clip: box })
    const editorPng = PNG.sync.read(shot)

    // SAMPLE the parchment from the editor's OWN pixels. Reading a computed backgroundColor here
    // returns rgba(0,0,0,0) — every ancestor of .ProseMirror is transparent (the parchment is
    // painted by the sheet panels / pseudo-elements), so trusting it painted a TRANSPARENT page and
    // reported 99.9% differing: a total-failure verdict that was entirely the harness's own bug.
    // A page is ~90% background, so the background must be right before any glyph number means
    // anything. Pixel (20,20) is inside the top margin — pure parchment.
    const si = (editorPng.width * 20 + 20) << 2
    const parchment = `rgb(${editorPng.data[si]}, ${editorPng.data[si + 1]}, ${editorPng.data[si + 2]})`

    const mine = await page.evaluate(({ pageIdx, color, bg }) => {
      const p = window.__iwTextRenderProbe
      const { model } = p.build()
      const { canvas } = p.paint(model, pageIdx, { mode: 'text', ink: color, background: bg })
      return canvas.toDataURL('image/png')
    }, { pageIdx, color: geo.color, bg: parchment })
    const minePng = PNG.sync.read(Buffer.from(mine.split(',')[1], 'base64'))

    const d = diff(editorPng, minePng)
    writeFileSync(join(OUT, `fid-editor-p${pageIdx}.png`), PNG.sync.write(editorPng))
    writeFileSync(join(OUT, `fid-render-p${pageIdx}.png`), PNG.sync.write(minePng))
    writeFileSync(join(OUT, `fid-diff-p${pageIdx}.png`), PNG.sync.write(d.png))
    const worst = [...d.bands].sort((a, b) => b.pct - a.pct).slice(0, 3)
    const parch = [editorPng.data[si], editorPng.data[si + 1], editorPng.data[si + 2]]
    const ink = inkCoverage(editorPng, parch)
    // Offset sweep: where is the diff MINIMISED?
    let best = { dx: 0, dy: 0, pct: d.pctDiffering }
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const p = diffAt(editorPng, minePng, dx, dy)
        if (p < best.pct) best = { dx, dy, pct: p }
      }
    }
    console.log(`  page ${pageIdx}: ${d.pctDiffering}% of ALL pixels differ >${THRESH}/255 ` +
      `(= ${(d.pctDiffering / Math.max(0.001, ink.pct) * 100).toFixed(1)}% of the ${ink.pct}% that are ink) ` +
      `· any-delta ${d.pctAnyDelta}%`)
    console.log(`    offset sweep best: dx=${best.dx} dy=${best.dy} → ${best.pct}% ` +
      `${best.dx === 0 && best.dy === 0 ? '(aligned — residue is raster, not geometry)' : '(SYSTEMATIC OFFSET — fixable)'}`)
    console.log(`    worst bands: ${worst.map((b) => `y≈${b.yFrom}:${b.pct}%`).join(' ')}`)
    report.pages.push({
      pageIdx, pctDiffering: d.pctDiffering, pctAnyDelta: d.pctAnyDelta, w: d.w, h: d.h,
      inkPct: ink.pct, pctOfInk: +(d.pctDiffering / Math.max(0.001, ink.pct) * 100).toFixed(1),
      offsetSweepBest: best, bands: d.bands, cols: d.cols,
    })
  }

  writeFileSync(join(OUT, 'fidelity.json'), JSON.stringify(report, null, 2))
  console.log(`\nwrote ${join(OUT, 'fidelity.json')}`)
} catch (e) {
  console.error('FIDELITY FAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
