// MAP COMPARISON — the line-rect hypothesis, shown rather than asserted.
//
// Peter's premise: at minimap scale no glyph is resolvable, so the only information that survives is
// WHERE lines are and HOW LONG they run — which arithmeticLayout already knows without rasterising a
// single glyph. This renders the SAME page three ways at the SAME minimap scale:
//
//   1. THUMBNAIL (ground truth)  — the REAL editor's own pixels (a DPR2 screenshot of the live
//      ProseMirror page), box-downscaled to map scale. This is exactly what the current bake
//      produces: a downscaled raster of the real render. Real pixels, not a stand-in.
//   2. TEXT RENDER               — the plaintext renderer's fillText output at map scale.
//   3. LINE-RECT RENDER          — one filled band per line. No glyphs at all.
//
// If (3) is indistinguishable from (1) at this scale, the premise holds. If it reads as mush, or
// loses something (1) carries, the premise is wrong and the bake stays. Both are good answers.
//
// Run: PROBE_PORT=4231 node scripts/textrender-probe/mapcompare.mjs

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

// Box-filter downscale — the same averaging a browser does for a downscaled draw. Doing this in the
// harness (rather than trusting drawImage) keeps the "thumbnail" branch honest: it is literally the
// editor's own pixels averaged down, with no renderer of ours involved.
function downscale(src, dw, dh) {
  const out = new PNG({ width: dw, height: dh })
  const sx = src.width / dw, sy = src.height / dh
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, n = 0
      const x0 = Math.floor(x * sx), x1 = Math.min(src.width, Math.ceil((x + 1) * sx))
      const y0 = Math.floor(y * sy), y1 = Math.min(src.height, Math.ceil((y + 1) * sy))
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (src.width * yy + xx) << 2
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++
        }
      }
      const o = (dw * y + x) << 2
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255
    }
  }
  return out
}

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
    schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'map',
  }
}

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })

try {
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const doc = makeDoc(4000, 'map-doc')
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 3000, null, { timeout: 60000 })
  await page.waitForTimeout(3000)

  const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.seesKnownPositive) throw new Error('PROBE BLIND: ' + JSON.stringify(st))

  const PAGE_IDX = 0
  // Real editor pixels for the page.
  const geo = await page.evaluate((i) => {
    const surf = document.querySelector('.inkwave-editor-surface')
    const sheet = document.querySelectorAll('.inkwave-sheet')[i]
    surf.scrollTop = Math.max(0, sheet.getBoundingClientRect().top + surf.scrollTop - 40)
    return null
  }, PAGE_IDX)
  await page.waitForTimeout(500)
  const box = await page.evaluate((i) => {
    const r = document.querySelectorAll('.inkwave-sheet')[i].getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }, PAGE_IDX)
  const editorPng = PNG.sync.read(await page.screenshot({ clip: box }))

  const si = (editorPng.width * 20 + 20) << 2
  const parchment = `rgb(${editorPng.data[si]}, ${editorPng.data[si + 1]}, ${editorPng.data[si + 2]})`

  // MAP SCALE: the minimap strip is ~95 CSS px wide (≈0.12 × the 793.7px page). At DPR2 that's a
  // 190px-wide page. Everything below is compared at exactly that size.
  const SCALE = 0.12
  const MW = Math.round(793.7007874015749 * SCALE * 2)
  const MH = Math.round(1122.5196850393702 * SCALE * 2)

  const shots = {}
  for (const mode of ['text', 'rects']) {
    const url = await page.evaluate(({ i, mode, bg, scale }) => {
      const p = window.__iwTextRenderProbe
      const { model } = p.build()
      const { canvas } = p.paint(model, i, { mode, background: bg, scale, ink: '#1a1a1a' })
      return canvas.toDataURL('image/png')
    }, { i: PAGE_IDX, mode, bg: parchment, scale: SCALE })
    shots[mode] = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'))
  }

  const thumb = downscale(editorPng, MW, MH)
  const panels = [
    { name: 'thumbnail (real editor pixels, downscaled)', png: thumb },
    { name: 'text render @ map scale', png: shots.text },
    { name: 'line-rect render @ map scale', png: shots.rects },
  ]

  // Side-by-side sheet, 8px red gutters.
  const GAP = 8
  const W = panels.reduce((s, p) => s + p.png.width, 0) + GAP * (panels.length - 1)
  const H = Math.max(...panels.map((p) => p.png.height))
  const sheet = new PNG({ width: W, height: H })
  for (let i = 0; i < sheet.data.length; i += 4) { sheet.data[i] = 220; sheet.data[i + 1] = 40; sheet.data[i + 2] = 40; sheet.data[i + 3] = 255 }
  let ox = 0
  for (const p of panels) {
    for (let y = 0; y < p.png.height; y++) {
      for (let x = 0; x < p.png.width; x++) {
        const s = (p.png.width * y + x) << 2, d = (W * y + (ox + x)) << 2
        for (let c = 0; c < 4; c++) sheet.data[d + c] = p.png.data[s + c]
      }
    }
    ox += p.png.width + GAP
  }
  writeFileSync(join(OUT, 'map-compare.png'), PNG.sync.write(sheet))
  console.log(`wrote map-compare.png (${W}×${H}) — L→R: ${panels.map((p) => p.name).join(' | ')}`)

  // A 3× nearest-neighbour blow-up, because the honest question is what it looks like ON A SCREEN,
  // and a 190px panel is too small to judge in a report.
  const Z = 3
  const big = new PNG({ width: W * Z, height: H * Z })
  for (let y = 0; y < H * Z; y++) {
    for (let x = 0; x < W * Z; x++) {
      const s = (W * Math.floor(y / Z) + Math.floor(x / Z)) << 2, d = (W * Z * y + x) << 2
      for (let c = 0; c < 4; c++) big.data[d + c] = sheet.data[s + c]
    }
  }
  writeFileSync(join(OUT, 'map-compare-3x.png'), PNG.sync.write(big))
  console.log(`wrote map-compare-3x.png (${W * Z}×${H * Z})`)
} catch (e) {
  console.error('MAPCOMPARE FAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
